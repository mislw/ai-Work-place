// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceClient, from, rpc } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import {
  getIntakeRepository,
  type CompletedStepInput,
  type FailedStepInput,
  type ReleaseIntakeItemInput,
  type ReplacePendingStepsInput,
  type SetItemDecisionInput,
} from "@/lib/intake/repository";
import type { CreateIntakeBatchRequest } from "@/lib/intake/contracts";

type QueryResult = {
  data?: unknown;
  error?: { message: string } | null;
};

type QueryFilter = {
  kind: "eq" | "in";
  column: string;
  value: unknown;
};

type QueryRecord = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: QueryFilter[];
  limit?: number;
};

const queryResults: QueryResult[] = [];
const queryRecords: QueryRecord[] = [];

describe("owner-scoped intake repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResults.length = 0;
    queryRecords.length = 0;
    from.mockImplementation((table: string) => createQuery(table));
    rpc.mockImplementation(() =>
      Promise.resolve(queryResults.shift() ?? { data: null, error: null }),
    );
    createServiceClient.mockReturnValue({ from, rpc });
  });

  it("loads a batch with owner and batch id on the same query", async () => {
    queryResults.push({ data: batchRow(), error: null });

    const result = await getIntakeRepository().getBatch("owner-1", "batch-1");

    expect(queryRecords).toHaveLength(1);
    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_batches",
      operation: "select",
      filters: [
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "id", value: "batch-1" },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: "batch-1",
        clientBatchId: "client-batch-1",
        items: [
          expect.objectContaining({
            id: "item-1",
            steps: [
              expect.objectContaining({
                id: "step-1",
                actionName: "note.create",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("lists active and recent batches with an owner filter on each query", async () => {
    queryResults.push(
      { data: [batchRow({ id: "active-1", status: "processing" })], error: null },
      { data: [batchRow({ id: "recent-1", status: "completed" })], error: null },
    );

    const result = await getIntakeRepository().listActiveAndRecent("owner-1", 2);

    expect(queryRecords).toHaveLength(2);
    for (const query of queryRecords) {
      expect(query.table).toBe("workspace_intake_batches");
      expect(query.filters).toContainEqual({
        kind: "eq",
        column: "user_id",
        value: "owner-1",
      });
    }
    expect(queryRecords[0]!.filters).toContainEqual({
      kind: "in",
      column: "status",
      value: expect.arrayContaining(["processing", "orchestrating", "executing"]),
    });
    expect(queryRecords[1]).toMatchObject({
      limit: 2,
      filters: expect.arrayContaining([
        {
          kind: "in",
          column: "status",
          value: expect.arrayContaining(["completed", "failed", "cancelled", "undone"]),
        },
      ]),
    });
    expect(result.map((batch) => batch.id)).toEqual(["active-1", "recent-1"]);
  });

  it("registers camel-case item ids and hydrates through an owner-scoped query", async () => {
    queryResults.push(
      { data: [{ batch_id: "batch-1", item_ids: ["item-1"] }], error: null },
      { data: batchRow(), error: null },
    );

    const result = await getIntakeRepository().registerBatch("owner-1", request);

    expect(rpc).toHaveBeenCalledWith("register_workspace_intake_batch", {
      p_user_id: "owner-1",
      p_client_batch_id: "client-batch-1",
      p_source_type: "file_drop",
      p_page_context: request.pageContext,
      p_items: [
        {
          assetId: "00000000-0000-4000-8000-000000000001",
          documentId: "00000000-0000-4000-8000-000000000002",
          jobId: "00000000-0000-4000-8000-000000000003",
        },
      ],
    });
    expect(queryRecords[0]!.filters).toEqual([
      { kind: "eq", column: "user_id", value: "owner-1" },
      { kind: "eq", column: "id", value: "batch-1" },
    ]);
    expect(result.id).toBe("batch-1");
  });

  it("surfaces registration ownership rejection", async () => {
    queryResults.push({
      data: null,
      error: { message: "INTAKE_DOCUMENT_NOT_OWNED" },
    });

    await expect(
      getIntakeRepository().registerBatch("owner-1", request),
    ).rejects.toThrow("INTAKE_DOCUMENT_NOT_OWNED");
  });

  it("claims through the lease RPC and maps owner context", async () => {
    queryResults.push({
      data: [{ ...itemRow(), user_id: "owner-1", page_context: pageContext }],
      error: null,
    });

    const claimed = await getIntakeRepository().claimNextItem("worker-1", 120);

    expect(rpc).toHaveBeenCalledWith("claim_workspace_intake_item", {
      p_worker_id: "worker-1",
      p_lease_seconds: 120,
    });
    expect(claimed).toEqual(
      expect.objectContaining({
        id: "item-1",
        ownerId: "owner-1",
        leaseOwner: "worker-1",
        pageContext,
      }),
    );
  });

  it("keeps item id and lease owner on each direct worker mutation", async () => {
    queryResults.push(
      { data: { id: "item-1" }, error: null },
      { data: { id: "item-1" }, error: null },
    );
    const repository = getIntakeRepository();

    await repository.renewLease("item-1", "worker-1", 90);
    await repository.attachHermesRun("item-1", "worker-1", "run-1");

    expect(queryRecords).toHaveLength(2);
    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_items",
      operation: "update",
      filters: expect.arrayContaining([
        { kind: "eq", column: "id", value: "item-1" },
        { kind: "eq", column: "lease_owner", value: "worker-1" },
        {
          kind: "in",
          column: "status",
          value: ["orchestrating", "executing"],
        },
      ]),
    });
    expect(queryRecords[1]).toMatchObject({
      table: "workspace_intake_items",
      operation: "update",
      filters: expect.arrayContaining([
        { kind: "eq", column: "id", value: "item-1" },
        { kind: "eq", column: "lease_owner", value: "worker-1" },
        {
          kind: "in",
          column: "status",
          value: ["awaiting_hermes", "orchestrating"],
        },
      ]),
    });
  });

  it("owner-scopes the item decision mutation itself", async () => {
    queryResults.push({ data: { id: "item-1" }, error: null });
    const input: SetItemDecisionInput = {
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      status: "executing",
      confidence: 0.8,
      decisionSummary: "Create a note",
      invalidPlanCount: 1,
      errorCode: null,
    };

    await getIntakeRepository().setItemDecision(input);

    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_items",
      operation: "update",
      payload: {
        status: "executing",
        confidence: 0.8,
        decision_summary: "Create a note",
        invalid_plan_count: 1,
        error_code: null,
        completed_at: null,
      },
      filters: expect.arrayContaining([
        { kind: "eq", column: "id", value: "item-1" },
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "lease_owner", value: "worker-1" },
      ]),
    });
  });

  it("replaces pending steps through one lease-guarded transaction RPC", async () => {
    queryResults.push({ data: true, error: null });
    const input: ReplacePendingStepsInput = {
      ownerId: "owner-1",
      batchId: "batch-1",
      itemId: "item-1",
      workerId: "worker-1",
      steps: [
        {
          sequence: 0,
          actionName: "note.create",
          forwardInput: { title: "One" },
          inverseAction: "note.delete",
          inverseInput: null,
          conflictFingerprint: null,
          confidence: 0.9,
        },
      ],
    };

    await getIntakeRepository().replacePendingSteps(input);

    expect(rpc).toHaveBeenCalledWith(
      "replace_workspace_intake_pending_steps",
      {
        p_user_id: "owner-1",
        p_batch_id: "batch-1",
        p_item_id: "item-1",
        p_worker_id: "worker-1",
        p_steps: [
          {
            sequence: 0,
            actionName: "note.create",
            forwardInput: { title: "One" },
            inverseAction: "note.delete",
            inverseInput: null,
            conflictFingerprint: null,
            confidence: 0.9,
          },
        ],
      },
    );
    expect(queryRecords).toEqual([]);
  });

  it("does not fall back to delete and insert when step replacement fails", async () => {
    queryResults.push({
      data: null,
      error: { message: "INTAKE_STEP_REPLACEMENT_FAILED" },
    });

    await expect(
      getIntakeRepository().replacePendingSteps({
        ownerId: "owner-1",
        batchId: "batch-1",
        itemId: "item-1",
        workerId: "worker-1",
        steps: [],
      }),
    ).rejects.toThrow("INTAKE_STEP_REPLACEMENT_FAILED");

    expect(queryRecords).toEqual([]);
  });

  it("journals completed and failed steps through lease-guarded transaction RPCs", async () => {
    queryResults.push({ data: true, error: null }, { data: true, error: null });
    const repository = getIntakeRepository();
    const completed: CompletedStepInput = {
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      stepId: "step-1",
      forwardResult: { noteId: "note-1" },
      inverseAction: "note.delete",
      inverseInput: { id: "note-1" },
      conflictFingerprint: "note-1:v1",
    };
    const failed: FailedStepInput = {
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      stepId: "step-2",
      errorCode: "EXECUTION_FAILED",
    };

    await repository.markStepCompleted(completed);
    await repository.markStepFailed(failed);

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_workspace_intake_step",
      {
        p_user_id: "owner-1",
        p_item_id: "item-1",
        p_step_id: "step-1",
        p_worker_id: "worker-1",
        p_forward_result: { noteId: "note-1" },
        p_inverse_action: "note.delete",
        p_inverse_input: { id: "note-1" },
        p_conflict_fingerprint: "note-1:v1",
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(2, "fail_workspace_intake_step", {
      p_user_id: "owner-1",
      p_item_id: "item-1",
      p_step_id: "step-2",
      p_worker_id: "worker-1",
      p_error_code: "EXECUTION_FAILED",
    });
    expect(queryRecords).toEqual([]);
  });

  it.each([
    "SECRET_TOKEN_ABC",
    "Authorization: Bearer sk-live-secret",
    "upstream provider returned confidential raw body without a colon",
  ])("maps unplanned error text to PROCESSING_FAILED: %s", async (unsafeError) => {
    queryResults.push({ data: true, error: null });

    await getIntakeRepository().markStepFailed({
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      stepId: "step-1",
      errorCode: unsafeError,
    });

    expect(rpc).toHaveBeenCalledWith("fail_workspace_intake_step", {
      p_user_id: "owner-1",
      p_item_id: "item-1",
      p_step_id: "step-1",
      p_worker_id: "worker-1",
      p_error_code: "PROCESSING_FAILED",
    });
  });

  it("preserves an allowlisted release code on its guarded item mutation", async () => {
    queryResults.push({ data: { id: "item-1" }, error: null });
    const input: ReleaseIntakeItemInput = {
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      status: "awaiting_hermes",
      errorCode: "HERMES_UNAVAILABLE",
      availableAt: "2026-09-05T08:00:10.000Z",
    };

    await getIntakeRepository().releaseItem(input);

    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_items",
      operation: "update",
      payload: {
        status: "awaiting_hermes",
        available_at: "2026-09-05T08:00:10.000Z",
        lease_owner: null,
        lease_expires_at: null,
        error_code: "HERMES_UNAVAILABLE",
        completed_at: null,
      },
      filters: expect.arrayContaining([
        { kind: "eq", column: "id", value: "item-1" },
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "lease_owner", value: "worker-1" },
      ]),
    });
  });

  it("retries failed work through one owner-scoped transaction RPC", async () => {
    queryResults.push(
      { data: true, error: null },
      { data: batchRow({ status: "processing" }), error: null },
    );

    const result = await getIntakeRepository().retryFailed("owner-1", "batch-1");

    expect(rpc).toHaveBeenCalledWith("retry_workspace_intake_batch", {
      p_user_id: "owner-1",
      p_batch_id: "batch-1",
    });
    expect(queryRecords).toHaveLength(1);
    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_batches",
      operation: "select",
      filters: [
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "id", value: "batch-1" },
      ],
    });
    expect(result.status).toBe("processing");
  });

  it("does not hydrate when the retry transaction rejects current state", async () => {
    queryResults.push({ data: false, error: null });

    await expect(
      getIntakeRepository().retryFailed("owner-1", "batch-1"),
    ).rejects.toThrow("INTAKE_BATCH_NOT_RETRYABLE");

    expect(queryRecords).toEqual([]);
  });

  it("cancels through one owner-scoped transaction RPC without asset queries", async () => {
    queryResults.push(
      { data: true, error: null },
      { data: batchRow({ status: "cancelled" }), error: null },
    );

    const result = await getIntakeRepository().cancel("owner-1", "batch-1");

    expect(rpc).toHaveBeenCalledWith("cancel_workspace_intake_batch", {
      p_user_id: "owner-1",
      p_batch_id: "batch-1",
    });
    expect(queryRecords).toHaveLength(1);
    expect(queryRecords[0]!.table).toBe("workspace_intake_batches");
    expect(queryRecords.some((query) => query.table === "file_assets")).toBe(false);
    expect(
      queryRecords.some((query) => query.table === "knowledge_documents"),
    ).toBe(false);
    expect(result.status).toBe("cancelled");
  });

  it("keeps owner and expected state on each undo mutation", async () => {
    queryResults.push(
      { data: { id: "batch-1" }, error: null },
      { data: batchRow({ status: "undoing" }), error: null },
      { data: { id: "batch-1" }, error: null },
      { data: batchRow({ status: "undone" }), error: null },
    );
    const repository = getIntakeRepository();

    await repository.beginUndo("owner-1", "batch-1");
    await repository.finishUndo("owner-1", "batch-1");

    expect(queryRecords).toHaveLength(4);
    expect(queryRecords[0]).toMatchObject({
      table: "workspace_intake_batches",
      operation: "update",
      filters: expect.arrayContaining([
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "id", value: "batch-1" },
        {
          kind: "in",
          column: "status",
          value: ["completed", "partial"],
        },
      ]),
    });
    expect(queryRecords[2]).toMatchObject({
      table: "workspace_intake_batches",
      operation: "update",
      filters: expect.arrayContaining([
        { kind: "eq", column: "user_id", value: "owner-1" },
        { kind: "eq", column: "id", value: "batch-1" },
        { kind: "eq", column: "status", value: "undoing" },
      ]),
    });
  });
});

