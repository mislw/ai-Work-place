// @vitest-environment node
import type { WorkbenchAction } from "@/lib/assistant/actions";
import type {
  CreateIntakeBatchRequest,
  IntakeActionStep,
  IntakeBatch,
  IntakeItem,
  WorkspaceIntakePlanV1,
} from "@/lib/intake/contracts";
import { executeIntakePlan } from "@/lib/intake/executor";
import {
  fingerprintRecord,
  normalizeFingerprintValue,
} from "@/lib/intake/fingerprint";
import type {
  CreateHermesRunInput,
  HermesRun,
  HermesRunsClient,
} from "@/lib/intake/hermes-runs";
import { runIntakeWorker } from "@/lib/intake/orchestrator";
import type {
  ClaimedIntakeItem,
  IntakeRepository,
  ReversibleRecordTable,
  UndoStepResult,
} from "@/lib/intake/repository";
import { undoIntakeBatch } from "@/lib/intake/undo";
import { describe, expect, it } from "vitest";

const OWNER_ID = "owner-1";
const BATCH_ID = "10000000-0000-4000-8000-000000000001";
const ITEM_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];
const ASSET_IDS = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
];
const DOCUMENT_IDS = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
];
const JOB_IDS = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
];
const NOW = "2026-09-06T10:00:00.000Z";

describe("global Hermes file intake integration", () => {
  it("persists a multi-file batch through replay, refresh, receipts, and safe undo", async () => {
    const harness = new IntakeIntegrationHarness();
    const request = createRegistrationRequest();

    const firstRegistration = await harness.repository.registerBatch(
      OWNER_ID,
      request,
    );
    const replayedRegistration = await harness.repository.registerBatch(
      OWNER_ID,
      request,
    );

    expect(firstRegistration.registration).toBe("created");
    expect(replayedRegistration.registration).toBe("replayed");
    expect(replayedRegistration.batch.items).toHaveLength(2);

    await harness.runWorkerUntilIdle();

    const recovered = await harness.repository.getBatch(OWNER_ID, BATCH_ID);
    expect(recovered?.status).toBe("completed");
    expect(recovered?.items.flatMap((item) => item.steps)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: "archive", status: "completed" }),
        expect.objectContaining({
          actionName: "todo.create",
          status: "completed",
        }),
        expect.objectContaining({
          actionName: "note.create",
          status: "completed",
        }),
        expect.objectContaining({
          actionName: "calendar.create",
          status: "completed",
        }),
      ]),
    );
    expect(harness.businessCounts()).toEqual({
      calendar: 1,
      notes: 1,
      relations: 3,
      todos: 1,
    });

    harness.redeliverCompletedItems();
    await harness.runWorkerUntilIdle();

    expect(harness.businessCounts()).toEqual({
      calendar: 1,
      notes: 1,
      relations: 3,
      todos: 1,
    });
    expect(harness.runs.createCount).toBe(4);
    expect(harness.originalAssetsAvailable()).toEqual([true, true]);

    const todo = harness.onlyRecord("todos");
    harness.records.todos.set(todo.id as string, {
      ...todo,
      title: "用户编辑后的待办标题",
    });

    const undone = await undoIntakeBatch(OWNER_ID, BATCH_ID, {
      repository: harness.repository,
      now: () => new Date(NOW),
    });

    expect(undone.status).toBe("partial");
    expect(
      undone.items
        .flatMap((item) => item.steps)
        .find((step) => step.actionName === "todo.create"),
    ).toMatchObject({ status: "undo_conflict" });
    expect(harness.records.todos.has(todo.id as string)).toBe(true);
    expect(harness.records.notes.size).toBe(0);
    expect(harness.records.calendar_events.size).toBe(0);
    expect(harness.relations.size).toBe(0);
    expect(harness.originalAssetsAvailable()).toEqual([true, true]);
  });
});

