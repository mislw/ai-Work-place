// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type {
  IntakeActionStep,
  IntakeBatch,
} from "@/lib/intake/contracts";
import { fingerprintRecord } from "@/lib/intake/fingerprint";
import type {
  IntakeRepository,
  ReversibleRecordTable,
} from "@/lib/intake/repository";
import {
  undoIntakeBatch,
  type IntakeUndoDependencies,
} from "@/lib/intake/undo";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const CREATED_AT = "2026-09-01T12:00:00.000Z";

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

    expect(harness.repository.undoRecordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        batchId: "batch-1",
        itemId: "item-1",
        stepId: "step-todo",
        table: "todos",
        recordId: "todo-1",
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
    expect(harness.repository.undoRecordStep).not.toHaveBeenCalled();
    expect(harness.repository.undoArchiveStep).not.toHaveBeenCalled();
    expect(harness.repository.undoRelationStep).not.toHaveBeenCalled();
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

  it("allows exactly 30 days and expires the command 1ms later", async () => {
    const exactBoundary = createHarness({
      createdAt: "2026-08-06T12:00:00.000Z",
    });

    await expect(
      undoIntakeBatch("owner-1", "batch-1", exactBoundary.dependencies),
    ).resolves.toMatchObject({ status: "undone" });
    expect(
      exactBoundary.repository.clearExpiredUndoData,
    ).not.toHaveBeenCalled();

    const oneMillisecondLate = createHarness({
      createdAt: "2026-08-06T11:59:59.999Z",
    });
    await expect(
      undoIntakeBatch("owner-1", "batch-1", oneMillisecondLate.dependencies),
    ).rejects.toThrow("UNDO_WINDOW_EXPIRED");
    expect(
      oneMillisecondLate.repository.clearExpiredUndoData,
    ).toHaveBeenCalledWith({
      ownerId: "owner-1",
      batchId: "batch-1",
    });
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
    expect(harness.repository.undoRecordStep).toHaveBeenCalledWith(
      expect.objectContaining({ table: "notes", recordId: "note-1" }),
    );
    expect(harness.repository.undoRelationStep).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "relation-1" }),
    );
  });

  it("preserves an archive changed after intake and continues other inverses", async () => {
    const harness = createHarness();
    harness.document = {
      id: "document-1",
      collection_id: "collection-user-selected",
      title: "Source document",
    };

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(harness.repository.undoArchiveStep).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "document-1" }),
    );
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

    expect(harness.repository.undoRelationStep).toHaveBeenCalledWith({
      ownerId: "owner-1",
      batchId: "batch-1",
      itemId: "item-1",
      stepId: "step-relation",
      relationId: "relation-1",
      expectedSnapshot: relationsSnapshot("relation-1"),
      expectedFingerprint: fingerprintRecord(relationsSnapshot("relation-1")),
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

    expect(harness.repository.undoRelationStep).not.toHaveBeenCalled();
    expect(harness.relations.has("relation-1")).toBe(true);
  });

  it("rejects a record step when either inverse field is missing", async () => {
    const missingAction = createHarness();
    stepById(missingAction.batch, "step-note").inverseAction = null;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", missingAction.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");
    expect(missingAction.repository.beginUndo).not.toHaveBeenCalled();

    const missingInput = createHarness();
    stepById(missingInput.batch, "step-note").inverseInput = null;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", missingInput.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");
    expect(missingInput.repository.beginUndo).not.toHaveBeenCalled();
  });

  it("rejects no-inverse receipts unless the relation replay is confirmed", async () => {
    const recordHarness = createHarness();
    const record = stepById(recordHarness.batch, "step-note");
    record.inverseAction = null;
    record.inverseInput = null;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", recordHarness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    const relationHarness = createHarness();
    const relation = stepById(relationHarness.batch, "step-relation");
    relation.inverseAction = null;
    relation.inverseInput = null;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", relationHarness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    const replayHarness = createHarness();
    const replay = stepById(replayHarness.batch, "step-relation");
    replay.inverseAction = null;
    replay.inverseInput = null;
    requireForwardResult(replay).replayed = true;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", replayHarness.dependencies),
    ).resolves.toMatchObject({ status: "undone" });
    expect(
      replayHarness.repository.markReplayedRelationUndone,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: "step-relation",
        relationId: "relation-1",
        expectedSnapshot: relationsSnapshot("relation-1"),
        expectedFingerprint: fingerprintRecord(
          relationsSnapshot("relation-1"),
        ),
      }),
    );
  });

  it("rejects mismatched action and inverse schemas before beginning undo", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-note").inverseAction = "archive.restore";
    stepById(harness.batch, "step-note").inverseInput = {
      documentId: "document-1",
      previousCollectionId: null,
    };

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.undoArchiveStep).not.toHaveBeenCalled();
  });

  it("rejects an archive inverse for a different intake item document", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-archive").inverseInput = {
      documentId: "document-other",
      previousCollectionId: "collection-old",
    };

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.undoArchiveStep).not.toHaveBeenCalled();
  });

  it("rejects an archive inverse missing its nullable previous collection field", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-archive").inverseInput = {
      documentId: "document-1",
    };

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.undoArchiveStep).not.toHaveBeenCalled();
  });

  it("rejects post-action snapshot ids that do not match exact inverse targets", async () => {
    for (const [stepId, unexpectedId] of [
      ["step-note", "note-other"],
      ["step-archive", "document-other"],
      ["step-relation", "relation-other"],
    ] as const) {
      const harness = createHarness();
      const step = stepById(harness.batch, stepId);
      const forward = requireForwardResult(step);
      const snapshot = {
        ...(forward.postActionSnapshot as Record<string, unknown>),
        id: unexpectedId,
      };
      forward.postActionSnapshot = snapshot;
      step.conflictFingerprint = fingerprintRecord(snapshot);

      await expect(
        undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
      ).rejects.toThrow("INVALID_INTAKE_INVERSE");
      expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    }
  });

  it("requires a complete persisted replay receipt before marking relation undone", async () => {
    const harness = createHarness();
    const step = stepById(harness.batch, "step-relation");
    const forward = requireForwardResult(step);
    delete forward.id;
    step.inverseAction = null;
    step.inverseInput = null;
    forward.replayed = true;

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.markReplayedRelationUndone).not.toHaveBeenCalled();
  });

  it("rejects relation receipts outside the exact reversible action schema", async () => {
    for (const replayed of [false, true]) {
      const harness = createHarness();
      const step = stepById(harness.batch, "step-relation");
      step.actionName = "relation.create:profile";
      requireForwardResult(step).replayed = replayed;
      if (replayed) {
        step.inverseAction = null;
        step.inverseInput = null;
      }

      await expect(
        undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
      ).rejects.toThrow("INVALID_INTAKE_INVERSE");
      expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    }
  });

  it("rejects a record inverse table that does not match its validated action", async () => {
    const harness = createHarness();
    stepById(harness.batch, "step-note").inverseInput = {
      table: "profiles",
      id: "note-1",
    };

    await expect(
      undoIntakeBatch("owner-1", "batch-1", harness.dependencies),
    ).rejects.toThrow("INVALID_INTAKE_INVERSE");

    expect(harness.repository.beginUndo).not.toHaveBeenCalled();
    expect(harness.repository.undoRecordStep).not.toHaveBeenCalled();
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
    requireForwardResult(
      stepById(harness.batch, "step-note"),
    ).postActionSnapshot = {
      ...note,
      updated_at: "2026-09-01T12:00:00.000Z",
      metadata: {
        last_edited_at: "2026-09-01T12:01:00.000Z",
        nested: {
          completed_at: "2026-09-01T12:02:00.000Z",
          stable: true,
        },
      },
    };

    await undoIntakeBatch("owner-1", "batch-1", harness.dependencies);

    expect(stepById(harness.batch, "step-note").status).toBe("undone");
    expect(harness.repository.undoRecordStep).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        table: "notes",
        recordId: "note-1",
        expectedFingerprint: stepById(harness.batch, "step-note")
          .conflictFingerprint,
        expectedSnapshot: expect.objectContaining({
          id: "note-1",
          metadata: { nested: { stable: true } },
        }),
      }),
    );
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
      forwardResult: {
        archived: true,
        collectionId: "collection-new",
        replayed: false,
        postActionSnapshot: {
          id: "document-1",
          collection_id: "collection-new",
        },
      },
      inverseAction: "archive.restore",
      inverseInput: {
        documentId: "document-1",
        previousCollectionId: "collection-old",
      },
      conflictFingerprint: fingerprintRecord({
        id: "document-1",
        collection_id: "collection-new",
      }),
    }),
    createStep({
      id: "step-note",
      sequence: 1,
      actionName: "note.create",
      forwardResult: receipt(records.notes.get("note-1")!),
      inverseAction: "record.delete",
      inverseInput: { table: "notes", id: "note-1" },
      conflictFingerprint: fingerprintRecord(records.notes.get("note-1")),
    }),
    createStep({
      id: "step-todo",
      sequence: 2,
      actionName: "todo.create",
      forwardResult: receipt(records.todos.get("todo-1")!),
      inverseAction: "record.delete",
      inverseInput: { table: "todos", id: "todo-1" },
      conflictFingerprint: fingerprintRecord(records.todos.get("todo-1")),
    }),
    createStep({
      id: "step-calendar",
      sequence: 3,
      actionName: "calendar.create",
      forwardResult: receipt(records.calendar_events.get("calendar-1")!),
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
      forwardResult: receipt(relations.get("relation-1")!),
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
    undoRecordStep: vi.fn(
      async (input: {
        ownerId: string;
        table: ReversibleRecordTable;
        recordId: string;
        stepId: string;
        expectedSnapshot: Record<string, unknown>;
        expectedFingerprint: string;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        const current = records[input.table].get(input.recordId);
        const step = stepById(batch, input.stepId);
        if (!current) {
          step.status = "undone";
          return "already_missing" as const;
        }
        if (
          fingerprintRecord(current) !==
          fingerprintRecord(input.expectedSnapshot)
        ) {
          step.status = "undo_conflict";
          step.errorCode = "UNDO_RECORD_CHANGED";
          return "conflict" as const;
        }
        inverseOrder.push(`record.delete:${input.table}`);
        records[input.table].delete(input.recordId);
        step.status = "undone";
        return "undone" as const;
      },
    ),
    undoArchiveStep: vi.fn(
      async (input: {
        ownerId: string;
        documentId: string;
        previousCollectionId: string | null;
        stepId: string;
        expectedSnapshot: Record<string, unknown>;
        expectedFingerprint: string;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        const step = stepById(batch, input.stepId);
        if (!document) {
          step.status = "undone";
          return "already_missing" as const;
        }
        const currentSnapshot = {
          id: document.id,
          collection_id: document.collection_id ?? null,
        };
        if (
          fingerprintRecord(currentSnapshot) !==
          fingerprintRecord(input.expectedSnapshot)
        ) {
          step.status = "undo_conflict";
          step.errorCode = "UNDO_RECORD_CHANGED";
          return "conflict" as const;
        }
        inverseOrder.push("archive.restore");
        document.collection_id = input.previousCollectionId;
        step.status = "undone";
        return "undone" as const;
      },
    ),
    undoRelationStep: vi.fn(
      async (input: {
        ownerId: string;
        relationId: string;
        stepId: string;
        expectedSnapshot: Record<string, unknown>;
        expectedFingerprint: string;
      }) => {
        expect(input.ownerId).toBe("owner-1");
        const current = relations.get(input.relationId);
        const step = stepById(batch, input.stepId);
        if (!current) {
          step.status = "undone";
          return "already_missing" as const;
        }
        if (
          fingerprintRecord(current) !==
          fingerprintRecord(input.expectedSnapshot)
        ) {
          step.status = "undo_conflict";
          step.errorCode = "UNDO_RECORD_CHANGED";
          return "conflict" as const;
        }
        inverseOrder.push("relation.delete");
        relations.delete(input.relationId);
        step.status = "undone";
        return "undone" as const;
      },
    ),
    markReplayedRelationUndone: vi.fn(
      async (input: {
        stepId: string;
        relationId: string;
        expectedSnapshot: Record<string, unknown>;
        expectedFingerprint: string;
      }) => {
        stepById(batch, input.stepId).status = "undone";
        return "undone" as const;
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

function relationsSnapshot(id: string): Record<string, unknown> {
  return {
    id,
    source_type: "knowledge_document",
    source_id: "document-1",
    target_type: "note",
    target_id: "note-1",
    relation_type: "source_of",
    creator: "assistant",
    confidence: 0.86,
  };
}

function receipt(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    replayed: false,
    postActionSnapshot: record,
  };
}

function requireForwardResult(
  step: IntakeActionStep,
): Record<string, unknown> {
  if (!step.forwardResult || typeof step.forwardResult !== "object") {
    throw new Error("Missing forward result");
  }
  return step.forwardResult as Record<string, unknown>;
}