function createQuery(table: string) {
  const record: QueryRecord = {
    table,
    operation: "select",
    filters: [],
  };
  queryRecords.push(record);
  const result = () =>
    Promise.resolve(queryResults.shift() ?? { data: null, error: null });
  const chain = {
    select() {
      return chain;
    },
    insert(value: unknown) {
      record.operation = "insert";
      record.payload = value;
      return chain;
    },
    update(value: unknown) {
      record.operation = "update";
      record.payload = value;
      return chain;
    },
    delete() {
      record.operation = "delete";
      return chain;
    },
    eq(column: string, value: unknown) {
      record.filters.push({ kind: "eq", column, value });
      return chain;
    },
    in(column: string, values: unknown[]) {
      record.filters.push({ kind: "in", column, value: values });
      return chain;
    },
    order() {
      return chain;
    },
    limit(value: number) {
      record.limit = value;
      return chain;
    },
    maybeSingle() {
      return result();
    },
    single() {
      return result();
    },
    then(
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return result().then(resolve, reject);
    },
  };
  return chain;
}

const pageContext = {
  version: 1 as const,
  route: "/documents",
  pageType: "documents" as const,
  capturedAt: "2026-09-05T07:59:00.000Z",
  timezone: "Asia/Shanghai",
  trigger: {
    kind: "file_drop" as const,
    clientBatchId: "client-batch-1",
  },
};

