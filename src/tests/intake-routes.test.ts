// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAssistantOwner,
  registerBatch,
  listActiveAndRecent,
  getBatch,
  retryFailed,
  cancel,
  stopRun,
  undoIntakeBatch,
  deleteAssetRoute,
} = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  registerBatch: vi.fn(),
  listActiveAndRecent: vi.fn(),
  getBatch: vi.fn(),
  retryFailed: vi.fn(),
  cancel: vi.fn(),
  stopRun: vi.fn(),
  undoIntakeBatch: vi.fn(),
  deleteAssetRoute: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {
    constructor(
      readonly status: 401 | 403 | 503,
      readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED",
      message: string,
    ) {
      super(message);
    }
  },
  getAssistantOwner,
}));
vi.mock("@/lib/intake/repository", () => ({
  getIntakeRepository: () => ({
    registerBatch,
    listActiveAndRecent,
    getBatch,
    retryFailed,
    cancel,
  }),
}));
vi.mock("@/lib/intake/hermes-runs", () => ({
  HermesRunsClient: class HermesRunsClient {
    stopRun = stopRun;
  },
}));
vi.mock("@/lib/intake/undo", () => ({ undoIntakeBatch }));
vi.mock("@/app/api/knowledge/assets/[id]/route", () => ({
  DELETE: deleteAssetRoute,
}));

import { AssistantAuthError } from "@/lib/assistant/auth";
import {
  GET as LIST_BATCHES,
  POST as POST_BATCH,
} from "@/app/api/intake/batches/route";
import { GET as GET_BATCH } from "@/app/api/intake/batches/[id]/route";
import { POST as RETRY } from "@/app/api/intake/batches/[id]/retry/route";
import { POST as CANCEL } from "@/app/api/intake/batches/[id]/cancel/route";
import { POST as UNDO } from "@/app/api/intake/batches/[id]/undo/route";
import type { IntakeBatch } from "@/lib/intake/contracts";

const BATCH_ID = "00000000-0000-4000-8000-000000000010";
const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const JOB_ID = "00000000-0000-4000-8000-000000000003";
const VALID_CONTEXT = {
  version: 1 as const,
  route: "/documents",
  pageType: "documents" as const,
  capturedAt: "2026-09-05T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  trigger: {
    kind: "file_drop" as const,
    clientBatchId: "client-1",
  },
};

