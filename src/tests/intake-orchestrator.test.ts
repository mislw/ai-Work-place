// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { HermesRunsClient } from "@/lib/intake/hermes-runs";
import type {
  ClaimedIntakeItem,
  IntakeRepository,
} from "@/lib/intake/repository";
import {
  processClaimedIntakeItem,
  runIntakeWorker,
  type IntakeOrchestratorDependencies,
} from "@/lib/intake/orchestrator";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-09-05T08:00:00.000Z";
const CORRECTION_INSTRUCTION = [
  "Your previous terminal output failed WorkspaceIntakePlanV1 validation.",
  "Return only one corrected JSON object. Do not add markdown or prose.",
].join("\n");

const VALID_PLAN = JSON.stringify({
  version: 1,
  documentId: DOCUMENT_ID,
  summary: "Archive the source and create one todo.",
  confidence: 0.8,
  actions: [
    { kind: "archive", collectionName: "Hermes" },
    { kind: "todo.create", input: { title: "Review intake" } },
  ],
  warnings: [],
});

const READY_ITEM = {
  id: DOCUMENT_ID,
  assetId: ASSET_ID,
  title: "Hermes intake",
  documentType: "text",
  status: "ready",
  stage: "complete",
  summary: "A durable extracted knowledge item.",
  tags: ["Hermes"],
  originalName: "intake.txt",
  mimeType: "text/plain",
  proposals: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const claimedItem: ClaimedIntakeItem = {
  id: ITEM_ID,
  batchId: BATCH_ID,
  assetId: ASSET_ID,
  documentId: DOCUMENT_ID,
  jobId: JOB_ID,
  hermesRunId: null,
  status: "orchestrating",
  confidence: null,
  decisionSummary: null,
  errorCode: null,
  attemptCount: 1,
  invalidPlanCount: 0,
  availableAt: NOW,
  leaseOwner: "worker-1",
  leaseExpiresAt: "2026-09-05T08:02:00.000Z",
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  ownerId: "owner-1",
  pageContext: {
    version: 1,
    route: "/todos",
    pageType: "todos",
    capturedAt: NOW,
    timezone: "Asia/Shanghai",
    trigger: {
      kind: "file_drop",
      clientBatchId: "client-batch-1",
    },
  },
};

function createHarness() {
  const repository = {
    registerBatch: vi.fn(),
    listActiveAndRecent: vi.fn(),
    getBatch: vi.fn(),
    claimNextItem: vi.fn(),
    renewLease: vi.fn(),
    attachHermesRun: vi.fn(),
    setItemDecision: vi.fn(),
    replacePendingSteps: vi.fn(),
    markStepCompleted: vi.fn(),
    markStepFailed: vi.fn(),
    releaseItem: vi.fn(),
    retryFailed: vi.fn(),
    cancel: vi.fn(),
    beginUndo: vi.fn(),
    finishUndo: vi.fn(),
  };
  const runs = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    getEvents: vi.fn(),
    stopRun: vi.fn(),
  };
  const getKnowledgeItem = vi.fn().mockResolvedValue(READY_ITEM);
  const executePlan = vi.fn();
  const sleep = vi.fn().mockResolvedValue(undefined);
  const now = vi.fn(() => new Date(NOW));
  const dependencies: IntakeOrchestratorDependencies = {
    repository: repository as unknown as IntakeRepository,
    runs: runs as unknown as HermesRunsClient,
    getKnowledgeItem,
    executePlan,
    sleep,
    now,
  };
  return {
    repository,
    runs,
    getKnowledgeItem,
    executePlan,
    sleep,
    now,
    dependencies,
  };
}

