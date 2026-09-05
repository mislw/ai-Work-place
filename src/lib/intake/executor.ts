import { randomUUID } from "node:crypto";

import type { WorkbenchAction } from "@/lib/assistant/actions";
import {
  workspaceIntakePlanV1Schema,
  type IntakeActionStep,
  type WorkspaceIntakePlanV1,
} from "@/lib/intake/contracts";
import { fingerprintRecord } from "@/lib/intake/fingerprint";
import type {
  IntakeRepository,
  PendingStepInput,
} from "@/lib/intake/repository";

const LEASE_SECONDS = 120;
const ACTION_ORDER: Record<
  WorkspaceIntakePlanV1["actions"][number]["kind"],
  number
> = {
  archive: 0,
  "note.create": 1,
  "todo.create": 2,
  "calendar.create": 3,
};

type JsonObject = Record<string, unknown>;
type CreateActionKind = Exclude<
  WorkspaceIntakePlanV1["actions"][number]["kind"],
  "archive"
>;
type RelationTargetType = "note" | "todo" | "calendar_event";

export interface IntakeKnowledgeDocument {
  id: string;
  collectionId: string | null;
  [key: string]: unknown;
}

export interface IntakeRelationInput {
  ownerId: string;
  source_type: "knowledge_document";
  source_id: string;
  target_type: RelationTargetType;
  target_id: string;
  relation_type: "source_of";
  creator: "assistant";
  confidence: number;
}

export interface IntakeExecutorDependencies {
  repository: IntakeRepository;
  getKnowledgeDocument(
    ownerId: string,
    documentId: string,
  ): Promise<IntakeKnowledgeDocument | null>;
  archiveDocument(input: {
    ownerId: string;
    documentId: string;
    collectionName: string;
    collectionKind?: "project" | "area" | "resource" | "archive";
  }): Promise<{
    result: JsonObject;
    updatedDocument: JsonObject;
  }>;
  executeAction(
    ownerId: string,
    action: WorkbenchAction,
    requestId: string,
  ): Promise<{ result: unknown; replayed: boolean }>;
  createRelation(input: IntakeRelationInput): Promise<{
    result: JsonObject;
    replayed: boolean;
  }>;
}

export interface ExecuteIntakePlanInput {
  ownerId: string;
  batchId: string;
  itemId: string;
  documentId: string;
  workerId: string;
  signal: AbortSignal;
  plan: WorkspaceIntakePlanV1;
}

interface PlannedStep extends PendingStepInput {
  id: string;
}

export function classifyIntakeAction(
  action: WorkspaceIntakePlanV1["actions"][number],
): "automatic" | "blocked" {
  return ["archive", "note.create", "todo.create", "calendar.create"].includes(
    String((action as { kind?: unknown }).kind),
  )
    ? "automatic"
    : "blocked";
}

export async function executeIntakePlan(
  input: ExecuteIntakePlanInput,
  dependencies: IntakeExecutorDependencies,
): Promise<void> {
  rejectUnsafeActions(input.plan);
  const parsed = workspaceIntakePlanV1Schema.safeParse(input.plan);
  if (!parsed.success) throw new Error("INVALID_HERMES_PLAN");
  if (
    parsed.data.documentId !== input.documentId ||
    input.plan.documentId !== input.documentId
  ) {
    throw new Error("PLAN_DOCUMENT_MISMATCH");
  }
  throwIfAborted(input.signal);

  const document = await dependencies.getKnowledgeDocument(
    input.ownerId,
    input.documentId,
  );
  throwIfAborted(input.signal);
  if (!document || document.id !== input.documentId) {
    throw new Error("INTAKE_DOCUMENT_NOT_OWNED");
  }

  const batch = await dependencies.repository.getBatch(
    input.ownerId,
    input.batchId,
  );
  throwIfAborted(input.signal);
  const item = batch?.items.find((candidate) => candidate.id === input.itemId);
  if (!item || item.documentId && item.documentId !== input.documentId) {
    throw new Error("INTAKE_ITEM_NOT_FOUND");
  }

  const steps = buildPlannedSteps(
    parsed.data,
    input.documentId,
    document.collectionId,
    item.steps,
  );
  await checkLease(input, dependencies.repository);
  await dependencies.repository.replacePendingSteps({
    ownerId: input.ownerId,
    batchId: input.batchId,
    itemId: input.itemId,
    workerId: input.workerId,
    steps: steps
      .filter((step) => !isCompleted(item.steps, step.sequence))
      .map(toPendingStep),
  });
  throwIfAborted(input.signal);

  const completed = new Map<number, IntakeActionStep>();
  for (const step of item.steps) {
    if (step.status === "completed") completed.set(step.sequence, step);
  }

  for (const step of steps) {
    const prior = completed.get(step.sequence);
    if (prior) continue;
    throwIfAborted(input.signal);

    try {
      const receipt = step.actionName === "archive"
        ? await executeArchiveStep(input, step, dependencies)
        : step.actionName.startsWith("relation.create:")
          ? await executeRelationStep(input, step, completed, dependencies)
          : await executeCreateStep(input, step, dependencies);

      await checkLease(input, dependencies.repository);
      await dependencies.repository.markStepCompleted({
        ownerId: input.ownerId,
        itemId: input.itemId,
        workerId: input.workerId,
        stepId: step.id,
        forwardResult: receipt.forwardResult,
        inverseAction: receipt.inverseAction,
        inverseInput: receipt.inverseInput,
        conflictFingerprint: receipt.conflictFingerprint,
      });
      throwIfAborted(input.signal);
      completed.set(step.sequence, {
        ...asActionStep(step, input),
        status: "completed",
        forwardResult: receipt.forwardResult,
        inverseAction: receipt.inverseAction,
        inverseInput: receipt.inverseInput,
        conflictFingerprint: receipt.conflictFingerprint,
      });
    } catch (error) {
      if (isAbortError(error) || isLeaseLost(error)) throw error;
      await checkLease(input, dependencies.repository);
      await dependencies.repository.markStepFailed({
        ownerId: input.ownerId,
        itemId: input.itemId,
        workerId: input.workerId,
        stepId: step.id,
        errorCode: "EXECUTION_FAILED",
      });
      await checkLease(input, dependencies.repository);
      await dependencies.repository.setItemDecision({
        ownerId: input.ownerId,
        itemId: input.itemId,
        workerId: input.workerId,
        status: "partial",
        confidence: parsed.data.confidence,
        decisionSummary: parsed.data.summary,
        invalidPlanCount: item.invalidPlanCount,
        errorCode: "EXECUTION_FAILED",
      });
      return;
    }
  }

  await checkLease(input, dependencies.repository);
  await dependencies.repository.setItemDecision({
    ownerId: input.ownerId,
    itemId: input.itemId,
    workerId: input.workerId,
    status: "completed",
    confidence: parsed.data.confidence,
    decisionSummary: parsed.data.summary,
    invalidPlanCount: item.invalidPlanCount,
    errorCode: null,
  });
}