describe("authenticated workspace intake routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
    const batch = createBatch();
    registerBatch.mockResolvedValue({ batch, registration: "created" });
    listActiveAndRecent.mockResolvedValue([batch]);
    getBatch.mockResolvedValue(batch);
    retryFailed.mockResolvedValue(createBatch({ status: "processing" }));
    cancel.mockResolvedValue(createBatch({ status: "cancelled" }));
    stopRun.mockResolvedValue({ runId: "run-1", status: "stopping" });
    undoIntakeBatch.mockResolvedValue(createBatch({ status: "undone" }));
  });

  it("registers only durable upload ids under the authenticated owner", async () => {
    const response = await POST_BATCH(
      jsonRequest("/api/intake/batches", {
        clientBatchId: "client-1",
        sourceType: "file_drop",
        pageContext: VALID_CONTEXT,
        items: [{ assetId: ASSET_ID, documentId: DOCUMENT_ID, jobId: JOB_ID }],
      }),
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(registerBatch).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        clientBatchId: "client-1",
        items: [{ assetId: ASSET_ID, documentId: DOCUMENT_ID, jobId: JOB_ID }],
      }),
    );
    expect(await response.json()).toEqual({ batch: createBatch() });
  });

  it("returns 200 with one durable item for an idempotent duplicate callback", async () => {
    const batch = createBatch();
    registerBatch
      .mockResolvedValueOnce({ batch, registration: "created" })
      .mockResolvedValueOnce({ batch, registration: "replayed" });
    const payload = {
      clientBatchId: "client-1",
      sourceType: "file_drop",
      pageContext: VALID_CONTEXT,
      items: [{ assetId: ASSET_ID, documentId: DOCUMENT_ID, jobId: JOB_ID }],
    };

    const created = await POST_BATCH(jsonRequest("/api/intake/batches", payload));
    const replayed = await POST_BATCH(jsonRequest("/api/intake/batches", payload));

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(200);
    expectNoStore(created);
    expectNoStore(replayed);
    expect((await replayed.json()).batch.items).toHaveLength(1);
  });

  it("rejects malformed JSON, malformed page context, body owner, and more than 20 items", async () => {
    const malformedJson = await POST_BATCH(
      new Request("http://localhost/api/intake/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    const malformedContext = await POST_BATCH(
      jsonRequest("/api/intake/batches", {
        clientBatchId: "client-1",
        sourceType: "file_drop",
        pageContext: { ...VALID_CONTEXT, route: "https://example.com" },
        items: [{ assetId: ASSET_ID, documentId: DOCUMENT_ID, jobId: JOB_ID }],
      }),
    );
    const injectedOwner = await POST_BATCH(
      jsonRequest("/api/intake/batches", {
        ownerId: "owner-2",
        clientBatchId: "client-1",
        sourceType: "file_drop",
        pageContext: VALID_CONTEXT,
        items: [{ assetId: ASSET_ID, documentId: DOCUMENT_ID, jobId: JOB_ID }],
      }),
    );
    const tooManyItems = await POST_BATCH(
      jsonRequest("/api/intake/batches", {
        clientBatchId: "client-1",
        sourceType: "file_drop",
        pageContext: VALID_CONTEXT,
        items: Array.from({ length: 21 }, (_, index) => ({
          assetId: uuid(index * 3 + 1),
          documentId: uuid(index * 3 + 2),
          jobId: uuid(index * 3 + 3),
        })),
      }),
    );

    for (const response of [
      malformedJson,
      malformedContext,
      injectedOwner,
      tooManyItems,
    ]) {
      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(await response.json()).toEqual({
        error: { code: "INVALID_INTAKE_REQUEST", message: "接管批次参数无效" },
      });
    }
    expect(registerBatch).not.toHaveBeenCalled();
  });

  it("clamps recent to 1 through 20 and returns active plus recent terminal batches", async () => {
    const low = await LIST_BATCHES(
      new Request("http://localhost/api/intake/batches?recent=-8"),
    );
    const high = await LIST_BATCHES(
      new Request("http://localhost/api/intake/batches?recent=99"),
    );

    expect(listActiveAndRecent).toHaveBeenNthCalledWith(1, "owner-1", 1);
    expect(listActiveAndRecent).toHaveBeenNthCalledWith(2, "owner-1", 20);
    expect(await low.json()).toEqual({ batches: [createBatch()] });
    expectNoStore(low);
    expectNoStore(high);
  });

  it("reads a batch only through the authenticated owner scope", async () => {
    const response = await GET_BATCH(request(`/api/intake/batches/${BATCH_ID}`), {
      params: { id: BATCH_ID },
    });

    expect(response.status).toBe(200);
    expect(getBatch).toHaveBeenCalledWith("owner-1", BATCH_ID);
    expect(await response.json()).toEqual({ batch: createBatch() });
    expectNoStore(response);
  });

  it("cannot read, retry, cancel, or undo another owner's batch", async () => {
    getBatch.mockResolvedValue(null);
    const context = { params: { id: BATCH_ID } };

    const responses = [
      await GET_BATCH(request(`/api/intake/batches/${BATCH_ID}`), context),
      await RETRY(request(`/api/intake/batches/${BATCH_ID}/retry`, "POST"), context),
      await CANCEL(request(`/api/intake/batches/${BATCH_ID}/cancel`, "POST"), context),
      await UNDO(request(`/api/intake/batches/${BATCH_ID}/undo`, "POST"), context),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(await response.json()).toEqual({
        error: { code: "INTAKE_BATCH_NOT_FOUND", message: "接管批次不存在" },
      });
    }
    expect(retryFailed).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(undoIntakeBatch).not.toHaveBeenCalled();
    expect(stopRun).not.toHaveBeenCalled();
  });

  it("retries failed items through the owner-scoped repository command", async () => {
    getBatch.mockResolvedValue(createBatch({ status: "failed" }));
    const retried = createBatch({ status: "processing" });
    retryFailed.mockResolvedValue(retried);

    const response = await RETRY(
      request(`/api/intake/batches/${BATCH_ID}/retry`, "POST"),
      { params: { id: BATCH_ID } },
    );

    expect(response.status).toBe(200);
    expect(retryFailed).toHaveBeenCalledWith("owner-1", BATCH_ID);
    expect(await response.json()).toEqual({ batch: retried });
    expectNoStore(response);
  });

  it("returns a stable 409 when no failed item is retryable", async () => {
    retryFailed.mockRejectedValue(new Error("INTAKE_BATCH_NOT_RETRYABLE"));

    const response = await RETRY(
      request(`/api/intake/batches/${BATCH_ID}/retry`, "POST"),
      { params: { id: BATCH_ID } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "INTAKE_BATCH_NOT_RETRYABLE",
        message: "接管批次没有可重试的失败项",
      },
    });
    expectNoStore(response);
  });

  it("best-effort stops active Hermes runs before atomically cancelling unfinished items", async () => {
    getBatch.mockResolvedValue(
      createBatch({
        status: "executing",
        items: [
          createItem({ id: uuid(101), status: "executing", hermesRunId: "run-1" }),
          createItem({ id: uuid(102), status: "awaiting_hermes", hermesRunId: "run-2" }),
          createItem({ id: uuid(103), status: "completed", hermesRunId: "run-done" }),
          createItem({ id: uuid(104), status: "waiting_extraction", hermesRunId: null }),
        ],
      }),
    );
    stopRun.mockRejectedValueOnce(new Error("Hermes unavailable"));
    const cancelled = createBatch({ status: "cancelled" });
    cancel.mockResolvedValue(cancelled);

    const response = await CANCEL(
      request(`/api/intake/batches/${BATCH_ID}/cancel`, "POST"),
      { params: { id: BATCH_ID } },
    );

    expect(response.status).toBe(200);
    expect(stopRun).toHaveBeenCalledTimes(2);
    expect(stopRun).toHaveBeenCalledWith("run-1");
    expect(stopRun).toHaveBeenCalledWith("run-2");
    expect(cancel).toHaveBeenCalledWith("owner-1", BATCH_ID);
    expect(deleteAssetRoute).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ batch: cancelled });
    expectNoStore(response);
  });

  it.each(["completed", "partial", "failed", "cancelled", "undoing", "undone"] as const)(
    "rejects cancellation for terminal or non-cancellable status %s",
    async (status) => {
      getBatch.mockResolvedValue(createBatch({ status }));

      const response = await CANCEL(
        request(`/api/intake/batches/${BATCH_ID}/cancel`, "POST"),
        { params: { id: BATCH_ID } },
      );

      expect(response.status).toBe(409);
      expect(stopRun).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expectNoStore(response);
    },
  );

  it("returns the refreshed undo-conflict batch DTO", async () => {
    getBatch.mockResolvedValue(createBatch({ status: "completed" }));
    const conflicted = createBatch({
      status: "partial",
      errorCode: "UNDO_RECORD_CHANGED",
      items: [
        createItem({
          status: "partial",
          steps: [
            {
              ...createStep(),
              status: "undo_conflict",
              errorCode: "UNDO_RECORD_CHANGED",
            },
          ],
        }),
      ],
    });
    undoIntakeBatch.mockResolvedValue(conflicted);

    const response = await UNDO(
      request(`/api/intake/batches/${BATCH_ID}/undo`, "POST"),
      { params: { id: BATCH_ID } },
    );

    expect(response.status).toBe(200);
    expect(undoIntakeBatch).toHaveBeenCalledWith(
      "owner-1",
      BATCH_ID,
      expect.objectContaining({
        repository: expect.objectContaining({ getBatch }),
      }),
    );
    expect(await response.json()).toEqual({ batch: conflicted });
    expectNoStore(response);
  });

  it.each([
    ["UNDO_WINDOW_EXPIRED", "接管批次的撤销窗口已过期"],
    ["INTAKE_BATCH_NOT_UNDOABLE", "接管批次当前不可撤销"],
  ])("maps %s to a stable 409 DTO", async (code, message) => {
    undoIntakeBatch.mockRejectedValue(new Error(code));

    const response = await UNDO(
      request(`/api/intake/batches/${BATCH_ID}/undo`, "POST"),
      { params: { id: BATCH_ID } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code, message } });
    expectNoStore(response);
  });

  it.each([
    [401, "UNAUTHENTICATED", "未登录"],
    [403, "FORBIDDEN", "无权访问 AI 助手"],
    [503, "NOT_CONFIGURED", "AI 助手服务未配置"],
  ] as const)("preserves AssistantAuthError %s/%s", async (status, code, message) => {
    getAssistantOwner.mockRejectedValue(
      new AssistantAuthError(status, code, message),
    );

    const response = await LIST_BATCHES(
      new Request("http://localhost/api/intake/batches"),
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message } });
    expectNoStore(response);
  });

  it("does not expose unexpected internal errors", async () => {
    listActiveAndRecent.mockRejectedValue(
      new Error("Authorization: Bearer secret-token"),
    );

    const response = await LIST_BATCHES(
      new Request("http://localhost/api/intake/batches"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTAKE_REQUEST_FAILED", message: "接管批次请求失败" },
    });
    expectNoStore(response);
  });
});

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function request(path: string, method = "GET") {
  return new Request(`http://localhost${path}`, { method });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function createBatch(
  overrides: Partial<IntakeBatch> = {},
): IntakeBatch {
  return {
    id: BATCH_ID,
    clientBatchId: "client-1",
    sourceType: "file_drop",
    pageContext: VALID_CONTEXT,
    status: "processing",
    summary: null,
    errorCode: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    updatedAt: "2026-09-05T08:00:01.000Z",
    completedAt: null,
    undoneAt: null,
    items: [createItem()],
    ...overrides,
  };
}

function createItem(
  overrides: Partial<IntakeBatch["items"][number]> = {},
): IntakeBatch["items"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000011",
    batchId: BATCH_ID,
    assetId: ASSET_ID,
    documentId: DOCUMENT_ID,
    jobId: JOB_ID,
    hermesRunId: "run-1",
    status: "orchestrating",
    confidence: null,
    decisionSummary: null,
    errorCode: null,
    attemptCount: 1,
    invalidPlanCount: 0,
    availableAt: "2026-09-05T08:00:00.000Z",
    leaseOwner: "worker-1",
    leaseExpiresAt: "2026-09-05T08:02:00.000Z",
    createdAt: "2026-09-05T08:00:00.000Z",
    updatedAt: "2026-09-05T08:00:01.000Z",
    completedAt: null,
    steps: [],
    ...overrides,
  };
}

function createStep(): IntakeBatch["items"][number]["steps"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    batchId: BATCH_ID,
    itemId: "00000000-0000-4000-8000-000000000011",
    sequence: 0,
    actionName: "note.create",
    forwardInput: {},
    forwardResult: {},
    inverseAction: "record.delete",
    inverseInput: { table: "notes", id: uuid(13) },
    conflictFingerprint: "sha256:test",
    status: "completed",
    confidence: 0.8,
    errorCode: null,
    createdAt: "2026-09-05T08:00:00.000Z",
    updatedAt: "2026-09-05T08:00:01.000Z",
    completedAt: "2026-09-05T08:00:01.000Z",
    undoneAt: null,
  };
}
