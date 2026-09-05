// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  classifyIntakeAction,
  executeIntakePlan,
  type IntakeExecutorDependencies,
  type IntakeKnowledgeDocument,
  type IntakeRelationInput,
} from "@/lib/intake/executor";
import { fingerprintRecord } from "@/lib/intake/fingerprint";
import type {
  IntakeActionStep,
  WorkspaceIntakePlanV1,
} from "@/lib/intake/contracts";
import type { IntakeRepository } from "@/lib/intake/repository";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-09-05T10:00:00.000Z";

describe("executeIntakePlan", () => {
  it("executes archive, note, todo, calendar, then relations", async () => {
    const harness = createHarness();
    const input = createInput([
      {
        kind: "calendar.create",
        input: { title: "Kickoff", event_date: "2026-09-08" },
      },
      { kind: "todo.create", input: { title: "验证接入" } },
      { kind: "archive", collectionName: "Hermes" },
      { kind: "note.create", input: { title: "接入记录" } },
    ]);

    await executeIntakePlan(input, harness.dependencies);

    expect(harness.callOrder).toEqual([
      "archive",
      "note.create",
      "todo.create",
      "calendar.create",
      "relation.create:note",
      "relation.create:todo",
      "relation.create:calendar",
    ]);
    expect(harness.steps.map((step) => step.actionName)).toEqual([
      "archive",
      "note.create",
      "todo.create",
      "calendar.create",
      "relation.create:note",
      "relation.create:todo",
      "relation.create:calendar",
    ]);
    expect(harness.steps.map((step) => step.sequence)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(harness.decisions.at(-1)).toMatchObject({
      status: "completed",
      confidence: 0.86,
      decisionSummary: "Execute validated intake plan",
      errorCode: null,
    });
  });

  it("derives stable request ids and journals every pending step before writes", async () => {
    const harness = createHarness();
    const input = createInput([
      { kind: "archive", collectionName: "Hermes" },
      { kind: "todo.create", input: { title: "验证接入" } },
    ]);

    await executeIntakePlan(input, harness.dependencies);

    expect(harness.events.indexOf("replacePendingSteps")).toBeLessThan(
      harness.events.indexOf("archive"),
    );
    expect(harness.events.indexOf("replacePendingSteps")).toBeLessThan(
      harness.events.indexOf("todo.create"),
    );
    expect(harness.executeAction).toHaveBeenCalledWith(
      "owner-1",
      { action: "todo.create", input: { title: "验证接入" } },
      `intake:${input.batchId}:${input.itemId}:1:todo.create`,
    );
    expect(harness.replacePendingSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        batchId: BATCH_ID,
        itemId: ITEM_ID,
        workerId: "worker-1",
        steps: expect.arrayContaining([
          expect.objectContaining({
            sequence: 0,
            actionName: "archive",
            forwardInput: {
              documentId: DOCUMENT_ID,
              collectionName: "Hermes",
              previousCollectionId: "collection-old",
            },
          }),
          expect.objectContaining({
            sequence: 1,
            actionName: "todo.create",
            forwardInput: { title: "验证接入" },
          }),
          expect.objectContaining({
            sequence: 2,
            actionName: "relation.create:todo",
            forwardInput: {
              documentId: DOCUMENT_ID,
              sourceActionSequence: 1,
              targetType: "todo",
            },
          }),
        ]),
      }),
    );
  });

  it("rejects a non-phase-one action before any write", async () => {
    const harness = createHarness();
    const unsafeInput = {
      ...createInput([]),
      plan: {
        ...createInput([]).plan,
        actions: [
          {
            kind: "todo.delete",
            input: { id: "todo-1" },
          },
        ],
      },
    };

    await expect(
      executeIntakePlan(
        unsafeInput as unknown as Parameters<typeof executeIntakePlan>[0],
        harness.dependencies,
      ),
    ).rejects.toThrow("UNSAFE_INTAKE_ACTION");

    expect(harness.getKnowledgeDocument).not.toHaveBeenCalled();
    expect(harness.replacePendingSteps).not.toHaveBeenCalled();
    expect(harness.executeAction).not.toHaveBeenCalled();
    expect(harness.archiveDocument).not.toHaveBeenCalled();
    expect(harness.createRelation).not.toHaveBeenCalled();
  });

  it("verifies the knowledge document owner before creating steps", async () => {
    const harness = createHarness();
    harness.getKnowledgeDocument.mockResolvedValue(null);

    await expect(
      executeIntakePlan(
        createInput([{ kind: "todo.create", input: { title: "Owner check" } }]),
        harness.dependencies,
      ),
    ).rejects.toThrow("INTAKE_DOCUMENT_NOT_OWNED");

    expect(harness.getKnowledgeDocument).toHaveBeenCalledWith(
      "owner-1",
      DOCUMENT_ID,
    );
    expect(harness.replacePendingSteps).not.toHaveBeenCalled();
    expect(harness.setItemDecision).not.toHaveBeenCalled();
  });

  it("stores reversible inputs, exact source relations, and stable fingerprints", async () => {
    const harness = createHarness();

    await executeIntakePlan(
      createInput([
        { kind: "archive", collectionName: "Hermes" },
        { kind: "note.create", input: { title: "Source note" } },
        { kind: "todo.create", input: { title: "Source todo" } },
        {
          kind: "calendar.create",
          input: { title: "Source event", event_date: "2026-09-09" },
        },
      ]),
      harness.dependencies,
    );

    expect(completedStep(harness.steps, "archive")).toMatchObject({
      inverseAction: "archive.restore",
      inverseInput: {
        documentId: DOCUMENT_ID,
        previousCollectionId: "collection-old",
      },
      conflictFingerprint: fingerprintRecord({
        id: DOCUMENT_ID,
        collection_id: "collection-new",
        title: "Source document",
      }),
    });
    expect(completedStep(harness.steps, "note.create")).toMatchObject({
      inverseAction: "record.delete",
      inverseInput: { table: "notes", id: "note-1" },
      conflictFingerprint: fingerprintRecord({
        id: "note-1",
        title: "Source note",
        content: "",
        tags: [],
      }),
    });
    expect(completedStep(harness.steps, "todo.create")).toMatchObject({
      inverseAction: "record.delete",
      inverseInput: { table: "todos", id: "todo-1" },
    });
    expect(completedStep(harness.steps, "calendar.create")).toMatchObject({
      inverseAction: "record.delete",
      inverseInput: { table: "calendar_events", id: "calendar-1" },
    });

    expect(harness.createRelation).toHaveBeenNthCalledWith(1, {
      ownerId: "owner-1",
      source_type: "knowledge_document",
      source_id: DOCUMENT_ID,
      target_type: "note",
      target_id: "note-1",
      relation_type: "source_of",
      creator: "assistant",
      confidence: 0.86,
    });
    expect(harness.createRelation).toHaveBeenNthCalledWith(2, {
      ownerId: "owner-1",
      source_type: "knowledge_document",
      source_id: DOCUMENT_ID,
      target_type: "todo",
      target_id: "todo-1",
      relation_type: "source_of",
      creator: "assistant",
      confidence: 0.86,
    });
    expect(harness.createRelation).toHaveBeenNthCalledWith(3, {
      ownerId: "owner-1",
      source_type: "knowledge_document",
      source_id: DOCUMENT_ID,
      target_type: "calendar_event",
      target_id: "calendar-1",
      relation_type: "source_of",
      creator: "assistant",
      confidence: 0.86,
    });
    expect(completedStep(harness.steps, "relation.create:note")).toMatchObject({
      inverseAction: "relation.delete",
      inverseInput: { id: "relation-note" },
    });
  });

  it("stores no destructive relation inverse for an idempotent replay", async () => {
    const harness = createHarness();
    harness.createRelation.mockImplementation(async (input) => {
      harness.events.push(`relation.create:${input.target_type}`);
      harness.callOrder.push(`relation.create:${input.target_type}`);
      return {
        result: {
          id: "relation-existing",
          ...withoutOwnerId(input),
        },
        replayed: true,
      };
    });

    await executeIntakePlan(
      createInput([{ kind: "note.create", input: { title: "Replay relation" } }]),
      harness.dependencies,
    );

    expect(completedStep(harness.steps, "relation.create:note")).toMatchObject({
      forwardResult: expect.objectContaining({
        id: "relation-existing",
        replayed: true,
      }),
      inverseAction: null,
      inverseInput: null,
    });
  });

  it("keeps completed receipts on partial failure and retries only unfinished steps", async () => {
    const harness = createHarness();
    let todoAttempts = 0;
    harness.executeAction.mockImplementation(
      async (_ownerId, action, _requestId) => {
        harness.events.push(action.action);
        harness.callOrder.push(action.action);
        if (action.action === "todo.create") {
          todoAttempts += 1;
          if (todoAttempts === 1) throw new Error("private database detail");
        }
        return {
          result: createdRecord(action.action, action.input),
          replayed: false,
        };
      },
    );
    const input = createInput([
      { kind: "note.create", input: { title: "First" } },
      { kind: "todo.create", input: { title: "Second" } },
      {
        kind: "calendar.create",
        input: { title: "Third", event_date: "2026-09-10" },
      },
    ]);

    await executeIntakePlan(input, harness.dependencies);

    expect(completedStep(harness.steps, "note.create").status).toBe("completed");
    expect(completedStep(harness.steps, "todo.create")).toMatchObject({
      status: "failed",
      errorCode: "EXECUTION_FAILED",
    });
    expect(completedStep(harness.steps, "calendar.create").status).toBe("pending");
    expect(harness.callOrder).toEqual(["note.create", "todo.create"]);
    expect(harness.decisions.at(-1)).toMatchObject({
      status: "partial",
      errorCode: "EXECUTION_FAILED",
    });

    harness.retryFailedSteps();
    harness.callOrder.length = 0;
    await executeIntakePlan(input, harness.dependencies);

    expect(harness.callOrder).toEqual([
      "todo.create",
      "calendar.create",
      "relation.create:note",
      "relation.create:todo",
      "relation.create:calendar",
    ]);
    expect(
      harness.executeAction.mock.calls.filter(
        ([, action]) => action.action === "note.create",
      ),
    ).toHaveLength(1);
    expect(
      harness.executeAction.mock.calls.filter(
        ([, action]) => action.action === "todo.create",
      ),
    ).toHaveLength(2);
    expect(harness.steps.every((step) => step.status === "completed")).toBe(true);
    expect(harness.decisions.at(-1)).toMatchObject({
      status: "completed",
      errorCode: null,
    });
  });

  it("recovers a persisted failed step after lease reclaim without retry", async () => {
    const harness = createHarness();
    let attempts = 0;
    harness.executeAction.mockImplementation(
      async (_ownerId, action, _requestId) => {
        harness.events.push(action.action);
        harness.callOrder.push(action.action);
        attempts += 1;
        if (attempts === 1) throw new Error("write failed");
        return {
          result: createdRecord(action.action, action.input),
          replayed: false,
        };
      },
    );
    harness.setItemDecision.mockRejectedValueOnce(
      new Error("process exited after failed receipt"),
    );
    const input = createInput([
      { kind: "todo.create", input: { title: "Resume after crash" } },
    ]);

    await expect(
      executeIntakePlan(input, harness.dependencies),
    ).rejects.toThrow("process exited after failed receipt");
    expect(completedStep(harness.steps, "todo.create")).toMatchObject({
      status: "failed",
      errorCode: "EXECUTION_FAILED",
    });

    harness.callOrder.length = 0;
    await executeIntakePlan(
      { ...input, workerId: "worker-2" },
      harness.dependencies,
    );

    expect(harness.callOrder).toEqual([
      "todo.create",
      "relation.create:todo",
    ]);
    expect(harness.steps.every((step) => step.status === "completed")).toBe(true);
    expect(harness.decisions.at(-1)).toMatchObject({
      workerId: "worker-2",
      status: "completed",
    });
  });

  it("preserves a null archive origin across a failed write and retry", async () => {
    const harness = createHarness();
    let collectionId: string | null = null;
    let archiveAttempts = 0;
    harness.getKnowledgeDocument.mockImplementation(async () => ({
      id: DOCUMENT_ID,
      collectionId,
      title: "Unfiled document",
    }));
    harness.archiveDocument.mockImplementation(async (archiveInput) => {
      archiveAttempts += 1;
      harness.events.push("archive");
      harness.callOrder.push("archive");
      collectionId = "collection-new";
      if (archiveAttempts === 1) throw new Error("write result was lost");
      return {
        result: {
          archived: true,
          collectionId,
          collectionName: archiveInput.collectionName,
        },
        updatedDocument: {
          id: archiveInput.documentId,
          collection_id: collectionId,
          title: "Unfiled document",
        },
      };
    });
    const input = createInput([
      { kind: "archive", collectionName: "Hermes" },
    ]);

    await executeIntakePlan(input, harness.dependencies);
    harness.retryFailedSteps();
    await executeIntakePlan(input, harness.dependencies);

    expect(completedStep(harness.steps, "archive")).toMatchObject({
      status: "completed",
      inverseInput: {
        documentId: DOCUMENT_ID,
        previousCollectionId: null,
      },
    });
  });

  it("rejects changed input for a completed action before any new write", async () => {
    const harness = createHarness();
    await executeIntakePlan(
      createInput([
        { kind: "note.create", input: { title: "Original title" } },
      ]),
      harness.dependencies,
    );
    harness.callOrder.length = 0;
    harness.events.length = 0;

    await expect(
      executeIntakePlan(
        createInput([
          { kind: "note.create", input: { title: "Changed title" } },
        ]),
        harness.dependencies,
      ),
    ).rejects.toThrow("INTAKE_STEP_PLAN_MISMATCH");

    expect(harness.replacePendingSteps).toHaveBeenCalledTimes(1);
    expect(harness.callOrder).toEqual([]);
  });

  it("rejects changed input for a completed relation before any new write", async () => {
    const harness = createHarness();
    const input = createInput([
      { kind: "note.create", input: { title: "Stable source" } },
    ]);
    await executeIntakePlan(input, harness.dependencies);
    completedStep(
      harness.steps,
      "relation.create:note",
    ).forwardInput.targetType = "todo";
    harness.callOrder.length = 0;
    harness.events.length = 0;

    await expect(
      executeIntakePlan(input, harness.dependencies),
    ).rejects.toThrow("INTAKE_STEP_PLAN_MISMATCH");

    expect(harness.replacePendingSteps).toHaveBeenCalledTimes(1);
    expect(harness.callOrder).toEqual([]);
  });

  it("checks cancellation after pending steps are persisted and before business writes", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.replacePendingSteps.mockImplementation(async (input) => {
      harness.persistPendingSteps(input.steps);
      harness.events.push("replacePendingSteps");
      controller.abort();
    });

    await expect(
      executeIntakePlan(
        {
          ...createInput([
            { kind: "todo.create", input: { title: "Do not create" } },
          ]),
          signal: controller.signal,
        },
        harness.dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(harness.executeAction).not.toHaveBeenCalled();
    expect(harness.markStepFailed).not.toHaveBeenCalled();
    expect(harness.decisions).toEqual([]);
  });
});