class IntakeIntegrationHarness {
  readonly assets = new Map(
    ASSET_IDS.map((id) => [id, { id, available: true }]),
  );
  readonly documents = new Map(
    DOCUMENT_IDS.map((id, index) => [
      id,
      {
        id,
        collectionId: null as string | null,
        title: `Document ${index + 1}`,
      },
    ]),
  );
  readonly knowledge = new Map(
    DOCUMENT_IDS.map((id, index) => [
      id,
      {
        id,
        title: `Document ${index + 1}`,
        documentType: "text",
        status: "ready",
        stage: "complete",
        summary: `Durable extracted document ${index + 1}`,
        tags: ["Hermes"],
        entities: [],
        importantDates: [],
        proposals: [],
      },
    ]),
  );
  readonly records: Record<
    ReversibleRecordTable,
    Map<string, Record<string, unknown>>
  > = {
    notes: new Map(),
    todos: new Map(),
    calendar_events: new Map(),
  };
  readonly relations = new Map<string, Record<string, unknown>>();
  readonly runs = new FixtureRuns(new Map([
    [DOCUMENT_IDS[0]!, archiveAndTodoPlan(DOCUMENT_IDS[0]!)],
    [DOCUMENT_IDS[1]!, noteAndCalendarPlan(DOCUMENT_IDS[1]!)],
  ]));

  private batch: IntakeBatch | null = null;
  private registrationKey: string | null = null;
  private readonly receipts = new Map<
    string,
    { result: Record<string, unknown>; replayed: boolean }
  >();
  private nextBusinessId = 0;
  private nextRelationId = 0;