describe("processClaimedIntakeItem", () => {
  it("fails closed when the claimed item has no lease owner", async () => {
    const harness = createHarness();

    await expect(
      processClaimedIntakeItem(
        { ...claimedItem, leaseOwner: null },
        harness.dependencies,
      ),
    ).rejects.toThrow("INTAKE_LEASE_OWNER_REQUIRED");

    expect(harness.getKnowledgeItem).not.toHaveBeenCalled();
    expect(harness.runs.createRun).not.toHaveBeenCalled();
    expect(harness.repository.releaseItem).not.toHaveBeenCalled();
  });

  it("waits for extraction before starting Hermes", async () => {
    const harness = createHarness();
    harness.getKnowledgeItem.mockResolvedValue({
      status: "analyzing",
      stage: "analyzing",
    });

    await processClaimedIntakeItem(claimedItem, harness.dependencies);

    expect(harness.runs.createRun).not.toHaveBeenCalled();
    expect(harness.repository.releaseItem).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      itemId: claimedItem.id,
      workerId: "worker-1",
      status: "waiting_extraction",
      errorCode: null,
      availableAt: "2026-09-05T08:00:10.000Z",
    });
  });

  it("persists a started run id, polls active statuses, and hands off one plan", async () => {
    const harness = createHarness();
    harness.runs.createRun.mockResolvedValue({
      runId: "run-1",
      status: "started",
    });
    harness.runs.getRun
      .mockResolvedValueOnce({ runId: "run-1", status: "queued" })
      .mockResolvedValueOnce({ runId: "run-1", status: "running" })
      .mockResolvedValueOnce({ runId: "run-1", status: "stopping" })
      .mockResolvedValueOnce({
        runId: "run-1",
        status: "completed",
        output: VALID_PLAN,
      });

    await processClaimedIntakeItem(claimedItem, harness.dependencies);

    expect(harness.repository.attachHermesRun).toHaveBeenCalledWith(
      claimedItem.id,
      "worker-1",
      "run-1",
    );
    expect(harness.sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      1_000,
      2_000,
      4_000,
      5_000,
    ]);
    expect(harness.repository.renewLease).toHaveBeenCalledTimes(4);
    expect(harness.runs.getRun).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 4; index += 1) {
      expect(
        harness.repository.renewLease.mock.invocationCallOrder[index],
      ).toBeLessThan(harness.runs.getRun.mock.invocationCallOrder[index]!);
    }
    expect(harness.executePlan).toHaveBeenCalledTimes(1);
    expect(harness.executePlan).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      batchId: claimedItem.batchId,
      itemId: claimedItem.id,
      documentId: claimedItem.documentId,
      plan: JSON.parse(VALID_PLAN),
    });
  });

  it.each([
    [1, "2026-09-05T08:00:10.000Z"],
    [20, "2026-09-05T08:15:00.000Z"],
  ])(
    "releases unavailable Hermes attempt %i with bounded exponential backoff",
    async (attemptCount, availableAt) => {
      const harness = createHarness();
      harness.runs.createRun.mockRejectedValue(
        new Error("private provider failure text"),
      );

      await processClaimedIntakeItem(
        { ...claimedItem, attemptCount },
        harness.dependencies,
      );

      expect(harness.repository.releaseItem).toHaveBeenCalledWith({
        ownerId: claimedItem.ownerId,
        itemId: claimedItem.id,
        workerId: "worker-1",
        status: "awaiting_hermes",
        errorCode: "HERMES_UNAVAILABLE",
        availableAt,
      });
      expect(JSON.stringify(harness.repository.releaseItem.mock.calls)).not.toContain(
        "private provider failure text",
      );
    },
  );

  it("creates one correction run without persisting rejected terminal output", async () => {
    const harness = createHarness();
    const rejectedOutput = "rejected-private-output";
    harness.runs.createRun
      .mockResolvedValueOnce({ runId: "run-1", status: "started" })
      .mockResolvedValueOnce({ runId: "run-2", status: "started" });
    harness.runs.getRun
      .mockResolvedValueOnce({
        runId: "run-1",
        status: "completed",
        output: rejectedOutput,
      })
      .mockResolvedValueOnce({
        runId: "run-2",
        status: "completed",
        output: VALID_PLAN,
      });

    await processClaimedIntakeItem(claimedItem, harness.dependencies);

    expect(harness.runs.createRun).toHaveBeenCalledTimes(2);
    const firstRequest = harness.runs.createRun.mock.calls[0]![0];
    const correctionRequest = harness.runs.createRun.mock.calls[1]![0];
    expect(correctionRequest.prompt).toBe(
      `${firstRequest.prompt}\n\n${CORRECTION_INSTRUCTION}`,
    );
    expect(correctionRequest.prompt).not.toContain(rejectedOutput);
    expect(harness.repository.setItemDecision).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      itemId: claimedItem.id,
      workerId: "worker-1",
      status: "orchestrating",
      confidence: null,
      decisionSummary: null,
      invalidPlanCount: 1,
      errorCode: null,
    });
    expect(JSON.stringify(harness.repository.setItemDecision.mock.calls)).not.toContain(
      rejectedOutput,
    );
    expect(harness.repository.attachHermesRun).toHaveBeenNthCalledWith(
      2,
      claimedItem.id,
      "worker-1",
      "run-2",
    );
    expect(harness.executePlan).toHaveBeenCalledTimes(1);
  });

  it("marks a second invalid terminal plan failed", async () => {
    const harness = createHarness();
    harness.runs.getRun.mockResolvedValue({
      runId: "run-existing",
      status: "completed",
      output: "still-not-json",
    });

    await processClaimedIntakeItem(
      {
        ...claimedItem,
        hermesRunId: "run-existing",
        invalidPlanCount: 1,
      },
      harness.dependencies,
    );

    expect(harness.runs.createRun).not.toHaveBeenCalled();
    expect(harness.executePlan).not.toHaveBeenCalled();
    expect(harness.repository.setItemDecision).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      itemId: claimedItem.id,
      workerId: "worker-1",
      status: "failed",
      confidence: null,
      decisionSummary: null,
      invalidPlanCount: 2,
      errorCode: "INVALID_HERMES_PLAN",
    });
  });

  it("stops approval-gated runs and records a stable failure", async () => {
    const harness = createHarness();
    harness.runs.getRun.mockResolvedValue({
      runId: "run-approval",
      status: "waiting_for_approval",
    });
    harness.runs.stopRun.mockResolvedValue({
      runId: "run-approval",
      status: "stopping",
    });

    await processClaimedIntakeItem(
      { ...claimedItem, hermesRunId: "run-approval" },
      harness.dependencies,
    );

    expect(harness.runs.stopRun).toHaveBeenCalledWith("run-approval");
    expect(harness.repository.setItemDecision).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      itemId: claimedItem.id,
      workerId: "worker-1",
      status: "failed",
      confidence: null,
      decisionSummary: null,
      invalidPlanCount: 0,
      errorCode: "HERMES_APPROVAL_REQUIRED",
    });
  });

  it("stops an attached run on cancellation and performs no repository writes", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();

    await processClaimedIntakeItem(
      { ...claimedItem, hermesRunId: "run-cancelled" },
      harness.dependencies,
      controller.signal,
    );

    expect(harness.runs.stopRun).toHaveBeenCalledWith("run-cancelled");
    expect(harness.getKnowledgeItem).not.toHaveBeenCalled();
    expect(harness.repository.renewLease).not.toHaveBeenCalled();
    expect(harness.repository.attachHermesRun).not.toHaveBeenCalled();
    expect(harness.repository.releaseItem).not.toHaveBeenCalled();
    expect(harness.repository.setItemDecision).not.toHaveBeenCalled();
    expect(harness.executePlan).not.toHaveBeenCalled();
  });

  it("recovers an attached completed run without creating another run", async () => {
    const harness = createHarness();
    harness.runs.getRun.mockResolvedValue({
      runId: "run-completed",
      status: "completed",
      output: VALID_PLAN,
    });

    await processClaimedIntakeItem(
      { ...claimedItem, hermesRunId: "run-completed" },
      harness.dependencies,
    );

    expect(harness.runs.createRun).not.toHaveBeenCalled();
    expect(harness.repository.attachHermesRun).not.toHaveBeenCalled();
    expect(harness.executePlan).toHaveBeenCalledTimes(1);
  });

  it("stops and fails an active run after twenty minutes", async () => {
    const harness = createHarness();
    let elapsedMs = 0;
    harness.now.mockImplementation(
      () => new Date(Date.parse(NOW) + elapsedMs),
    );
    harness.sleep.mockImplementation(async (milliseconds: number) => {
      elapsedMs += milliseconds;
    });
    harness.runs.getRun.mockResolvedValue({
      runId: "run-timeout",
      status: "running",
    });

    await processClaimedIntakeItem(
      { ...claimedItem, hermesRunId: "run-timeout" },
      harness.dependencies,
    );

    expect(elapsedMs).toBeGreaterThanOrEqual(20 * 60 * 1_000);
    expect(harness.runs.stopRun).toHaveBeenCalledWith("run-timeout");
    expect(harness.repository.setItemDecision).toHaveBeenCalledWith({
      ownerId: claimedItem.ownerId,
      itemId: claimedItem.id,
      workerId: "worker-1",
      status: "failed",
      confidence: null,
      decisionSummary: null,
      invalidPlanCount: 0,
      errorCode: "HERMES_RUN_TIMEOUT",
    });
  });
});

