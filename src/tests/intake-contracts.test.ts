import { describe, expect, it } from "vitest";
import {
  createIntakeBatchRequestSchema,
  intakeActionStepSchema,
  intakeBatchSchema,
  intakeBatchStatusSchema,
  intakeItemSchema,
  intakeItemStatusSchema,
  intakeStepStatusSchema,
  workspaceIntakePlanV1Schema,
  workspacePageContextV1Schema,
} from "@/lib/intake/contracts";

const UUIDS = {
  asset: "11111111-1111-4111-8111-111111111111",
  batch: "22222222-2222-4222-8222-222222222222",
  document: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  job: "55555555-5555-4555-8555-555555555555",
  step: "66666666-6666-4666-8666-666666666666",
} as const;

const PAGE_CONTEXT = {
  version: 1 as const,
  route: "/todos?status=pending",
  pageType: "todos" as const,
  capturedAt: "2026-09-05T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  view: { filters: { status: "pending" } },
  trigger: { kind: "file_drop" as const, clientBatchId: "batch-1" },
};

const VALID_PLAN = {
  version: 1 as const,
  documentId: UUIDS.document,
  summary: "整理完成",
  confidence: 0.8,
  actions: [{ kind: "todo.create" as const, input: { title: "整理任务" } }],
  warnings: [],
};

const CREATE_REQUEST = {
  clientBatchId: "batch-1",
  sourceType: "file_drop" as const,
  pageContext: PAGE_CONTEXT,
  items: [
    {
      assetId: UUIDS.asset,
      documentId: UUIDS.document,
      jobId: UUIDS.job,
    },
  ],
};

describe("workspace intake contracts", () => {
  it("accepts a bounded todos-page drop context", () => {
    expect(workspacePageContextV1Schema.parse(PAGE_CONTEXT)).toEqual(
      expect.objectContaining({ pageType: "todos" }),
    );
  });

  it("rejects owner ids supplied with a valid plan", () => {
    expect(() =>
      workspaceIntakePlanV1Schema.parse({
        ...VALID_PLAN,
        ownerId: "owner-2",
      }),
    ).toThrow();
  });

  it("rejects unknown write actions without relying on another invalid field", () => {
    expect(() =>
      workspaceIntakePlanV1Schema.parse({
        ...VALID_PLAN,
        actions: [{ kind: "todo.delete", input: { id: "todo-1" } }],
      }),
    ).toThrow();
  });

  it.each(["https://example.com/todos", "//example.com/todos"])(
    "rejects external route %s",
    (route) => {
      expect(() =>
        workspacePageContextV1Schema.parse({ ...PAGE_CONTEXT, route }),
      ).toThrow();
    },
  );

  it.each(["/todos\n/settings", "/todos\n"])(
    "rejects control characters in internal route %j",
    (route) => {
      expect(() =>
        workspacePageContextV1Schema.parse({
          ...PAGE_CONTEXT,
          route,
        }),
      ).toThrow();
    },
  );

  it.each([
    {
      name: "source type",
      request: { ...CREATE_REQUEST, sourceType: "file_picker" as const },
    },
    {
      name: "client batch id",
      request: { ...CREATE_REQUEST, clientBatchId: "batch-2" },
    },
  ])("rejects a conflicting trigger $name", ({ request }) => {
    expect(() => createIntakeBatchRequestSchema.parse(request)).toThrow();
  });

  it("limits each file plan to 30 actions", () => {
    const actions = Array.from({ length: 31 }, (_, index) => ({
      kind: "todo.create" as const,
      input: { title: `任务 ${index}` },
    }));
    expect(() =>
      workspaceIntakePlanV1Schema.parse({
        version: 1,
        documentId: UUIDS.asset,
        summary: "任务列表",
        confidence: 0.7,
        actions,
        warnings: [],
      }),
    ).toThrow();
  });

  it("accepts only the persisted intake statuses", () => {
    expect(intakeBatchStatusSchema.options).toEqual([
      "uploading",
      "processing",
      "orchestrating",
      "executing",
      "completed",
      "partial",
      "failed",
      "cancelled",
      "undoing",
      "undone",
    ]);
    expect(intakeItemStatusSchema.options).toEqual([
      "waiting_extraction",
      "awaiting_hermes",
      "orchestrating",
      "executing",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]);
    expect(intakeStepStatusSchema.options).toEqual([
      "pending",
      "completed",
      "failed",
      "undone",
      "undo_conflict",
    ]);
  });

  it("parses a strict nested intake receipt", () => {
    const step = intakeActionStepSchema.parse({
      id: UUIDS.step,
      batchId: UUIDS.batch,
      itemId: UUIDS.item,
      sequence: 0,
      actionName: "todo.create",
      forwardInput: { title: "整理任务" },
      forwardResult: { id: "todo-1" },
      inverseAction: "todo.delete",
      inverseInput: { id: "todo-1" },
      conflictFingerprint: "fingerprint-1",
      status: "completed",
      confidence: 0.8,
      errorCode: null,
      createdAt: "2026-09-05T08:02:00.000Z",
      updatedAt: "2026-09-05T08:03:00.000Z",
      completedAt: "2026-09-05T08:03:00.000Z",
      undoneAt: null,
    });
    const item = intakeItemSchema.parse({
      id: UUIDS.item,
      batchId: UUIDS.batch,
      assetId: UUIDS.asset,
      documentId: UUIDS.document,
      jobId: UUIDS.job,
      hermesRunId: "run-1",
      status: "completed",
      confidence: 0.8,
      decisionSummary: "创建一个任务",
      errorCode: null,
      attemptCount: 1,
      invalidPlanCount: 0,
      availableAt: "2026-09-05T08:01:00.000Z",
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: "2026-09-05T08:01:00.000Z",
      updatedAt: "2026-09-05T08:03:00.000Z",
      completedAt: "2026-09-05T08:03:00.000Z",
      steps: [step],
    });

    expect(
      intakeBatchSchema.parse({
        id: UUIDS.batch,
        clientBatchId: "batch-1",
        sourceType: "file_drop",
        pageContext: PAGE_CONTEXT,
        status: "completed",
        summary: "已完成",
        errorCode: null,
        createdAt: "2026-09-05T08:01:00.000Z",
        updatedAt: "2026-09-05T08:03:00.000Z",
        completedAt: "2026-09-05T08:03:00.000Z",
        undoneAt: null,
        items: [item],
      }),
    ).toEqual(expect.objectContaining({ items: [item] }));
  });

  it("accepts durable item ids without accepting an owner id", () => {
    expect(createIntakeBatchRequestSchema.parse(CREATE_REQUEST)).toEqual(
      CREATE_REQUEST,
    );
    expect(() =>
      createIntakeBatchRequestSchema.parse({
        ...CREATE_REQUEST,
        userId: UUIDS.item,
      }),
    ).toThrow();
  });
});
