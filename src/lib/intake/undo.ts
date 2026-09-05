import type {
  IntakeActionStep,
  IntakeBatch,
  IntakeItem,
} from "@/lib/intake/contracts";
import {
  fingerprintRecord,
  normalizeFingerprintValue,
} from "@/lib/intake/fingerprint";
import type {
  IntakeRepository,
  ReversibleRecordTable,
  UndoStepInput,
  UndoStepResult,
} from "@/lib/intake/repository";

const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

const recordTableByAction = {
  "note.create": "notes",
  "todo.create": "todos",
  "calendar.create": "calendar_events",
} as const satisfies Record<string, ReversibleRecordTable>;

const reversibleRelationActions = new Set([
  "relation.create:note",
  "relation.create:todo",
  "relation.create:calendar",
]);

const relationTargetTypeByAction = {
  "relation.create:note": "note",
  "relation.create:todo": "todo",
  "relation.create:calendar": "calendar_event",
} as const;

type JsonObject = Record<string, unknown>;

type PreparedInverse =
  | {
      kind: "record";
      step: IntakeActionStep;
      table: ReversibleRecordTable;
      recordId: string;
      expectedSnapshot: JsonObject;
      expectedFingerprint: string;
    }
  | {
      kind: "archive";
      step: IntakeActionStep;
      documentId: string;
      previousCollectionId: string | null;
      expectedSnapshot: JsonObject;
      expectedFingerprint: string;
    }
  | {
      kind: "relation";
      step: IntakeActionStep;
      relationId: string;
      expectedSnapshot: JsonObject;
      expectedFingerprint: string;
    }
  | {
      kind: "replayed_relation";
      step: IntakeActionStep;
      relationId: string;
      expectedSnapshot: JsonObject;
      expectedFingerprint: string;
    };

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

  const inverses = batch.items
    .flatMap((item) =>
      item.steps
        .filter((step) =>
          ["completed", "undo_conflict"].includes(step.status),
        )
        .map((step) => prepareInverse(item, step)),
    )
    .sort(
      (left, right) =>
        right.step.sequence - left.step.sequence ||
        String(right.step.completedAt ?? "").localeCompare(
          String(left.step.completedAt ?? ""),
        ) ||
        right.step.id.localeCompare(left.step.id),
    );

  if (batch.status !== "undoing") {
    if (!["completed", "partial"].includes(batch.status)) {
      throw new Error("INTAKE_BATCH_NOT_UNDOABLE");
    }
    await dependencies.repository.beginUndo(ownerId, batchId);
  }

  let hasConflict = false;
  for (const inverse of inverses) {
    const outcome = await applyInverse(
      ownerId,
      inverse,
      dependencies.repository,
    );
    if (outcome === "conflict") hasConflict = true;
  }

  return dependencies.repository.finishUndo(
    ownerId,
    batchId,
    hasConflict ? "partial" : "undone",
  );
}

async function applyInverse(
  ownerId: string,
  inverse: PreparedInverse,
  repository: IntakeRepository,
): Promise<UndoStepResult | "undone"> {
  const mutation = stepMutation(ownerId, inverse.step);
  if (inverse.kind === "replayed_relation") {
    return repository.markReplayedRelationUndone({
      ...mutation,
      relationId: inverse.relationId,
      expectedSnapshot: inverse.expectedSnapshot,
      expectedFingerprint: inverse.expectedFingerprint,
    });
  }
  if (inverse.kind === "record") {
    return repository.undoRecordStep({
      ...mutation,
      table: inverse.table,
      recordId: inverse.recordId,
      expectedSnapshot: inverse.expectedSnapshot,
      expectedFingerprint: inverse.expectedFingerprint,
    });
  }
  if (inverse.kind === "archive") {
    return repository.undoArchiveStep({
      ...mutation,
      documentId: inverse.documentId,
      previousCollectionId: inverse.previousCollectionId,
      expectedSnapshot: inverse.expectedSnapshot,
      expectedFingerprint: inverse.expectedFingerprint,
    });
  }
  return repository.undoRelationStep({
    ...mutation,
    relationId: inverse.relationId,
    expectedSnapshot: inverse.expectedSnapshot,
    expectedFingerprint: inverse.expectedFingerprint,
  });
}

