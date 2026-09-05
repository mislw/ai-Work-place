// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { createServiceClient, getKnowledgeItem } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  getKnowledgeItem: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/knowledge/search", () => ({ getKnowledgeItem }));

import type {
  IntakeActionStep,
  IntakeBatch,
} from "@/lib/intake/contracts";
import { fingerprintRecord } from "@/lib/intake/fingerprint";
import {
  getIntakeRepository,
  type IntakeRepository,
  type ReversibleRecordTable,
} from "@/lib/intake/repository";
import {
  undoIntakeBatch,
  type IntakeUndoDependencies,
} from "@/lib/intake/undo";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const CREATED_AT = "2026-09-01T12:00:00.000Z";

describe("intake undo repository", () => {
  it("loads archive conflict data through the same owner-scoped view used by Task 6", async () => {
    const document = {
      id: "document-1",
      collectionId: "collection-new",
      title: "Source document",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    createServiceClient.mockReturnValue({
      from: vi.fn(() => {
        throw new Error("raw document rows must not define archive fingerprints");
      }),
      rpc: vi.fn(),
    });
    getKnowledgeItem.mockResolvedValue(document);

    await expect(
      getIntakeRepository().loadKnowledgeDocumentForUndo({
        ownerId: "owner-1",
        id: "document-1",
      }),
    ).resolves.toEqual(document);
    expect(getKnowledgeItem).toHaveBeenCalledWith("owner-1", "document-1");
  });
});

describe("undoIntakeBatch", () => {
  it("undoes completed steps in reverse sequence", async () => {
    const harness = createHarness();

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(harness.inverseOrder).toEqual([
      "relation.delete",
      "record.delete:calendar_events",
      "record.delete:todos",
      "record.delete:notes",
      "archive.restore",
    ]);
    expect(harness.batch.status).toBe("undone");
    expect(
      harness.batch.items[0]!.steps.every((step) => step.status === "undone"),
    ).toBe(true);
  });

  it("preserves a record edited after intake", async () => {
    const harness = createHarness();
    harness.records.todos.set("todo-1", {
      id: "todo-1",
      title: "用户改过的标题",
    });

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(harness.repository.deleteReversibleRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ table: "todos", id: "todo-1" }),
    );
    expect(harness.repository.markStepUndoConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        batchId: "batch-1",
        itemId: "item-1",
        stepId: "step-todo",
        errorCode: "UNDO_RECORD_CHANGED",
      }),
    );
    expect(stepById(harness.batch, "step-todo").status).toBe("undo_conflict");
    expect(harness.batch.status).toBe("partial");
  });

  it("continues undoing unaffected steps after one conflict", async () => {
    const harness = createHarness();
    harness.records.calendar_events.set("calendar-1", {
      id: "calendar-1",
      title: "Changed event",
    });

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(stepById(harness.batch, "step-calendar").status).toBe(
      "undo_conflict",
    );
    expect(stepById(harness.batch, "step-archive").status).toBe("undone");
    expect(harness.inverseOrder).toContain("archive.restore");
  });

  it("rejects an owner mismatch without reading or deleting business data", async () => {
    const harness = createHarness();

    await expect(
      undoIntakeBatch("owner-2", "batch-1", harness.dependencies),
    ).rejects.toThrow("INTAKE_BATCH_NOT_FOUND");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.loadReversibleRecord).not.toHaveBeenCalled();
    expect(harness.repository.deleteReversibleRecord).not.toHaveBeenCalled();
    expect(harness.repository.loadRelationForUndo).not.toHaveBeenCalled();
    expect(harness.repository.deleteRelationForUndo).not.toHaveBeenCalled();
  });

  it("rejects expired inverse data and clears only the stored inverse fields", async () => {
    const harness = createHarness({
      createdAt: "2026-08-05T11:59:59.999Z",
    });
    const originalForwardResults = harness.batch.items[0]!.steps.map(
      (step) => step.forwardResult,
    );

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("UNDO_WINDOW_EXPIRED");

    expect(harness.repository.clearExpiredUndoData).toHaveBeenCalledWith({
      ownerId: "owner-1",
      batchId: "batch-1",
    });
    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(
      harness.batch.items[0]!.steps.every(
        (step) =>
          step.inverseInput === null && step.conflictFingerprint === null,
      ),
    ).toBe(true);
    expect(
      harness.batch.items[0]!.steps.map((step) => step.forwardResult),
    ).toEqual(originalForwardResults);
    expect(harness.originalFilesDeleted).toBe(false);
  });

  it("replays an already-undone batch without repeating inverse operations", async () => {
    const harness = createHarness({ status: "undone" });
    for (const step of harness.batch.items[0]!.steps) step.status = "undone";

    const result = await undoIntakeBatch(
      "owner-1",
      "batch-1",
      harness.dependencies,
    );

    expect(result.status).toBe("undone");
    expect(harness.inverseOrder).toEqual([]);
    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.finishUndo).not.toHaveBeenCalled();
  });

  it("treats missing records and relations as already satisfied inverses", async () => {
    const harness = createHarness();
    harness.records.notes.delete("note-1");
    harness.relations.delete("relation-1");

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(stepById(harness.batch, "step-note").status).toBe("undone");
    expect(stepById(harness.batch, "step-relation").status).toBe("undone");
    expect(harness.repository.deleteReversibleRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ table: "notes", id: "note-1" }),
    );
    expect(harness.repository.deleteRelationForUndo).not.toHaveBeenCalled();
  });

  it("preserves an archive changed after intake and continues other inverses", async () => {
    const harness = createHarness();
    harness.document = {
      id: "document-1",
      collection_id: "collection-user-selected",
      title: "Source document",
    };

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(
      harness.repository.restoreKnowledgeDocumentCollection,
    ).not.toHaveBeenCalled();
    expect(stepById(harness.batch, "step-archive").status).toBe(
      "undo_conflict",
    );
    expect(stepById(harness.batch, "step-note").status).toBe("undone");
    expect(harness.batch.status).toBe("partial");
  });

  it("deletes only the exact relation id created by this batch", async () => {
    const harness = createHarness();
    harness.relations.set("relation-unrelated", {
      id: "relation-unrelated",
      source_id: "document-1",
      target_id: "note-1",
      relation_type: "source_of",
    });

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(harness.repository.loadRelationForUndo).toHaveBeenCalledWith({
      ownerId: "owner-1",
      id: "relation-1",
    });
    expect(harness.repository.deleteRelationForUndo).toHaveBeenCalledTimes(1);
    expect(harness.repository.deleteRelationForUndo).toHaveBeenCalledWith({
      ownerId: "owner-1",
      id: "relation-1",
    });
    expect(harness.relations.has("relation-unrelated")).toBe(true);
  });

  it("rejects a relation inverse id that differs from the batch forward receipt", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-relation").inverseInput = {
      id: "relation-unrelated",
    };

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.loadRelationForUndo).not.toHaveBeenCalled();
    expect(harness.repository.deleteRelationForUndo).not.toHaveBeenCalled();
    expect(harness.relations.has("relation-1")).toBe(true);
  });

  it("derives record tables from validated step actions and owner-scopes every operation", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-note").inverseInput = {
      table: "profiles",
      id: "note-1",
    };

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(harness.repository.loadReversibleRecord).toHaveBeenCalledWith({
      ownerId: "owner-1",
      table: "notes",
      id: "note-1",
    });
    expect(harness.repository.deleteReversibleRecord).toHaveBeenCalledWith({
      ownerId: "owner-1",
      table: "notes",
      id: "note-1",
    });
  });

  it("ignores recursively nested volatile timestamps when checking conflicts", async () => {
    const harness = createHarness();
    const note = harness.records.notes.get("note-1")!;
    note.updated_at = "2026-09-05T11:00:00.000Z";
    note.metadata = {
      last_edited_at: "2026-09-05T11:01:00.000Z",
      nested: {
        completed_at: "2026-09-05T11:02:00.000Z",
        stable: true,
      },
    };
    stepById(harness.batch, "step-note").conflictFingerprint =
      fingerprintRecord({
        ...note,
        updated_at: "2026-09-01T12:00:00.000Z",
        metadata: {
          last_edited_at: "2026-09-01T12:01:00.000Z",
          nested: {
            completed_at: "2026-09-01T12:02:00.000Z",
            stable: true,
          },
        },
      });

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(stepById(harness.batch, "step-note").status).toBe("undone");
    expect(harness.repository.deleteReversibleRecord).toHaveBeenCalledWith({
      ownerId: "owner-1",
      table: "notes",
      id: "note-1",
    });
  });
});