describe("intake execution helpers", () => {
  it("classifies only phase-one action kinds as automatic", () => {
    expect(
      classifyIntakeAction({ kind: "archive", collectionName: "Inbox" }),
    ).toBe("automatic");
    expect(
      classifyIntakeAction(
        { kind: "todo.delete", input: { id: "todo-1" } } as never,
      ),
    ).toBe("blocked");
  });

  it("fingerprints records independently of object key order", () => {
    expect(fingerprintRecord({ b: 2, a: { d: 4, c: 3 } })).toBe(
      fingerprintRecord({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(fingerprintRecord({ a: 1 })).not.toBe(
      fingerprintRecord({ a: 2 }),
    );
  });
});

function createInput(actions: WorkspaceIntakePlanV1["actions"]) {
  return {
    ownerId: "owner-1",
    batchId: BATCH_ID,
    itemId: ITEM_ID,
    documentId: DOCUMENT_ID,
    workerId: "worker-1",
    signal: new AbortController().signal,
    plan: {
      version: 1 as const,
      documentId: DOCUMENT_ID,
      summary: "Execute validated intake plan",
      confidence: 0.86,
      actions,
      warnings: [],
    },
  };
}

function createHarness() {
  let stepCounter = 0;
  const steps: IntakeActionStep[] = [];
  const decisions: Array<Record<string, unknown>> = [];
  const callOrder: string[] = [];
  const events: string[] = [];

  const getKnowledgeDocument = vi.fn<
    (ownerId: string, documentId: string) =>
      Promise<IntakeKnowledgeDocument | null>
  >(async () => ({
    id: DOCUMENT_ID,
    collectionId: "collection-old",
    title: "Source document",
  }));
  const archiveDocument = vi.fn(async (input: {
    documentId: string;
    collectionName: string;
  }) => {
    events.push("archive");
    callOrder.push("archive");
    return {
      result: {
        archived: true,
        collectionId: "collection-new",
        collectionName: input.collectionName,
      },
      updatedDocument: {
        id: input.documentId,
        collection_id: "collection-new",
        title: "Source document",
      },
    };
  });
  const executeAction = vi.fn(
    async (
      _ownerId: string,
      action: { action: string; input: Record<string, unknown> },
      _requestId: string,
    ) => {
      events.push(action.action);
      callOrder.push(action.action);
      return {
        result: createdRecord(action.action, action.input),
        replayed: false,
      };
    },
  );
  const createRelation = vi.fn(
    async (input: IntakeRelationInput) => {
      const label =
        input.target_type === "calendar_event"
          ? "calendar"
          : input.target_type;
      events.push(`relation.create:${label}`);
      callOrder.push(`relation.create:${label}`);
      return {
        result: {
          id: `relation-${input.target_type}`,
          ...withoutOwnerId(input),
        },
        replayed: false,
      };
    },
  );

  function persistPendingSteps(
    pending: Array<{
      id?: string;
      sequence: number;
      actionName: string;
      forwardInput: Record<string, unknown>;
      confidence: number;
    }>,
  ) {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (["pending", "failed"].includes(steps[index]!.status)) {
        steps.splice(index, 1);
      }
    }
    for (const step of pending) {
      if (
        steps.some(
          (existing) =>
            existing.id === step.id ||
            existing.sequence === step.sequence,
        )
      ) {
        throw new Error("TEST_STEP_UNIQUE_CONFLICT");
      }
      stepCounter += 1;
      steps.push({
        id: step.id ?? `step-${stepCounter}`,
        batchId: BATCH_ID,
        itemId: ITEM_ID,
        sequence: step.sequence,
        actionName: step.actionName,
        forwardInput: step.forwardInput,
        forwardResult: null,
        inverseAction: null,
        inverseInput: null,
        conflictFingerprint: null,
        status: "pending",
        confidence: step.confidence,
        errorCode: null,
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: null,
        undoneAt: null,
      });
    }
    steps.sort((left, right) => left.sequence - right.sequence);
  }

  const getBatch = vi.fn(async () => ({
    id: BATCH_ID,
    items: [
      {
        id: ITEM_ID,
        invalidPlanCount: 0,
        steps: steps.map((step) => ({
          ...step,
          forwardInput: { ...step.forwardInput },
        })),
      },
    ],
  }));
  const renewLease = vi.fn(async () => undefined);
  const setItemDecision = vi.fn(async (input: Record<string, unknown>) => {
    decisions.push({ ...input });
  });
  const replacePendingSteps = vi.fn(
    async (input: { steps: Parameters<typeof persistPendingSteps>[0] }) => {
      persistPendingSteps(input.steps);
      events.push("replacePendingSteps");
    },
  );
  const markStepCompleted = vi.fn(
    async (input: {
      stepId: string;
      forwardResult: unknown;
      inverseAction: string | null;
      inverseInput: Record<string, unknown> | null;
      conflictFingerprint: string | null;
    }) => {
      const step = steps.find((candidate) => candidate.id === input.stepId);
      if (!step) throw new Error("TEST_STEP_NOT_FOUND");
      Object.assign(step, {
        status: "completed",
        forwardResult: input.forwardResult,
        inverseAction: input.inverseAction,
        inverseInput: input.inverseInput,
        conflictFingerprint: input.conflictFingerprint,
        completedAt: NOW,
        errorCode: null,
      });
    },
  );
  const markStepFailed = vi.fn(
    async (input: { stepId: string; errorCode: string }) => {
      const step = steps.find((candidate) => candidate.id === input.stepId);
      if (!step) throw new Error("TEST_STEP_NOT_FOUND");
      Object.assign(step, {
        status: "failed",
        errorCode: input.errorCode,
      });
    },
  );

  const repository = {
    getBatch,
    renewLease,
    setItemDecision,
    replacePendingSteps,
    markStepCompleted,
    markStepFailed,
  } as unknown as IntakeRepository;

  const dependencies: IntakeExecutorDependencies = {
    repository,
    getKnowledgeDocument,
    archiveDocument,
    executeAction,
    createRelation,
  };

  return {
    dependencies,
    steps,
    decisions,
    callOrder,
    events,
    getKnowledgeDocument,
    archiveDocument,
    executeAction,
    createRelation,
    getBatch,
    renewLease,
    setItemDecision,
    replacePendingSteps,
    markStepCompleted,
    markStepFailed,
    persistPendingSteps,
    retryFailedSteps() {
      for (const step of steps) {
        if (step.status === "failed") {
          step.status = "pending";
          step.errorCode = null;
        }
      }
    },
  };
}

function createdRecord(
  actionName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (actionName === "note.create") {
    return { id: "note-1", content: "", tags: [], ...input };
  }
  if (actionName === "todo.create") {
    return {
      id: "todo-1",
      status: "pending",
      priority: "medium",
      ...input,
    };
  }
  if (actionName === "calendar.create") {
    return { id: "calendar-1", ...input };
  }
  throw new Error(`Unexpected action: ${actionName}`);
}

function completedStep(steps: IntakeActionStep[], actionName: string) {
  const step = steps.find((candidate) => candidate.actionName === actionName);
  if (!step) throw new Error(`Missing step: ${actionName}`);
  return step;
}

function withoutOwnerId(input: object) {
  const { ownerId: _ownerId, ...result } = input as Record<string, unknown>;
  return result;
}