  readonly repository: IntakeRepository = {
    registerBatch: async (ownerId, request) => {
      const key = `${ownerId}:${request.clientBatchId}`;
      if (this.batch && this.registrationKey === key) {
        return { batch: clone(this.batch), registration: "replayed" };
      }
      if (ownerId !== OWNER_ID) throw new Error("INTAKE_OWNER_MISMATCH");
      this.registrationKey = key;
      this.batch = createBatch(request);
      return { batch: clone(this.batch), registration: "created" };
    },
    listActiveAndRecent: async (ownerId) => {
      const batch = this.ownerBatch(ownerId);
      return batch ? [clone(batch)] : [];
    },
    getBatch: async (ownerId, batchId) => {
      const batch = this.ownerBatch(ownerId, batchId);
      return batch ? clone(batch) : null;
    },
    claimNextItem: async (workerId, leaseSeconds) => {
      const batch = this.requireBatch();
      const item = batch.items.find((candidate) =>
        ["waiting_extraction", "awaiting_hermes"].includes(candidate.status),
      );
      if (!item) return null;
      item.status = "orchestrating";
      item.attemptCount += 1;
      item.leaseOwner = workerId;
      item.leaseExpiresAt = new Date(
        Date.parse(NOW) + leaseSeconds * 1_000,
      ).toISOString();
      item.updatedAt = NOW;
      batch.status = "orchestrating";
      batch.updatedAt = NOW;
      return claimed(item, batch.pageContext);
    },
    renewLease: async (itemId, workerId, leaseSeconds) => {
      const item = this.requireLeasedItem(itemId, workerId);
      item.leaseExpiresAt = new Date(
        Date.parse(NOW) + leaseSeconds * 1_000,
      ).toISOString();
    },
    attachHermesRun: async (itemId, workerId, runId) => {
      const item = this.requireLeasedItem(itemId, workerId);
      item.hermesRunId = runId;
      item.status = "orchestrating";
    },
    attachHermesCorrectionRun: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      item.hermesRunId = input.runId;
      item.invalidPlanCount = input.invalidPlanCount;
    },
    setItemDecision: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      item.status = input.status;
      item.confidence = input.confidence;
      item.decisionSummary = input.decisionSummary;
      item.invalidPlanCount = input.invalidPlanCount;
      item.errorCode = input.errorCode ?? null;
      item.leaseOwner = null;
      item.leaseExpiresAt = null;
      item.completedAt = ["completed", "partial", "failed"].includes(
        input.status,
      )
        ? NOW
        : null;
      this.aggregateBatchStatus();
    },
    replacePendingSteps: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      for (const pending of input.steps) {
        const existing = item.steps.find(
          (step) => step.sequence === pending.sequence,
        );
        if (existing?.status === "completed") continue;
        const step: IntakeActionStep = {
          id: pending.id ?? integrationUuid(900 + pending.sequence),
          batchId: input.batchId,
          itemId: input.itemId,
          sequence: pending.sequence,
          actionName: pending.actionName,
          forwardInput: pending.forwardInput,
          forwardResult: null,
          inverseAction: null,
          inverseInput: null,
          conflictFingerprint: null,
          status: "pending",
          confidence: pending.confidence,
          errorCode: null,
          createdAt: existing?.createdAt ?? NOW,
          updatedAt: NOW,
          completedAt: null,
          undoneAt: null,
        };
        if (existing) item.steps[item.steps.indexOf(existing)] = step;
        else item.steps.push(step);
      }
      item.steps.sort((left, right) => left.sequence - right.sequence);
      item.status = "executing";
      this.requireBatch().status = "executing";
    },
    markStepCompleted: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      const step = requireStep(item, input.stepId);
      step.status = "completed";
      step.forwardResult = input.forwardResult;
      step.inverseAction = input.inverseAction;
      step.inverseInput = input.inverseInput;
      step.conflictFingerprint = input.conflictFingerprint;
      step.errorCode = null;
      step.updatedAt = NOW;
      step.completedAt = NOW;
    },
    markStepFailed: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      const step = requireStep(item, input.stepId);
      step.status = "failed";
      step.errorCode = input.errorCode;
      step.updatedAt = NOW;
    },
    releaseItem: async (input) => {
      const item = this.requireLeasedItem(input.itemId, input.workerId);
      item.status = input.status;
      item.errorCode = input.errorCode;
      item.availableAt = input.availableAt;
      item.leaseOwner = null;
      item.leaseExpiresAt = null;
    },
    retryFailed: async (ownerId, batchId) => {
      const batch = this.requireOwnerBatch(ownerId, batchId);
      for (const item of batch.items) {
        if (["failed", "partial"].includes(item.status)) {
          item.status = "awaiting_hermes";
          item.errorCode = null;
        }
      }
      batch.status = "processing";
      return clone(batch);
    },
    cancel: async (ownerId, batchId) => {
      const batch = this.requireOwnerBatch(ownerId, batchId);
      batch.status = "cancelled";
      for (const item of batch.items) item.status = "cancelled";
      return clone(batch);
    },
    beginUndo: async (ownerId, batchId) => {
      const batch = this.requireOwnerBatch(ownerId, batchId);
      if (!["completed", "partial"].includes(batch.status)) {
        throw new Error("INTAKE_BATCH_NOT_UNDOABLE");
      }
      batch.status = "undoing";
      return clone(batch);
    },
    undoRecordStep: async (input) => {
      const batch = this.requireOwnerBatch(input.ownerId, input.batchId);
      const step = requireBatchStep(batch, input.itemId, input.stepId);
      const records = this.records[input.table];
      const current = records.get(input.recordId);
      if (!current) return markUndo(step, "already_missing");
      if (!matchesFingerprint(current, input.expectedFingerprint)) {
        return markUndo(step, "conflict");
      }
      records.delete(input.recordId);
      return markUndo(step, "undone");
    },
    undoArchiveStep: async (input) => {
      const batch = this.requireOwnerBatch(input.ownerId, input.batchId);
      const step = requireBatchStep(batch, input.itemId, input.stepId);
      const document = this.documents.get(input.documentId);
      if (!document) return markUndo(step, "already_missing");
      const snapshot = {
        id: document.id,
        collection_id: document.collectionId,
      };
      if (!matchesFingerprint(snapshot, input.expectedFingerprint)) {
        return markUndo(step, "conflict");
      }
      document.collectionId = input.previousCollectionId;
      return markUndo(step, "undone");
    },
    undoRelationStep: async (input) => {
      const batch = this.requireOwnerBatch(input.ownerId, input.batchId);
      const step = requireBatchStep(batch, input.itemId, input.stepId);
      const current = this.relations.get(input.relationId);
      if (!current) return markUndo(step, "already_missing");
      if (!matchesFingerprint(current, input.expectedFingerprint)) {
        return markUndo(step, "conflict");
      }
      this.relations.delete(input.relationId);
      return markUndo(step, "undone");
    },
    markReplayedRelationUndone: async (input) => {
      const batch = this.requireOwnerBatch(input.ownerId, input.batchId);
      const step = requireBatchStep(batch, input.itemId, input.stepId);
      markUndo(step, "undone");
      return "undone";
    },
    finishUndo: async (ownerId, batchId, status = "undone") => {
      const batch = this.requireOwnerBatch(ownerId, batchId);
      batch.status = status;
      batch.errorCode = status === "partial" ? "UNDO_RECORD_CHANGED" : null;
      batch.undoneAt = NOW;
      return clone(batch);
    },
    clearExpiredUndoData: async (input) => {
      const batch = this.requireOwnerBatch(input.ownerId, input.batchId);
      for (const step of batch.items.flatMap((item) => item.steps)) {
        step.inverseInput = null;
        step.conflictFingerprint = null;
      }
    },
  };

  async runWorkerUntilIdle() {
    const controller = new AbortController();
    await runIntakeWorker({
      dependencies: {
        repository: this.repository,
        runs: this.runs as unknown as HermesRunsClient,
        getKnowledgeItem: async (ownerId, documentId) => {
          if (ownerId !== OWNER_ID) return null;
          return clone(this.knowledge.get(documentId) ?? null);
        },
        executePlan: (input) =>
          executeIntakePlan(input, {
            repository: this.repository,
            getKnowledgeDocument: async (ownerId, documentId) => {
              if (ownerId !== OWNER_ID) return null;
              return clone(this.documents.get(documentId) ?? null);
            },
            archiveDocument: async (input) => {
              const document = this.documents.get(input.documentId);
              if (!document || input.ownerId !== OWNER_ID) {
                throw new Error("INTAKE_DOCUMENT_NOT_OWNED");
              }
              document.collectionId = "collection-hermes";
              return {
                result: { collectionId: document.collectionId },
                updatedDocument: clone(document),
              };
            },
            executeAction: (ownerId, action, requestId) =>
              this.executeAction(ownerId, action, requestId),
            createRelation: (input) => this.createRelation(input),
          }),
        now: () => new Date(NOW),
        sleep: async (_milliseconds, signal) => {
          controller.abort();
          throw signal.reason;
        },
      },
      signal: controller.signal,
      pollMs: 1,
    });
  }

  redeliverCompletedItems() {
    const batch = this.requireBatch();
    for (const item of batch.items) {
      item.status = "awaiting_hermes";
      item.hermesRunId = null;
      item.leaseOwner = null;
      item.leaseExpiresAt = null;
      item.completedAt = null;
    }
    batch.status = "processing";
    batch.completedAt = null;
  }

  businessCounts() {
    return {
      calendar: this.records.calendar_events.size,
      notes: this.records.notes.size,
      relations: this.relations.size,
      todos: this.records.todos.size,
    };
  }

  originalAssetsAvailable() {
    return ASSET_IDS.map((id) => this.assets.get(id)?.available === true);
  }

  onlyRecord(table: ReversibleRecordTable) {
    const records = [...this.records[table].values()];
    if (records.length !== 1) throw new Error("EXPECTED_ONE_RECORD");
    return records[0]!;
  }

  private async executeAction(
    ownerId: string,
    action: WorkbenchAction,
    requestId: string,
  ) {
    if (ownerId !== OWNER_ID) throw new Error("ACTION_OWNER_MISMATCH");
    const existing = this.receipts.get(requestId);
    if (existing) return { result: clone(existing.result), replayed: true };

    const input = action.input as Record<string, unknown>;
    const id = `business-${++this.nextBusinessId}`;
    let table: ReversibleRecordTable;
    let result: Record<string, unknown>;
    if (action.action === "note.create") {
      table = "notes";
      result = {
        id,
        title: input.title,
        content: input.content ?? "",
        tags: input.tags ?? [],
      };
    } else if (action.action === "todo.create") {
      table = "todos";
      result = { id, ...input };
    } else if (action.action === "calendar.create") {
      table = "calendar_events";
      result = { id, ...input };
    } else {
      throw new Error("UNSAFE_INTAKE_ACTION");
    }
    this.records[table].set(id, result);
    this.receipts.set(requestId, { result: clone(result), replayed: false });
    return { result: clone(result), replayed: false };
  }

  private async createRelation(input: {
    ownerId: string;
    source_type: "knowledge_document";
    source_id: string;
    target_type: "note" | "todo" | "calendar_event";
    target_id: string;
    relation_type: "source_of";
    creator: "assistant";
    confidence: number;
  }) {
    const existing = [...this.relations.values()].find(
      (relation) =>
        relation.source_id === input.source_id &&
        relation.target_type === input.target_type &&
        relation.target_id === input.target_id &&
        relation.relation_type === input.relation_type,
    );
    if (existing) return { result: clone(existing), replayed: true };
    const id = `relation-${++this.nextRelationId}`;
    const relation = { id, ...input };
    this.relations.set(id, relation);
    return { result: clone(relation), replayed: false };
  }

  private aggregateBatchStatus() {
    const batch = this.requireBatch();
    if (!batch.items.every((item) => isTerminal(item.status))) return;
    batch.status = batch.items.every((item) => item.status === "completed")
      ? "completed"
      : batch.items.some((item) =>
          ["completed", "partial"].includes(item.status),
        )
        ? "partial"
        : "failed";
    batch.completedAt = NOW;
    batch.updatedAt = NOW;
  }

  private requireLeasedItem(itemId: string, workerId: string) {
    const item = this.requireBatch().items.find((candidate) => candidate.id === itemId);
    if (!item || item.leaseOwner !== workerId) {
      throw new Error("INTAKE_LEASE_LOST");
    }
    return item;
  }

  private ownerBatch(ownerId: string, batchId = BATCH_ID) {
    return ownerId === OWNER_ID && this.batch?.id === batchId ? this.batch : null;
  }

  private requireOwnerBatch(ownerId: string, batchId: string) {
    const batch = this.ownerBatch(ownerId, batchId);
    if (!batch) throw new Error("INTAKE_BATCH_NOT_FOUND");
    return batch;
  }

  private requireBatch() {
    if (!this.batch) throw new Error("INTAKE_BATCH_NOT_FOUND");
    return this.batch;
  }
}