function rejectUnsafeActions(plan: unknown): void {
  const actions = isRecord(plan) && Array.isArray(plan.actions)
    ? plan.actions
    : [];
  if (
    actions.some(
      (action) =>
        !isRecord(action) ||
        classifyIntakeAction(action as never) === "blocked",
    )
  ) {
    throw new Error("UNSAFE_INTAKE_ACTION");
  }
}

function buildPlannedSteps(
  plan: WorkspaceIntakePlanV1,
  documentId: string,
  previousCollectionId: string | null,
  existingSteps: IntakeActionStep[],
): PlannedStep[] {
  const existingBySequence = new Map(
    existingSteps.map((step) => [step.sequence, step]),
  );
  const sortedActions = plan.actions
    .map((action, index) => ({ action, index }))
    .sort(
      (left, right) =>
        ACTION_ORDER[left.action.kind] - ACTION_ORDER[right.action.kind] ||
        left.index - right.index,
    );
  const steps: PlannedStep[] = [];
  const createSteps: Array<{
    sequence: number;
    kind: CreateActionKind;
  }> = [];

  for (const { action } of sortedActions) {
    const sequence = steps.length;
    const existing = existingBySequence.get(sequence);
    const hasPersistedArchiveOrigin =
      existing !== undefined &&
      Object.prototype.hasOwnProperty.call(
        existing.forwardInput,
        "previousCollectionId",
      );
    const forwardInput =
      action.kind === "archive"
        ? {
            documentId,
            collectionName: action.collectionName,
            ...(action.collectionKind
              ? { collectionKind: action.collectionKind }
              : {}),
            previousCollectionId: hasPersistedArchiveOrigin
              ? readNullableString(
                  existing.forwardInput.previousCollectionId,
                )
              : previousCollectionId,
          }
        : action.input;
    steps.push({
      id: existing?.id ?? randomUUID(),
      sequence,
      actionName: action.kind,
      forwardInput,
      inverseAction: null,
      inverseInput: null,
      conflictFingerprint: null,
      confidence: plan.confidence,
    });
    if (action.kind !== "archive") {
      createSteps.push({ sequence, kind: action.kind });
    }
  }

  for (const source of createSteps) {
    const sequence = steps.length;
    const targetType = relationTargetType(source.kind);
    const existing = existingBySequence.get(sequence);
    steps.push({
      id: existing?.id ?? randomUUID(),
      sequence,
      actionName: `relation.create:${targetType}`,
      forwardInput: {
        documentId,
        sourceActionSequence: source.sequence,
        targetType,
      },
      inverseAction: null,
      inverseInput: null,
      conflictFingerprint: null,
      confidence: plan.confidence,
    });
  }

  for (const step of existingSteps) {
    const planned = steps[step.sequence];
    if (
      step.status === "completed" &&
      (!planned || planned.actionName !== step.actionName)
    ) {
      throw new Error("INTAKE_STEP_PLAN_MISMATCH");
    }
  }
  return steps;
}

