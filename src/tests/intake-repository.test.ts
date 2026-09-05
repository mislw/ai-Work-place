// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServiceClient,
  from,
  rpc,
  select,
  insert,
  update,
  remove,
  eq,
  inFilter,
  order,
  limit,
  maybeSingle,
  single,
} = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
  inFilter: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
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

const queryResults: QueryResult[] = [];

describe("owner-scoped intake repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResults.length = 0;
    from.mockImplementation(() => createQuery());
    rpc.mockImplementation(() =>
      Promise.resolve(queryResults.shift() ?? { data: null, error: null }),
    );
    createServiceClient.mockReturnValue({ from, rpc });
  });

  it("loads a batch only through owner and batch id", async () => {
    queryResults.push({ data: batchRow(), error: null });

    const result = await getIntakeRepository().getBatch("owner-1", "batch-1");

    expect(from).toHaveBeenCalledWith("workspace_intake_batches");
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(eq).toHaveBeenCalledWith("id", "batch-1");
    expect(result).toEqual(
      expect.objectContaining({
        id: "batch-1",
        clientBatchId: "client-batch-1",
        items: [
          expect.objectContaining({
            id: "item-1",
            assetId: "asset-1",
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

  it("lists active batches and recent terminal batches through owner filters", async () => {
    queryResults.push(
      { data: [batchRow({ id: "active-1", status: "processing" })], error: null },
      {
        data: [
          batchRow({ id: "recent-1", status: "completed" }),
          batchRow({ id: "active-1", status: "completed" }),
        ],
        error: null,
      },
    );

    const result = await getIntakeRepository().listActiveAndRecent("owner-1", 2);

    expect(from).toHaveBeenCalledTimes(2);
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(eq.mock.calls.filter(([column]) => column === "user_id")).toHaveLength(2);
    expect(inFilter).toHaveBeenCalledWith(
      "status",
      expect.arrayContaining(["processing", "orchestrating", "executing"]),
    );
    expect(inFilter).toHaveBeenCalledWith(
      "status",
      expect.arrayContaining(["completed", "failed", "cancelled", "undone"]),
    );
    expect(limit).toHaveBeenCalledWith(2);
    expect(result.map((batch) => batch.id)).toEqual(["active-1", "recent-1"]);
  });

  it("registers camel-case item ids and hydrates the owner-scoped batch", async () => {
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
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(eq).toHaveBeenCalledWith("id", "batch-1");
    expect(result.id).toBe("batch-1");
  });

  it("does not register a document owned by another user", async () => {
    queryResults.push({
      data: null,
      error: { message: "INTAKE_DOCUMENT_NOT_OWNED" },
    });

    await expect(
      getIntakeRepository().registerBatch("owner-1", request),
    ).rejects.toThrow("INTAKE_DOCUMENT_NOT_OWNED");
  });

  it("claims the next item through the claim RPC and maps its owner context", async () => {
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

  it("guards lease renewal and Hermes attachment by item and lease owner", async () => {
    queryResults.push(
      { data: { id: "item-1" }, error: null },
      { data: { id: "item-1" }, error: null },
    );
    const repository = getIntakeRepository();

    await repository.renewLease("item-1", "worker-1", 90);
    await repository.attachHermesRun("item-1", "worker-1", "run-1");

    expect(eq.mock.calls.filter((call) => call[0] === "id")).toEqual([
      ["id", "item-1"],
      ["id", "item-1"],
    ]);
    expect(eq.mock.calls.filter((call) => call[0] === "lease_owner")).toEqual([
      ["lease_owner", "worker-1"],
      ["lease_owner", "worker-1"],
    ]);
    expect(inFilter).toHaveBeenCalledWith("status", [
      "awaiting_hermes",
      "orchestrating",
    ]);
  });

  it("persists only the decision fields allowed by the repository contract", async () => {
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

    expect(update).toHaveBeenCalledWith({
      status: "executing",
      confidence: 0.8,
      decision_summary: "Create a note",
      invalid_plan_count: 1,
      error_code: null,
      completed_at: null,
    });
    expect(eq).toHaveBeenCalledWith("id", "item-1");
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(eq).toHaveBeenCalledWith("lease_owner", "worker-1");
  });

  it("replaces only pending steps after verifying the current item lease", async () => {
    queryResults.push(
      { data: { id: "item-1" }, error: null },
      { error: null },
      { error: null },
    );
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

    expect(from).toHaveBeenCalledWith("workspace_intake_items");
    expect(eq).toHaveBeenCalledWith("lease_owner", "worker-1");
    expect(remove).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("status", "pending");
    expect(insert).toHaveBeenCalledWith([
      {
        user_id: "owner-1",
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
      },
    ]);
  });

  it("journals completed and failed steps only while the worker owns the item lease", async () => {
    queryResults.push(
      { data: { id: "item-1" }, error: null },
      { data: { id: "step-1" }, error: null },
      { data: { id: "item-1" }, error: null },
      { data: { id: "step-2" }, error: null },
    );
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
      errorCode: " provider timeout: secret=abc ",
    };

    await repository.markStepCompleted(completed);
    await repository.markStepFailed(failed);

    expect(eq.mock.calls.filter((call) => call[0] === "lease_owner")).toEqual([
      ["lease_owner", "worker-1"],
      ["lease_owner", "worker-1"],
    ]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        forward_result: { noteId: "note-1" },
      }),
    );
    expect(update).toHaveBeenCalledWith({
      status: "failed",
      error_code: "PROVIDER_TIMEOUT",
      completed_at: null,
    });
    expect(eq).toHaveBeenCalledWith("status", "pending");
  });

  it("releases a failed lease with bounded backoff and a stable error code", async () => {
    queryResults.push({ data: { id: "item-1" }, error: null });
    const input: ReleaseIntakeItemInput = {
      ownerId: "owner-1",
      itemId: "item-1",
      workerId: "worker-1",
      status: "awaiting_hermes",
      errorCode: "Hermes unavailable: credential abc\nstack: secret-token",
      availableAt: "2026-09-05T08:00:10.000Z",
    };

    await getIntakeRepository().releaseItem(input);

    expect(update).toHaveBeenCalledWith({
      status: "awaiting_hermes",
      available_at: "2026-09-05T08:00:10.000Z",
      lease_owner: null,
      lease_expires_at: null,
      error_code: "HERMES_UNAVAILABLE",
      completed_at: null,
    });
    expect(eq).toHaveBeenCalledWith("id", "item-1");
    expect(eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(eq).toHaveBeenCalledWith("lease_owner", "worker-1");
  });

  it("retries only failed or partial work while preserving completed steps", async () => {
    queryResults.push(
      { data: { id: "batch-1" }, error: null },
      { error: null },
      { error: null },
      { data: batchRow({ status: "processing" }), error: null },
    );

    await getIntakeRepository().retryFailed("owner-1", "batch-1");

    expect(update).toHaveBeenCalledWith({
      status: "processing",
      error_code: null,
      completed_at: null,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awaiting_hermes",
        error_code: null,
        lease_owner: null,
        lease_expires_at: null,
      }),
    );
    expect(inFilter).toHaveBeenCalledWith("status", ["failed", "partial"]);
    expect(update).toHaveBeenCalledWith({
      status: "pending",
      error_code: null,
      completed_at: null,
      undone_at: null,
    });
    expect(eq).toHaveBeenCalledWith("status", "failed");
    expect(eq).not.toHaveBeenCalledWith("status", "completed");
  });

  it("cancels only non-terminal intake rows without touching assets or documents", async () => {
    queryResults.push(
      { data: { id: "batch-1" }, error: null },
      { error: null },
      { data: batchRow({ status: "cancelled" }), error: null },
    );

    await getIntakeRepository().cancel("owner-1", "batch-1");

    expect(inFilter).toHaveBeenCalledWith(
      "status",
      expect.arrayContaining(["uploading", "processing", "orchestrating", "executing"]),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(from).not.toHaveBeenCalledWith("file_assets");
    expect(from).not.toHaveBeenCalledWith("knowledge_documents");
    expect(eq.mock.calls.filter((call) => call[0] === "user_id")).toEqual([
      ["user_id", "owner-1"],
      ["user_id", "owner-1"],
      ["user_id", "owner-1"],
    ]);
  });

  it("guards begin and finish undo with owner and expected batch state", async () => {
    queryResults.push(
      { data: { id: "batch-1" }, error: null },
      { data: batchRow({ status: "undoing" }), error: null },
      { data: { id: "batch-1" }, error: null },
      { data: batchRow({ status: "undone" }), error: null },
    );
    const repository = getIntakeRepository();

    await repository.beginUndo("owner-1", "batch-1");
    await repository.finishUndo("owner-1", "batch-1");

    expect(inFilter).toHaveBeenCalledWith("status", ["completed", "partial"]);
    expect(eq).toHaveBeenCalledWith("status", "undoing");
    expect(eq.mock.calls.filter((call) => call[0] === "user_id")).toHaveLength(4);
  });
});

function createQuery() {
  const result = () =>
    Promise.resolve(queryResults.shift() ?? { data: null, error: null });
  const chain = {
    select(...args: unknown[]) {
      select(...args);
      return chain;
    },
    insert(value: unknown) {
      insert(value);
      return chain;
    },
    update(value: unknown) {
      update(value);
      return chain;
    },
    delete() {
      remove();
      return chain;
    },
    eq(column: string, value: unknown) {
      eq(column, value);
      return chain;
    },
    in(column: string, values: unknown[]) {
      inFilter(column, values);
      return chain;
    },
    order(column: string, options?: unknown) {
      order(column, options);
      return chain;
    },
    limit(value: number) {
      limit(value);
      return chain;
    },
    maybeSingle() {
      maybeSingle();
      return result();
    },
    single() {
      single();
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