class FixtureRuns {
  createCount = 0;

  constructor(private readonly plans: Map<string, WorkspaceIntakePlanV1>) {}

  async createRun(input: CreateHermesRunInput): Promise<HermesRun> {
    const plan = this.plans.get(input.metadata.documentId);
    if (!plan) throw new Error("FIXTURE_PLAN_NOT_FOUND");
    this.createCount += 1;
    return {
      runId: `fixture-${this.createCount}`,
      status: "completed",
      createdAtMs: Date.parse(NOW),
      output: JSON.stringify(plan),
    };
  }

  async getRun(): Promise<never> {
    throw new Error("FIXTURE_RUN_SHOULD_COMPLETE_ON_CREATE");
  }

  async getEvents(): Promise<never> {
    throw new Error("FIXTURE_EVENTS_NOT_USED");
  }

  async stopRun(runId: string): Promise<HermesRun> {
    return { runId, status: "cancelled" };
  }
}

function createRegistrationRequest(): CreateIntakeBatchRequest {
  return {
    clientBatchId: "client-batch-integration",
    sourceType: "file_drop",
    pageContext: {
      version: 1,
      route: "/todos",
      pageType: "todos",
      capturedAt: NOW,
      timezone: "Asia/Shanghai",
      trigger: {
        kind: "file_drop",
        clientBatchId: "client-batch-integration",
      },
    },
    items: DOCUMENT_IDS.map((documentId, index) => ({
      assetId: ASSET_IDS[index]!,
      documentId,
      jobId: JOB_IDS[index]!,
    })),
  };
}