function createHarness(
  overrides: Partial<Pick<IntakeBatch, "createdAt" | "status">> = {},
) {
  const inverseOrder: string[] = [];
  const records: Record<
    ReversibleRecordTable,
    Map<string, Record<string, unknown>>
  > = {
    notes: new Map([
      ["note-1", { id: "note-1", title: "Source note", content: "", tags: [] }],
    ]),
    todos: new Map([
      [
        "todo-1",
        {
          id: "todo-1",
          title: "Source todo",
          status: "pending",
          priority: "medium",
        },
      ],
    ]),
    calendar_events: new Map([
      [
        "calendar-1",
        {
          id: "calendar-1",
          title: "Source event",
          event_date: "2026-09-09",
        },
      ],
    ]),
  };
  const relations = new Map<string, Record<string, unknown>>([
    [
      "relation-1",
      {
        id: "relation-1",
        source_type: "knowledge_document",
        source_id: "document-1",
        target_type: "note",
        target_id: "note-1",
        relation_type: "source_of",
        creator: "assistant",
        confidence: 0.86,
      },
    ],
  ]);
  let document: Record<string, unknown> | null = {
    id: "document-1",
    collection_id: "collection-new",
    title: "Source document",
  };
  let originalFilesDeleted = false;

  const steps = [
    createStep({
      id: "step-archive",
      sequence: 0,
      actionName: "archive",
      forwardResult: { archived: true, collectionId: "collection-new" },
      inverseAction: "archive.restore",
      inverseInput: {
        documentId: "document-1",
        previousCollectionId: "collection-old",
      },
      conflictFingerprint: fingerprintRecord(document),
    }),
    createStep({
      id: "step-note",
      sequence: 1,
      actionName: "note.create",
      forwardResult: records.notes.get("note-1")!,
      inverseAction: "record.delete",
      inverseInput: { table: "notes", id: "note-1" },
      conflictFingerprint: fingerprintRecord(records.notes.get("note-1")),
    }),
    createStep({
      id: "step-todo",
      sequence: 2,
      actionName: "todo.create",
      forwardResult: records.todos.get("todo-1")!,
      inverseAction: "record.delete",
      inverseInput: { table: "todos", id: "todo-1" },
      conflictFingerprint: fingerprintRecord(records.todos.get("todo-1")),
    }),
    createStep({
      id: "step-calendar",
      sequence: 3,
      actionName: "calendar.create",
      forwardResult: records.calendar_events.get("calendar-1")!,
      inverseAction: "record.delete",
      inverseInput: { table: "calendar_events", id: "calendar-1" },
      conflictFingerprint: fingerprintRecord(
        records.calendar_events.get("calendar-1"),
      ),
    }),
    createStep({
      id: "step-relation",
      sequence: 4,
      actionName: "relation.create:note",
      forwardResult: relations.get("relation-1")!,
      inverseAction: "relation.delete",
      inverseInput: { id: "relation-1" },
      conflictFingerprint: fingerprintRecord(relations.get("relation-1")),
    }),
  ];
  const batch = {
    id: "batch-1",
    clientBatchId: "client-batch-1",
    sourceType: "file_drop",
    pageContext: {
      version: 1,
      route: "/documents",
      pageType: "documents",
      capturedAt: CREATED_AT,
      timezone: "Asia/Shanghai",
      trigger: { kind: "file_drop", clientBatchId: "client-batch-1" },
    },
    status: "completed",
    summary: "Completed intake",
    errorCode: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: CREATED_AT,
    undoneAt: null,
    items: [
      {
        id: "item-1",
        batchId: "batch-1",
        assetId: "asset-1",
        documentId: "document-1",
        jobId: "job-1",
        hermesRunId: "run-1",
        status: "completed",
        confidence: 0.86,
        decisionSummary: "Completed intake",
        errorCode: null,
        attemptCount: 1,
        invalidPlanCount: 0,
        availableAt: CREATED_AT,
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        completedAt: CREATED_AT,
        steps,
      },
    ],
    ...overrides,
  } as IntakeBatch;

  const repository = {
    getBatch: vi.fn(async (ownerId: string, batchId: string) =>
      ownerId === "owner-1" && batchId === batch.id ? batch : null,
    ),
    beginUndo: vi.fn(async () => {
      batch.status = "undoing";
      return batch;
    }),
    loadReversibleRecord: vi.fn(
      async (input: {
        ownerId: string;
        table: ReversibleRecordTable;
        id: string;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        return records[input.table].get(input.id) ?? null;
      },
    ),
    deleteReversibleRecord: vi.fn(
      async (input: {
        ownerId: string;
        table: ReversibleRecordTable;
        id: string;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        inverseOrder.push(`record.delete:${input.table}`);
        records[input.table].delete(input.id);
      },
    ),
    loadKnowledgeDocumentForUndo: vi.fn(
      async (input: { ownerId: string; id: string }) => {
        expect(input).toEqual({ ownerId: "owner-1", id: "document-1" });
        return document;
      },
    ),
    restoreKnowledgeDocumentCollection: vi.fn(
      async (input: {
        ownerId: string;
        id: string;
        collectionId: string | null;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        inverseOrder.push("archive.restore");
        if (document) document.collection_id = input.collectionId;
      },
    ),
    loadRelationForUndo: vi.fn(
      async (input: { ownerId: string; id: string }) => {
        expect(input.ownerId).toBe("owner-1");
        return relations.get(input.id) ?? null;
      },
    ),
    deleteRelationForUndo: vi.fn(
      async (input: { ownerId: string; id: string }) => {
        expect(input.ownerId).toBe("owner-1");
        inverseOrder.push("relation.delete");
        relations.delete(input.id);
      },
    ),
    markStepUndone: vi.fn(
      async (input: { stepId: string }) => {
        stepById(batch, input.stepId).status = "undone";
      },
    ),
    markStepUndoConflict: vi.fn(
      async (input: { stepId: string; errorCode: string }) => {
        const step = stepById(batch, input.stepId);
        step.status = "undo_conflict";
        step.errorCode = input.errorCode;
      },
    ),
    finishUndo: vi.fn(
      async (
        _ownerId: string,
        _batchId: string,
        status: "undone" | "partial" = "undone",
      ) => {
        batch.status = status;
        return batch;
      },
    ),
    clearExpiredUndoData: vi.fn(async () => {
      for (const step of steps) {
        step.inverseInput = null;
        step.conflictFingerprint = null;
      }
    }),
  } as unknown as IntakeRepository;

  const dependencies: IntakeUndoDependencies = {
    repository,
    now: () => NOW,
  };

  return {
    dependencies,
    repository,
    batch,
    records,
    relations,
    inverseOrder,
    get document() {
      return document;
    },
    set document(value: Record<string, unknown> | null) {
      document = value;
    },
    get originalFilesDeleted() {
      return originalFilesDeleted;
    },
    set originalFilesDeleted(value: boolean) {
      originalFilesDeleted = value;
    },
  };
}

function createStep(
  input: Pick<
    IntakeActionStep,
    | "id"
    | "sequence"
    | "actionName"
    | "forwardResult"
    | "inverseAction"
    | "inverseInput"
    | "conflictFingerprint"
  >,
): IntakeActionStep {
  return {
    ...input,
    batchId: "batch-1",
    itemId: "item-1",
    forwardInput: {},
    status: "completed",
    confidence: 0.86,
    errorCode: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    completedAt: CREATED_AT,
    undoneAt: null,
  };
}

function stepById(batch: IntakeBatch, stepId: string): IntakeActionStep {
  for (const item of batch.items) {
    const step = item.steps.find((candidate) => candidate.id === stepId);
    if (step) return step;
  }
  throw new Error(`Missing step: ${stepId}`);
}
