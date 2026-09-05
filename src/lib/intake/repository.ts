import { createServiceClient } from "@/lib/supabase/server";
import type {
  CreateIntakeBatchRequest,
  IntakeActionStep,
  IntakeBatch,
  IntakeBatchStatus,
  IntakeItem,
  IntakeItemStatus,
  WorkspacePageContextV1,
} from "@/lib/intake/contracts";
import { getKnowledgeItem } from "@/lib/knowledge/search";

const ACTIVE_BATCH_STATUSES: IntakeBatchStatus[] = [
  "uploading",
  "processing",
  "orchestrating",
  "executing",
  "undoing",
];

const TERMINAL_BATCH_STATUSES: IntakeBatchStatus[] = [
  "completed",
  "partial",
  "failed",
  "cancelled",
  "undone",
];

const CANCELLABLE_ITEM_STATUSES: IntakeItemStatus[] = [
  "waiting_extraction",
  "awaiting_hermes",
  "orchestrating",
  "executing",
];

const STABLE_ERROR_CODES = new Set([
  "HERMES_UNAVAILABLE",
  "INVALID_HERMES_PLAN",
  "PLAN_DOCUMENT_MISMATCH",
  "HERMES_APPROVAL_REQUIRED",
  "HERMES_RUN_TIMEOUT",
  "INTAKE_PROMPT_TOO_LARGE",
  "UNSAFE_INTAKE_ACTION",
  "EXECUTION_FAILED",
  "UNDO_RECORD_CHANGED",
  "UNDO_WINDOW_EXPIRED",
  "INTAKE_CANCELLED",
  "PROCESSING_FAILED",
]);

const BATCH_SELECT = `
  id,
  client_batch_id,
  source_type,
  page_context,
  status,
  summary,
  error_code,
  created_at,
  updated_at,
  completed_at,
  undone_at,
  items:workspace_intake_items (
    id,
    batch_id,
    asset_id,
    document_id,
    job_id,
    hermes_run_id,
    status,
    confidence,
    decision_summary,
    error_code,
    attempt_count,
    invalid_plan_count,
    available_at,
    lease_owner,
    lease_expires_at,
    created_at,
    updated_at,
    completed_at,
    steps:workspace_action_steps (
      id,
      batch_id,
      item_id,
      sequence,
      action_name,
      forward_input,
      forward_result,
      inverse_action,
      inverse_input,
      conflict_fingerprint,
      status,
      confidence,
      error_code,
      created_at,
      updated_at,
      completed_at,
      undone_at
    )
  )
`;

type JsonObject = Record<string, unknown>;

const reversibleTables = {
  notes: "note",
  todos: "todo",
  calendar_events: "calendar_event",
} as const;

export type ReversibleRecordTable = keyof typeof reversibleTables;

export interface ClaimedIntakeItem extends Omit<IntakeItem, "steps"> {
  ownerId: string;
  pageContext: WorkspacePageContextV1;
}

export interface SetItemDecisionInput {
  ownerId: string;
  itemId: string;
  workerId: string;
  status: IntakeItemStatus;
  confidence: number | null;
  decisionSummary: string | null;
  invalidPlanCount: number;
  errorCode?: string | null;
}

export interface AttachHermesCorrectionRunInput {
  ownerId: string;
  itemId: string;
  workerId: string;
  runId: string;
  invalidPlanCount: number;
}

export interface PendingStepInput {
  id?: string;
  sequence: number;
  actionName: string;
  forwardInput: JsonObject;
  inverseAction: string | null;
  inverseInput: JsonObject | null;
  conflictFingerprint: string | null;
  confidence: number;
}

export interface ReplacePendingStepsInput {
  ownerId: string;
  batchId: string;
  itemId: string;
  workerId: string;
  steps: PendingStepInput[];
}

export interface CompletedStepInput {
  ownerId: string;
  itemId: string;
  workerId: string;
  stepId: string;
  forwardResult: unknown;
  inverseAction: string | null;
  inverseInput: JsonObject | null;
  conflictFingerprint: string | null;
}

export interface FailedStepInput {
  ownerId: string;
  itemId: string;
  workerId: string;
  stepId: string;
  errorCode: string;
}

export interface ReleaseIntakeItemInput {
  ownerId: string;
  itemId: string;
  workerId: string;
  status: IntakeItemStatus;
  errorCode: string | null;
  availableAt: string;
}