function createBatch(request: CreateIntakeBatchRequest): IntakeBatch {
  return {
    id: BATCH_ID,
    clientBatchId: request.clientBatchId,
    sourceType: request.sourceType,
    pageContext: clone(request.pageContext),
    status: "processing",
    summary: null,
    errorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    undoneAt: null,
    items: request.items.map((input, index) => ({
      id: ITEM_IDS[index]!,
      batchId: BATCH_ID,
      assetId: input.assetId,
      documentId: input.documentId,
      jobId: input.jobId,
      hermesRunId: null,
      status: "awaiting_hermes",
      confidence: null,
      decisionSummary: null,
      errorCode: null,
      attemptCount: 0,
      invalidPlanCount: 0,
      availableAt: NOW,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      steps: [],
    })),
  };
}

function archiveAndTodoPlan(documentId: string): WorkspaceIntakePlanV1 {
  return {
    version: 1,
    documentId,
    summary: "Archive source and create a todo",
    confidence: 0.9,
    actions: [
      { kind: "archive", collectionName: "Hermes" },
      { kind: "todo.create", input: { title: "Review intake" } },
    ],
    warnings: [],
  };
}

function noteAndCalendarPlan(documentId: string): WorkspaceIntakePlanV1 {
  return {
    version: 1,
    documentId,
    summary: "Create a note and calendar event",
    confidence: 0.85,
    actions: [
      { kind: "note.create", input: { title: "Intake note" } },
      {
        kind: "calendar.create",
        input: { title: "Intake review", event_date: "2026-09-07" },
      },
    ],
    warnings: [],
  };
}

