import type {
  IntakeActionStep,
  IntakeBatch,
} from "@/lib/intake/contracts";
import { fingerprintRecord } from "@/lib/intake/fingerprint";
import type {
  IntakeRepository,
  ReversibleRecordTable,
  UndoStepInput,
} from "@/lib/intake/repository";

const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

const recordTableByAction = {
  "note.create": "notes",
  "todo.create": "todos",
  "calendar.create": "calendar_events",
} as const satisfies Record<string, ReversibleRecordTable>;

type JsonObject = Record<string, unknown>;

export interface IntakeUndoDependencies {
  repository: IntakeRepository;
  now?: () => Date;
}

export async function undoIntakeBatch(
  ownerId: string,
  batchId: string,
  dependencies: IntakeUndoDependencies,
): Promise<IntakeBatch> {
  const batch = await dependencies.repository.getBatch(ownerId, batchId);
  if (!batch) throw new Error("INTAKE_BATCH_NOT_FOUND");
  if (batch.status === "undone") return batch;

  const now = dependencies.now?.() ?? new Date();
  if (isUndoExpired(batch.createdAt, now)) {
    await dependencies.repository.clearExpiredUndoData({ ownerId, batchId });
    throw new Error("UNDO_WINDOW_EXPIRED");
  }

  if (batch.status !== "undoing") {
    if (!["completed", "partial"].includes(batch.status)) {
      throw new Error("INTAKE_BATCH_NOT_UNDOABLE");
    }
    await dependencies.repository.beginUndo(ownerId, batchId);
  }

  const steps = batch.items
    .flatMap((item) => item.steps)
    .filter((step) =>
      ["completed", "undo_conflict"].includes(step.status),
    )
    .sort(
      (left, right) =>
        right.sequence - left.sequence ||
        String(right.completedAt ?? "").localeCompare(
          String(left.completedAt ?? ""),
        ) ||
        right.id.localeCompare(left.id),
    );

  let hasConflict = false;
  for (const step of steps) {
    const outcome = await undoStep(ownerId, step, dependencies.repository);
    if (outcome === "conflict") hasConflict = true;
  }

  return dependencies.repository.finishUndo(
    ownerId,
    batchId,
    hasConflict ? "partial" : "undone",
  );
}

async function undoStep(
  ownerId: string,
  step: IntakeActionStep,
  repository: IntakeRepository,
): Promise<"undone" | "conflict"> {
  const mutation = stepMutation(ownerId, step);
  if (!step.inverseAction || !step.inverseInput) {
    await repository.markStepUndone(mutation);
    return "undone";
  }

  if (step.inverseAction === "record.delete") {
    const table = recordTable(step.actionName);
    const id = exactReceiptId(step);
    const current = await repository.loadReversibleRecord({
      ownerId,
      table,
      id,
    });
    if (!current) return markUndone(repository, mutation);
    if (!matchesFingerprint(current, step.conflictFingerprint)) {
      return markConflict(repository, mutation);
    }
    await repository.deleteReversibleRecord({ ownerId, table, id });
    return markUndone(repository, mutation);
  }

  if (step.inverseAction === "archive.restore") {
    const id = requireString(step.inverseInput.documentId);
    const current = await repository.loadKnowledgeDocumentForUndo({
      ownerId,
      id,
    });
    if (!current) return markUndone(repository, mutation);
    if (!matchesFingerprint(current, step.conflictFingerprint)) {
      return markConflict(repository, mutation);
    }
    await repository.restoreKnowledgeDocumentCollection({
      ownerId,
      id,
      collectionId: readNullableString(
        step.inverseInput.previousCollectionId,
      ),
    });
    return markUndone(repository, mutation);
  }

  if (step.inverseAction === "relation.delete") {
    const id = exactReceiptId(step);
    const current = await repository.loadRelationForUndo({ ownerId, id });
    if (!current) return markUndone(repository, mutation);
    if (!matchesFingerprint(current, step.conflictFingerprint)) {
      return markConflict(repository, mutation);
    }
    await repository.deleteRelationForUndo({ ownerId, id });
    return markUndone(repository, mutation);
  }

  throw new Error("INVALID_INTAKE_INVERSE");
}

async function markUndone(
  repository: IntakeRepository,
  input: UndoStepInput,
): Promise<"undone"> {
  await repository.markStepUndone(input);
  return "undone";
}

async function markConflict(
  repository: IntakeRepository,
  input: UndoStepInput,
): Promise<"conflict"> {
  await repository.markStepUndoConflict({
    ...input,
    errorCode: "UNDO_RECORD_CHANGED",
  });
  return "conflict";
}

function matchesFingerprint(
  current: JsonObject,
  expected: string | null,
): boolean {
  return expected !== null && fingerprintRecord(current) === expected;
}

function recordTable(actionName: string): ReversibleRecordTable {
  if (actionName in recordTableByAction) {
    return recordTableByAction[
      actionName as keyof typeof recordTableByAction
    ];
  }
  throw new Error("INVALID_INTAKE_INVERSE");
}

function exactReceiptId(step: IntakeActionStep): string {
  const forwardId = requireString(requireRecord(step.forwardResult).id);
  const inverseId = requireString(step.inverseInput?.id);
  if (forwardId !== inverseId) throw new Error("INVALID_INTAKE_INVERSE");
  return forwardId;
}

function stepMutation(ownerId: string, step: IntakeActionStep): UndoStepInput {
  return {
    ownerId,
    batchId: step.batchId,
    itemId: step.itemId,
    stepId: step.id,
  };
}

function isUndoExpired(createdAt: string, now: Date): boolean {
  const createdAtMs = Date.parse(createdAt);
  return (
    !Number.isFinite(createdAtMs) ||
    createdAtMs < now.getTime() - UNDO_WINDOW_MS
  );
}

function requireRecord(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  return value as JsonObject;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value);
}