export interface OwnerScopedRecordInput {
  ownerId: string;
  id: string;
}

export interface ReversibleRecordInput extends OwnerScopedRecordInput {
  table: ReversibleRecordTable;
}

export interface RestoreKnowledgeDocumentInput
  extends OwnerScopedRecordInput {
  collectionId: string | null;
}

export interface UndoStepInput {
  ownerId: string;
  batchId: string;
  itemId: string;
  stepId: string;
}

export interface UndoConflictStepInput extends UndoStepInput {
  errorCode: "UNDO_RECORD_CHANGED";
}

export interface ClearExpiredUndoDataInput {
  ownerId: string;
  batchId: string;
}

export interface IntakeRepository {
  registerBatch(
    ownerId: string,
    request: CreateIntakeBatchRequest,
  ): Promise<IntakeBatch>;
  listActiveAndRecent(
    ownerId: string,
    recentLimit: number,
  ): Promise<IntakeBatch[]>;
  getBatch(ownerId: string, batchId: string): Promise<IntakeBatch | null>;
  claimNextItem(
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedIntakeItem | null>;
  renewLease(
    itemId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<void>;
  attachHermesRun(
    itemId: string,
    workerId: string,
    runId: string,
  ): Promise<void>;
  attachHermesCorrectionRun(
    input: AttachHermesCorrectionRunInput,
  ): Promise<void>;
  setItemDecision(input: SetItemDecisionInput): Promise<void>;
  replacePendingSteps(input: ReplacePendingStepsInput): Promise<void>;
  markStepCompleted(input: CompletedStepInput): Promise<void>;
  markStepFailed(input: FailedStepInput): Promise<void>;
  releaseItem(input: ReleaseIntakeItemInput): Promise<void>;
  retryFailed(ownerId: string, batchId: string): Promise<IntakeBatch>;
  cancel(ownerId: string, batchId: string): Promise<IntakeBatch>;
  beginUndo(ownerId: string, batchId: string): Promise<IntakeBatch>;
  loadReversibleRecord(
    input: ReversibleRecordInput,
  ): Promise<JsonObject | null>;
  deleteReversibleRecord(input: ReversibleRecordInput): Promise<void>;
  loadKnowledgeDocumentForUndo(
    input: OwnerScopedRecordInput,
  ): Promise<JsonObject | null>;
  restoreKnowledgeDocumentCollection(
    input: RestoreKnowledgeDocumentInput,
  ): Promise<void>;
  loadRelationForUndo(
    input: OwnerScopedRecordInput,
  ): Promise<JsonObject | null>;
  deleteRelationForUndo(input: OwnerScopedRecordInput): Promise<void>;
  markStepUndone(input: UndoStepInput): Promise<void>;
  markStepUndoConflict(input: UndoConflictStepInput): Promise<void>;
  finishUndo(
    ownerId: string,
    batchId: string,
    status?: "undone" | "partial",
  ): Promise<IntakeBatch>;
  clearExpiredUndoData(input: ClearExpiredUndoDataInput): Promise<void>;
}

export function getIntakeRepository(): IntakeRepository {
  const client = createServiceClient();

  async function getBatch(
    ownerId: string,
    batchId: string,
  ): Promise<IntakeBatch | null> {
    const { data, error } = await client
      .from("workspace_intake_batches")
      .select(BATCH_SELECT)
      .eq("user_id", ownerId)
      .eq("id", batchId)
      .maybeSingle();
    throwIfError(error);
    return data ? mapBatch(asRow(data)) : null;
  }

  async function requireBatch(ownerId: string, batchId: string) {
    const batch = await getBatch(ownerId, batchId);
    if (!batch) throw new Error("INTAKE_BATCH_NOT_FOUND");
    return batch;
  }

  return {
    async registerBatch(ownerId, request) {
      const { data, error } = await client.rpc(
        "register_workspace_intake_batch",
        {
          p_user_id: ownerId,
          p_client_batch_id: request.clientBatchId,
          p_source_type: request.sourceType,
          p_page_context: request.pageContext,
          p_items: request.items.map((item) => ({
            assetId: item.assetId,
            documentId: item.documentId,
            jobId: item.jobId,
          })),
        },
      );
      throwIfError(error);
      const row = Array.isArray(data) ? data[0] : data;
      const batchId = row ? String(asRow(row).batch_id ?? "") : "";
      if (!batchId) throw new Error("INTAKE_BATCH_REGISTRATION_EMPTY");
      return requireBatch(ownerId, batchId);
    },

    async listActiveAndRecent(ownerId, recentLimit) {
      const activeQuery = client
        .from("workspace_intake_batches")
        .select(BATCH_SELECT)
        .eq("user_id", ownerId)
        .in("status", ACTIVE_BATCH_STATUSES)
        .order("created_at", { ascending: false });
      const recentQuery = client
        .from("workspace_intake_batches")
        .select(BATCH_SELECT)
        .eq("user_id", ownerId)
        .in("status", TERMINAL_BATCH_STATUSES)
        .order("created_at", { ascending: false })
        .limit(Math.max(0, Math.min(100, Math.trunc(recentLimit))));
      const [activeResult, recentResult] = await Promise.all([
        activeQuery,
        recentQuery,
      ]);
      throwIfError(activeResult.error);
      throwIfError(recentResult.error);

      const batches = [
        ...asRows(activeResult.data),
        ...asRows(recentResult.data),
      ].map(mapBatch);
      return [
        ...new Map(batches.map((batch) => [batch.id, batch])).values(),
      ];
    },

    getBatch,

    async claimNextItem(workerId, leaseSeconds) {
      const { data, error } = await client.rpc(
        "claim_workspace_intake_item",
        {
          p_worker_id: workerId,
          p_lease_seconds: leaseSeconds,
        },
      );
      throwIfError(error);
      const row = Array.isArray(data) ? data[0] : data;
      return row ? mapClaimedItem(asRow(row)) : null;
    },

    async renewLease(itemId, workerId, leaseSeconds) {
      const leaseExpiresAt = new Date(
        Date.now() + Math.max(30, leaseSeconds) * 1_000,
      ).toISOString();
      const { data, error } = await client
        .from("workspace_intake_items")
        .update({ lease_expires_at: leaseExpiresAt })
        .eq("id", itemId)
        .eq("lease_owner", workerId)
        .in("status", ["orchestrating", "executing"])
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_LEASE_LOST");
    },

    async attachHermesRun(itemId, workerId, runId) {
      const { data, error } = await client
        .from("workspace_intake_items")
        .update({ hermes_run_id: runId, status: "orchestrating" })
        .eq("id", itemId)
        .eq("lease_owner", workerId)
        .in("status", ["awaiting_hermes", "orchestrating"])
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_LEASE_LOST");
    },

    async attachHermesCorrectionRun(input) {
      const { data, error } = await client.rpc(
        "attach_workspace_intake_correction_run",
        {
          p_user_id: input.ownerId,
          p_item_id: input.itemId,
          p_worker_id: input.workerId,
          p_run_id: input.runId,
          p_invalid_plan_count: input.invalidPlanCount,
        },
      );
      throwIfError(error);
      if (!data) throw new Error("INTAKE_LEASE_LOST");
    },

    async setItemDecision(input) {
      const { data, error } = await client.rpc(
        "set_workspace_intake_item_decision",
        {
          p_user_id: input.ownerId,
          p_item_id: input.itemId,
          p_worker_id: input.workerId,
          p_status: input.status,
          p_confidence: input.confidence,
          p_decision_summary: input.decisionSummary,
          p_invalid_plan_count: input.invalidPlanCount,
          p_error_code: stableErrorCode(input.errorCode),
        },
      );
      throwIfError(error);
      if (!data) throw new Error("INTAKE_LEASE_LOST");
    },

    async replacePendingSteps(input) {
      const { error } = await client.rpc(
        "replace_workspace_intake_pending_steps",
        {
          p_user_id: input.ownerId,
          p_batch_id: input.batchId,
          p_item_id: input.itemId,
          p_worker_id: input.workerId,
          p_steps: input.steps.map((step) => ({
            ...(step.id ? { id: step.id } : {}),
            sequence: step.sequence,
            actionName: step.actionName,
            forwardInput: step.forwardInput,
            inverseAction: step.inverseAction,
            inverseInput: step.inverseInput,
            conflictFingerprint: step.conflictFingerprint,
            confidence: step.confidence,
          })),
        },
      );
      throwIfError(error);
    },

    async markStepCompleted(input) {
      const { error } = await client.rpc("complete_workspace_intake_step", {
        p_user_id: input.ownerId,
        p_item_id: input.itemId,
        p_step_id: input.stepId,
        p_worker_id: input.workerId,
        p_forward_result: input.forwardResult,
        p_inverse_action: input.inverseAction,
        p_inverse_input: input.inverseInput,
        p_conflict_fingerprint: input.conflictFingerprint,
      });
      throwIfError(error);
    },

    async markStepFailed(input) {
      const { error } = await client.rpc("fail_workspace_intake_step", {
        p_user_id: input.ownerId,
        p_item_id: input.itemId,
        p_step_id: input.stepId,
        p_worker_id: input.workerId,
        p_error_code: stableErrorCode(input.errorCode),
      });
      throwIfError(error);
    },

    async releaseItem(input) {
      const terminal = ["completed", "partial", "failed"].includes(
        input.status,
      );
      const { data, error } = await client
        .from("workspace_intake_items")
        .update({
          status: input.status,
          available_at: input.availableAt,
          lease_owner: null,
          lease_expires_at: null,
          error_code: stableErrorCode(input.errorCode),
          completed_at: terminal ? new Date().toISOString() : null,
        })
        .eq("id", input.itemId)
        .eq("user_id", input.ownerId)
        .eq("lease_owner", input.workerId)
        .in("status", CANCELLABLE_ITEM_STATUSES)
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_LEASE_LOST");
    },

    async retryFailed(ownerId, batchId) {
      const { data, error } = await client.rpc(
        "retry_workspace_intake_batch",
        {
          p_user_id: ownerId,
          p_batch_id: batchId,
        },
      );
      throwIfError(error);
      if (!data) throw new Error("INTAKE_BATCH_NOT_RETRYABLE");
      return requireBatch(ownerId, batchId);
    },

    async cancel(ownerId, batchId) {
      const { data, error } = await client.rpc(
        "cancel_workspace_intake_batch",
        {
          p_user_id: ownerId,
          p_batch_id: batchId,
        },
      );
      throwIfError(error);
      if (!data) throw new Error("INTAKE_BATCH_NOT_CANCELLABLE");
      return requireBatch(ownerId, batchId);
    },

    async beginUndo(ownerId, batchId) {
      const { data, error } = await client
        .from("workspace_intake_batches")
        .update({
          status: "undoing",
          error_code: null,
          undone_at: null,
        })
        .eq("user_id", ownerId)
        .eq("id", batchId)
        .in("status", ["completed", "partial"])
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_BATCH_NOT_UNDOABLE");
      return requireBatch(ownerId, batchId);
    },

    async loadReversibleRecord(input) {
      const { data, error } = await client
        .from(input.table)
        .select("*")
        .eq("id", input.id)
        .eq("user_id", input.ownerId)
        .maybeSingle();
      throwIfError(error);
      return data ? asRow(data) : null;
    },

    async deleteReversibleRecord(input) {
      const { error } = await client
        .from(input.table)
        .delete()
        .eq("id", input.id)
        .eq("user_id", input.ownerId);
      throwIfError(error);
    },

    async loadKnowledgeDocumentForUndo(input) {
      return getKnowledgeItem(input.ownerId, input.id);
    },

    async restoreKnowledgeDocumentCollection(input) {
      const { error } = await client
        .from("knowledge_documents")
        .update({ collection_id: input.collectionId })
        .eq("id", input.id)
        .eq("user_id", input.ownerId);
      throwIfError(error);
    },

    async loadRelationForUndo(input) {
      const { data, error } = await client
        .from("knowledge_relations")
        .select("*")
        .eq("id", input.id)
        .eq("user_id", input.ownerId)
        .maybeSingle();
      throwIfError(error);
      return data ? asRow(data) : null;
    },

    async deleteRelationForUndo(input) {
      const { error } = await client
        .from("knowledge_relations")
        .delete()
        .eq("id", input.id)
        .eq("user_id", input.ownerId);
      throwIfError(error);
    },

    async markStepUndone(input) {
      const { data, error } = await client
        .from("workspace_action_steps")
        .update({
          status: "undone",
          error_code: null,
          undone_at: new Date().toISOString(),
        })
        .eq("id", input.stepId)
        .eq("user_id", input.ownerId)
        .eq("batch_id", input.batchId)
        .eq("item_id", input.itemId)
        .in("status", ["completed", "undo_conflict"])
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_STEP_NOT_UNDOABLE");
    },

    async markStepUndoConflict(input) {
      const { data, error } = await client
        .from("workspace_action_steps")
        .update({
          status: "undo_conflict",
          error_code: stableErrorCode(input.errorCode),
          undone_at: null,
        })
        .eq("id", input.stepId)
        .eq("user_id", input.ownerId)
        .eq("batch_id", input.batchId)
        .eq("item_id", input.itemId)
        .in("status", ["completed", "undo_conflict"])
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_STEP_NOT_UNDOABLE");
    },

    async finishUndo(ownerId, batchId, status = "undone") {
      const { data, error } = await client
        .from("workspace_intake_batches")
        .update({
          status,
          error_code: status === "partial" ? "UNDO_RECORD_CHANGED" : null,
          undone_at: new Date().toISOString(),
        })
        .eq("user_id", ownerId)
        .eq("id", batchId)
        .eq("status", "undoing")
        .select("id")
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("INTAKE_BATCH_NOT_UNDOING");
      return requireBatch(ownerId, batchId);
    },

    async clearExpiredUndoData(input) {
      const { error } = await client
        .from("workspace_action_steps")
        .update({
          inverse_input: null,
          conflict_fingerprint: null,
        })
        .eq("user_id", input.ownerId)
        .eq("batch_id", input.batchId);
      throwIfError(error);
    },
  };
}

function mapBatch(row: Record<string, unknown>): IntakeBatch {
  const itemRows = asRows(row.items ?? row.workspace_intake_items);
  return {
    id: String(row.id),
    clientBatchId: String(row.client_batch_id),
    sourceType: String(row.source_type) as IntakeBatch["sourceType"],
    pageContext: row.page_context as WorkspacePageContextV1,
    status: String(row.status) as IntakeBatchStatus,
    summary: nullableString(row.summary),
    errorCode: nullableString(row.error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
    undoneAt: nullableString(row.undone_at),
    items: itemRows.map(mapItem),
  };
}

function mapItem(row: Record<string, unknown>): IntakeItem {
  const stepRows = asRows(row.steps ?? row.workspace_action_steps);
  return {
    ...mapItemFields(row),
    steps: stepRows.map(mapStep),
  };
}

function mapClaimedItem(row: Record<string, unknown>): ClaimedIntakeItem {
  return {
    ...mapItemFields(row),
    ownerId: String(row.user_id),
    pageContext: row.page_context as WorkspacePageContextV1,
  };
}

function mapItemFields(row: Record<string, unknown>): Omit<IntakeItem, "steps"> {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    assetId: String(row.asset_id),
    documentId: String(row.document_id),
    jobId: String(row.job_id),
    hermesRunId: nullableString(row.hermes_run_id),
    status: String(row.status) as IntakeItemStatus,
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    decisionSummary: nullableString(row.decision_summary),
    errorCode: nullableString(row.error_code),
    attemptCount: Number(row.attempt_count),
    invalidPlanCount: Number(row.invalid_plan_count),
    availableAt: String(row.available_at),
    leaseOwner: nullableString(row.lease_owner),
    leaseExpiresAt: nullableString(row.lease_expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
  };
}

function mapStep(row: Record<string, unknown>): IntakeActionStep {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    itemId: String(row.item_id),
    sequence: Number(row.sequence),
    actionName: String(row.action_name),
    forwardInput: asRow(row.forward_input),
    forwardResult: row.forward_result ?? null,
    inverseAction: nullableString(row.inverse_action),
    inverseInput:
      row.inverse_input === null || row.inverse_input === undefined
        ? null
        : asRow(row.inverse_input),
    conflictFingerprint: nullableString(row.conflict_fingerprint),
    status: String(row.status) as IntakeActionStep["status"],
    confidence: Number(row.confidence),
    errorCode: nullableString(row.error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: nullableString(row.completed_at),
    undoneAt: nullableString(row.undone_at),
  };
}

function stableErrorCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return STABLE_ERROR_CODES.has(value) ? value : "PROCESSING_FAILED";
}

function throwIfError(error: { message: string } | null | undefined): void {
  if (error) throw new Error(error.message);
}

function asRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