describe("runIntakeWorker", () => {
  it("creates one worker id, claims one item at a time, and delegates it", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.runs.getRun.mockResolvedValue({
      runId: "run-completed",
      status: "completed",
      output: VALID_PLAN,
    });
    harness.repository.claimNextItem
      .mockImplementationOnce(async (workerId: string) => ({
        ...claimedItem,
        hermesRunId: "run-completed",
        leaseOwner: workerId,
      }))
      .mockImplementationOnce(async () => {
        controller.abort();
        return null;
      });

    await runIntakeWorker({
      dependencies: harness.dependencies,
      signal: controller.signal,
      pollMs: 25,
    });

    const firstWorkerId = harness.repository.claimNextItem.mock.calls[0]![0];
    const secondWorkerId = harness.repository.claimNextItem.mock.calls[1]![0];
    expect(firstWorkerId).toMatch(/^intake:[0-9a-f-]{36}$/i);
    expect(secondWorkerId).toBe(firstWorkerId);
    expect(harness.repository.claimNextItem).toHaveBeenNthCalledWith(
      1,
      firstWorkerId,
      120,
    );
    expect(harness.executePlan).toHaveBeenCalledTimes(1);
  });

  it("uses the injected abortable sleep while idle", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    harness.repository.claimNextItem.mockResolvedValue(null);
    harness.sleep.mockImplementation(async (_milliseconds, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
    });

    await runIntakeWorker({
      dependencies: harness.dependencies,
      signal: controller.signal,
      pollMs: 25,
      leaseSeconds: 90,
    });

    expect(harness.repository.claimNextItem).toHaveBeenCalledWith(
      expect.stringMatching(/^intake:[0-9a-f-]{36}$/i),
      90,
    );
    expect(harness.sleep).toHaveBeenCalledWith(25, controller.signal);
  });
});