async function executeArchiveStep(
  input: ExecuteIntakePlanInput,
  step: PlannedStep,
  dependencies: IntakeExecutorDependencies,
) {
  await checkLease(input, dependencies.repository);
  const archived = await dependencies.archiveDocument({
    ownerId: input.ownerId,
    documentId: input.documentId,
    collectionName: requireString(step.forwardInput.collectionName),
    ...(readString(step.forwardInput.collectionKind)
      ? {
          collectionKind: readString(
            step.forwardInput.collectionKind,
          ) as "project" | "area" | "resource" | "archive",
        }
      : {}),
  });
  return {
    forwardResult: { ...archived.result, replayed: false },
    inverseAction: "archive.restore",
    inverseInput: {
      documentId: input.documentId,
      previousCollectionId: readNullableString(
        step.forwardInput.previousCollectionId,
      ),
    },
    conflictFingerprint: fingerprintRecord(archived.updatedDocument),
  };
}

async function executeCreateStep(
  input: ExecuteIntakePlanInput,
  step: PlannedStep,
  dependencies: IntakeExecutorDependencies,
) {
  await checkLease(input, dependencies.repository);
  const action = {
    action: step.actionName,
    input: step.forwardInput,
  } as WorkbenchAction;
  const receipt = await dependencies.executeAction(
    input.ownerId,
    action,
    `intake:${input.batchId}:${input.itemId}:${step.sequence}:${step.actionName}`,
  );
  const created = requireRecord(receipt.result);
  const id = requireString(created.id);
  return {
    forwardResult: { ...created, replayed: receipt.replayed },
    inverseAction: "record.delete",
    inverseInput: {
      table: actionTable(step.actionName as CreateActionKind),
      id,
    },
    conflictFingerprint: fingerprintRecord(created),
  };
}

async function executeRelationStep(
  input: ExecuteIntakePlanInput,
  step: PlannedStep,
  completed: Map<number, IntakeActionStep>,
  dependencies: IntakeExecutorDependencies,
) {
  const sourceSequence = requireInteger(
    step.forwardInput.sourceActionSequence,
  );
  const source = completed.get(sourceSequence);
  if (!source) throw new Error("INTAKE_SOURCE_STEP_INCOMPLETE");
  const targetId = requireString(requireRecord(source.forwardResult).id);
  const targetType = requireRelationTargetType(step.forwardInput.targetType);
  await checkLease(input, dependencies.repository);
  const receipt = await dependencies.createRelation({
    ownerId: input.ownerId,
    source_type: "knowledge_document",
    source_id: input.documentId,
    target_type:
      targetType === "calendar" ? "calendar_event" : targetType,
    target_id: targetId,
    relation_type: "source_of",
    creator: "assistant",
    confidence: step.confidence,
  });
  const relation = requireRecord(receipt.result);
  return {
    forwardResult: { ...relation, replayed: receipt.replayed },
    inverseAction: receipt.replayed ? null : "relation.delete",
    inverseInput: receipt.replayed
      ? null
      : { id: requireString(relation.id) },
    conflictFingerprint: fingerprintRecord(relation),
  };
}

async function checkLease(
  input: ExecuteIntakePlanInput,
  repository: IntakeRepository,
): Promise<void> {
  throwIfAborted(input.signal);
  await repository.renewLease(input.itemId, input.workerId, LEASE_SECONDS);
  throwIfAborted(input.signal);
}

function toPendingStep(step: PlannedStep): PendingStepInput {
  return {
    id: step.id,
    sequence: step.sequence,
    actionName: step.actionName,
    forwardInput: step.forwardInput,
    inverseAction: null,
    inverseInput: null,
    conflictFingerprint: null,
    confidence: step.confidence,
  };
}

function isCompleted(steps: IntakeActionStep[], sequence: number): boolean {
  return steps.some(
    (step) => step.sequence === sequence && step.status === "completed",
  );
}

function relationTargetType(kind: CreateActionKind): "note" | "todo" | "calendar" {
  if (kind === "note.create") return "note";
  if (kind === "todo.create") return "todo";
  return "calendar";
}

function actionTable(kind: CreateActionKind): string {
  if (kind === "note.create") return "notes";
  if (kind === "todo.create") return "todos";
  return "calendar_events";
}

function asActionStep(
  step: PlannedStep,
  input: ExecuteIntakePlanInput,
): IntakeActionStep {
  return {
    ...step,
    batchId: input.batchId,
    itemId: input.itemId,
    forwardResult: null,
    status: "pending",
    errorCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    completedAt: null,
    undoneAt: null,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("INTAKE_CANCELLED");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "INTAKE_LEASE_LOST";
}

function requireRecord(value: unknown): JsonObject {
  if (!isRecord(value)) throw new Error("INVALID_EXECUTION_RESULT");
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("INVALID_EXECUTION_RESULT");
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : readString(value);
}

function requireInteger(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("INVALID_EXECUTION_RESULT");
  }
  return Number(value);
}

function requireRelationTargetType(
  value: unknown,
): "note" | "todo" | "calendar" {
  if (!["note", "todo", "calendar"].includes(String(value))) {
    throw new Error("INVALID_EXECUTION_RESULT");
  }
  return value as "note" | "todo" | "calendar";
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