const request: CreateIntakeBatchRequest = {
  clientBatchId: "client-batch-1",
  sourceType: "file_drop",
  pageContext,
  items: [
    {
      assetId: "00000000-0000-4000-8000-000000000001",
      documentId: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000003",
    },
  ],
};

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    client_batch_id: "client-batch-1",
    source_type: "file_drop",
    page_context: pageContext,
    status: "processing",
    summary: null,
    error_code: null,
    created_at: "2026-09-05T08:00:00.000Z",
    updated_at: "2026-09-05T08:00:01.000Z",
    completed_at: null,
    undone_at: null,
    items: [
      {
        ...itemRow(),
        steps: [
          {
            id: "step-1",
            batch_id: "batch-1",
            item_id: "item-1",
            sequence: 0,
            action_name: "note.create",
            forward_input: { title: "One" },
            forward_result: null,
            inverse_action: "note.delete",
            inverse_input: null,
            conflict_fingerprint: null,
            status: "pending",
            confidence: 0.9,
            error_code: null,
            created_at: "2026-09-05T08:00:00.000Z",
            updated_at: "2026-09-05T08:00:01.000Z",
            completed_at: null,
            undone_at: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function itemRow() {
  return {
    id: "item-1",
    batch_id: "batch-1",
    asset_id: "asset-1",
    document_id: "document-1",
    job_id: "job-1",
    hermes_run_id: null,
    status: "orchestrating",
    confidence: null,
    decision_summary: null,
    error_code: null,
    attempt_count: 1,
    invalid_plan_count: 0,
    available_at: "2026-09-05T08:00:00.000Z",
    lease_owner: "worker-1",
    lease_expires_at: "2026-09-05T08:02:00.000Z",
    created_at: "2026-09-05T08:00:00.000Z",
    updated_at: "2026-09-05T08:00:01.000Z",
    completed_at: null,
  };
}