function claimed(
  item: IntakeItem,
  pageContext: IntakeBatch["pageContext"],
): ClaimedIntakeItem {
  const { steps: _steps, ...fields } = clone(item);
  return { ...fields, ownerId: OWNER_ID, pageContext: clone(pageContext) };
}

function requireStep(item: IntakeItem, stepId: string) {
  const step = item.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error("INTAKE_STEP_NOT_FOUND");
  return step;
}

function requireBatchStep(batch: IntakeBatch, itemId: string, stepId: string) {
  const item = batch.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("INTAKE_ITEM_NOT_FOUND");
  return requireStep(item, stepId);
}

function markUndo(
  step: IntakeActionStep,
  result: UndoStepResult,
): UndoStepResult {
  step.status = result === "conflict" ? "undo_conflict" : "undone";
  step.undoneAt = result === "conflict" ? null : NOW;
  step.updatedAt = NOW;
  return result;
}

function matchesFingerprint(
  value: Record<string, unknown>,
  expectedFingerprint: string,
) {
  const normalized = normalizeFingerprintValue(value) as Record<string, unknown>;
  return fingerprintRecord(normalized) === expectedFingerprint;
}

function isTerminal(status: IntakeItem["status"]) {
  return ["completed", "partial", "failed", "cancelled"].includes(status);
}

function integrationUuid(value: number) {
  return `90000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