function prepareInverse(
  item: IntakeItem,
  step: IntakeActionStep,
): PreparedInverse {
  const forward = requireRecord(step.forwardResult);
  if (step.inverseAction === null && step.inverseInput === null) {
    if (
      reversibleRelationActions.has(step.actionName) &&
      forward.replayed === true
    ) {
      const relationId = requireString(forward.id);
      const expected = readExpectedState(forward, step);
      requireRelationSnapshot(
        expected.snapshot,
        step.actionName,
        relationId,
        item.documentId,
      );
      return {
        kind: "replayed_relation",
        step,
        relationId,
        expectedSnapshot: expected.snapshot,
        expectedFingerprint: expected.fingerprint,
      };
    }
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  if (!step.inverseAction || !step.inverseInput) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }

  const expected = readExpectedState(forward, step);
  if (step.inverseAction === "record.delete") {
    const table = recordTable(step.actionName);
    if (step.inverseInput.table !== table) {
      throw new Error("INVALID_INTAKE_INVERSE");
    }
    const recordId = exactReceiptId(forward, step.inverseInput);
    requireExpectedTargetId(expected.snapshot, recordId);
    return {
      kind: "record",
      step,
      table,
      recordId,
      expectedSnapshot: expected.snapshot,
      expectedFingerprint: expected.fingerprint,
    };
  }
  if (step.inverseAction === "archive.restore") {
    if (step.actionName !== "archive") {
      throw new Error("INVALID_INTAKE_INVERSE");
    }
    const documentId = requireString(step.inverseInput.documentId);
    if (documentId !== item.documentId) {
      throw new Error("INVALID_INTAKE_INVERSE");
    }
    if (
      !Object.prototype.hasOwnProperty.call(
        step.inverseInput,
        "previousCollectionId",
      )
    ) {
      throw new Error("INVALID_INTAKE_INVERSE");
    }
    requireArchiveSnapshot(forward, expected.snapshot, documentId);
    return {
      kind: "archive",
      step,
      documentId,
      previousCollectionId: readNullableString(
        step.inverseInput.previousCollectionId,
      ),
      expectedSnapshot: expected.snapshot,
      expectedFingerprint: expected.fingerprint,
    };
  }
  if (
    step.inverseAction === "relation.delete" &&
    reversibleRelationActions.has(step.actionName) &&
    forward.replayed === false
  ) {
    const relationId = exactReceiptId(forward, step.inverseInput);
    requireRelationSnapshot(
      expected.snapshot,
      step.actionName,
      relationId,
      item.documentId,
    );
    return {
      kind: "relation",
      step,
      relationId,
      expectedSnapshot: expected.snapshot,
      expectedFingerprint: expected.fingerprint,
    };
  }
  throw new Error("INVALID_INTAKE_INVERSE");
}

function readExpectedState(
  forward: JsonObject,
  step: IntakeActionStep,
): { snapshot: JsonObject; fingerprint: string } {
  const expected = requireRecord(forward.postActionSnapshot);
  const normalized = requireRecord(normalizeFingerprintValue(expected));
  const fingerprint = requireString(step.conflictFingerprint);
  if (fingerprintRecord(normalized) !== fingerprint) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  return { snapshot: normalized, fingerprint };
}

function recordTable(actionName: string): ReversibleRecordTable {
  if (actionName in recordTableByAction) {
    return recordTableByAction[
      actionName as keyof typeof recordTableByAction
    ];
  }
  throw new Error("INVALID_INTAKE_INVERSE");
}

function exactReceiptId(
  forward: JsonObject,
  inverse: JsonObject,
): string {
  const forwardId = requireString(forward.id);
  const inverseId = requireString(inverse.id);
  if (forwardId !== inverseId) throw new Error("INVALID_INTAKE_INVERSE");
  return forwardId;
}

function requireExpectedTargetId(
  expectedSnapshot: JsonObject,
  targetId: string,
): void {
  if (requireString(expectedSnapshot.id) !== targetId) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
}

function requireArchiveSnapshot(
  forward: JsonObject,
  expectedSnapshot: JsonObject,
  documentId: string,
): void {
  requireExpectedTargetId(expectedSnapshot, documentId);
  const collectionId = requireString(expectedSnapshot.collection_id);
  if (requireString(forward.collectionId) !== collectionId) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
}

function requireRelationSnapshot(
  expectedSnapshot: JsonObject,
  actionName: string,
  relationId: string,
  documentId: string,
): void {
  requireExpectedTargetId(expectedSnapshot, relationId);
  if (
    expectedSnapshot.source_type !== "knowledge_document" ||
    requireString(expectedSnapshot.source_id) !== documentId ||
    expectedSnapshot.target_type !== relationTargetType(actionName) ||
    !requireString(expectedSnapshot.target_id) ||
    expectedSnapshot.relation_type !== "source_of" ||
    expectedSnapshot.creator !== "assistant"
  ) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  requireConfidence(expectedSnapshot.confidence);
}

function relationTargetType(actionName: string): string {
  if (actionName in relationTargetTypeByAction) {
    return relationTargetTypeByAction[
      actionName as keyof typeof relationTargetTypeByAction
    ];
  }
  throw new Error("INVALID_INTAKE_INVERSE");
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

function requireConfidence(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error("INVALID_INTAKE_INVERSE");
  }
  return value;
}
