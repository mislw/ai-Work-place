import { randomUUID } from "node:crypto";

import type { WorkspaceIntakePlanV1 } from "@/lib/intake/contracts";
import type {
  HermesRun,
  HermesRunsClient,
} from "@/lib/intake/hermes-runs";
import {
  buildIntakeRunRequest,
  parseTerminalIntakePlan,
} from "@/lib/intake/plan";
import type {
  ClaimedIntakeItem,
  IntakeRepository,
} from "@/lib/intake/repository";
import {
  knowledgeAnalysisSchema,
  type KnowledgeAnalysis,
} from "@/lib/knowledge/contracts";

const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_IDLE_MS = 1_000;
const EXTRACTION_RETRY_MS = 10_000;
const HERMES_BACKOFF_BASE_MS = 10_000;
const HERMES_BACKOFF_MAX_MS = 15 * 60 * 1_000;
const HERMES_RUN_TIMEOUT_MS = 20 * 60 * 1_000;
const MAX_POLL_MS = 5_000;
const CORRECTION_INSTRUCTION = [
  "Your previous terminal output failed WorkspaceIntakePlanV1 validation.",
  "Return only one corrected JSON object. Do not add markdown or prose.",
].join("\n");
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export interface IntakeOrchestratorDependencies {
  repository: IntakeRepository;
  runs: HermesRunsClient;
  getKnowledgeItem(ownerId: string, documentId: string): Promise<unknown>;
  executePlan(input: {
    ownerId: string;
    batchId: string;
    itemId: string;
    documentId: string;
    plan: WorkspaceIntakePlanV1;
  }): Promise<void>;
  now(): Date;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export async function processClaimedIntakeItem(
  item: ClaimedIntakeItem,
  dependencies: IntakeOrchestratorDependencies,
  signal: AbortSignal = NEVER_ABORTED_SIGNAL,
): Promise<void> {
  const workerId = item.leaseOwner;
  if (!workerId) throw new Error("INTAKE_LEASE_OWNER_REQUIRED");

  let runId = item.hermesRunId;
  if (signal.aborted || item.status === "cancelled") {
    await stopAttachedRun(dependencies.runs, runId);
    return;
  }

  const knowledgeItem = await dependencies.getKnowledgeItem(
    item.ownerId,
    item.documentId,
  );
  if (signal.aborted) {
    await stopAttachedRun(dependencies.runs, runId);
    return;
  }
  if (!isExtractionReady(knowledgeItem)) {
    await dependencies.repository.releaseItem({
      ownerId: item.ownerId,
      itemId: item.id,
      workerId,
      status: "waiting_extraction",
      errorCode: null,
      availableAt: addMilliseconds(
        dependencies.now(),
        EXTRACTION_RETRY_MS,
      ),
    });
    return;
  }

  let request;
  try {
    request = buildIntakeRunRequest({
      ownerId: item.ownerId,
      itemId: item.id,
      documentId: item.documentId,
      preliminary: toPreliminaryAnalysis(knowledgeItem),
      pageContext: item.pageContext,
    });
  } catch (error) {
    await failItem(
      item,
      workerId,
      item.invalidPlanCount,
      stablePlanningError(error),
      dependencies.repository,
    );
    return;
  }

  const startedAt = dependencies.now().getTime();
  let invalidPlanCount = item.invalidPlanCount;
  let pollMs = 1_000;
  let run: HermesRun | undefined;

  if (!runId) {
    try {
      run = await dependencies.runs.createRun(request);
      runId = run.runId;
      await dependencies.repository.attachHermesRun(
        item.id,
        workerId,
        runId,
      );
    } catch {
      await releaseForHermesRetry(item, workerId, dependencies);
      return;
    }
  }

  while (runId) {
    if (signal.aborted) {
      await stopAttachedRun(dependencies.runs, runId);
      return;
    }

    if (!run || isActiveRun(run.status)) {
      if (dependencies.now().getTime() - startedAt >= HERMES_RUN_TIMEOUT_MS) {
        await stopAttachedRun(dependencies.runs, runId);
        await failItem(
          item,
          workerId,
          invalidPlanCount,
          "HERMES_RUN_TIMEOUT",
          dependencies.repository,
        );
        return;
      }

      await dependencies.sleep(pollMs, signal);
      if (signal.aborted) {
        await stopAttachedRun(dependencies.runs, runId);
        return;
      }
      if (dependencies.now().getTime() - startedAt >= HERMES_RUN_TIMEOUT_MS) {
        await stopAttachedRun(dependencies.runs, runId);
        await failItem(
          item,
          workerId,
          invalidPlanCount,
          "HERMES_RUN_TIMEOUT",
          dependencies.repository,
        );
        return;
      }

      try {
        await dependencies.repository.renewLease(
          item.id,
          workerId,
          DEFAULT_LEASE_SECONDS,
        );
      } catch (error) {
        if (isLeaseLost(error)) {
          await stopAttachedRun(dependencies.runs, runId);
          return;
        }
        throw error;
      }

      try {
        run = await dependencies.runs.getRun(runId);
      } catch {
        await releaseForHermesRetry(item, workerId, dependencies);
        return;
      }
      pollMs = Math.min(MAX_POLL_MS, pollMs * 2);
    }

    if (isActiveRun(run.status)) continue;

    if (run.status === "waiting_for_approval") {
      await stopAttachedRun(dependencies.runs, runId);
      await failItem(
        item,
        workerId,
        invalidPlanCount,
        "HERMES_APPROVAL_REQUIRED",
        dependencies.repository,
      );
      return;
    }

    if (run.status === "failed" || run.status === "cancelled") {
      await failItem(
        item,
        workerId,
        invalidPlanCount,
        run.errorCode ?? "PROCESSING_FAILED",
        dependencies.repository,
      );
      return;
    }

    if (run.status !== "completed") {
      await failItem(
        item,
        workerId,
        invalidPlanCount,
        "PROCESSING_FAILED",
        dependencies.repository,
      );
      return;
    }

    let plan: WorkspaceIntakePlanV1;
    try {
      plan = parseTerminalIntakePlan(run.output ?? "", item.documentId);
    } catch {
      invalidPlanCount += 1;
      if (invalidPlanCount >= 2) {
        await failItem(
          item,
          workerId,
          invalidPlanCount,
          "INVALID_HERMES_PLAN",
          dependencies.repository,
        );
        return;
      }

      await dependencies.repository.setItemDecision({
        ownerId: item.ownerId,
        itemId: item.id,
        workerId,
        status: "orchestrating",
        confidence: null,
        decisionSummary: null,
        invalidPlanCount,
        errorCode: null,
      });
      try {
        run = await dependencies.runs.createRun({
          ...request,
          prompt: `${request.prompt}\n\n${CORRECTION_INSTRUCTION}`,
        });
        runId = run.runId;
        await dependencies.repository.attachHermesRun(
          item.id,
          workerId,
          runId,
        );
        pollMs = 1_000;
        continue;
      } catch {
        await releaseForHermesRetry(item, workerId, dependencies);
        return;
      }
    }

    await dependencies.executePlan({
      ownerId: item.ownerId,
      batchId: item.batchId,
      itemId: item.id,
      documentId: item.documentId,
      plan,
    });
    return;
  }
}

export async function runIntakeWorker(options: {
  dependencies: IntakeOrchestratorDependencies;
  signal: AbortSignal;
  pollMs?: number;
  leaseSeconds?: number;
}): Promise<void> {
  const workerId = `intake:${randomUUID()}`;
  const idleMs = options.pollMs ?? DEFAULT_IDLE_MS;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;

  while (!options.signal.aborted) {
    const item = await options.dependencies.repository.claimNextItem(
      workerId,
      leaseSeconds,
    );
    if (item) {
      await processClaimedIntakeItem(
        item,
        options.dependencies,
        options.signal,
      );
      continue;
    }
    if (options.signal.aborted) return;
    await options.dependencies.sleep(idleMs, options.signal);
  }
}

function isActiveRun(status: HermesRun["status"]): boolean {
  return ["started", "queued", "running", "stopping"].includes(status);
}

function isExtractionReady(value: unknown): boolean {
  const item = asRecord(value);
  return (
    ["ready", "needs_attention"].includes(String(item.status)) &&
    item.stage === "complete"
  );
}

function toPreliminaryAnalysis(value: unknown): KnowledgeAnalysis {
  const item = asRecord(value);
  const title = nonEmptyString(item.title) ?? "Untitled document";
  return knowledgeAnalysisSchema.parse({
    documentType: nonEmptyString(item.documentType) ?? "document",
    title,
    summary: nonEmptyString(item.summary) ?? title,
    topics: stringArray(item.topics ?? item.tags),
    entities: stringArray(item.entities),
    importantDates: Array.isArray(item.importantDates)
      ? item.importantDates
      : [],
    suggestedCollection:
      nonEmptyString(item.suggestedCollection) ?? null,
    proposals: Array.isArray(item.proposals) ? item.proposals : [],
  });
}

async function releaseForHermesRetry(
  item: ClaimedIntakeItem,
  workerId: string,
  dependencies: IntakeOrchestratorDependencies,
): Promise<void> {
  await dependencies.repository.releaseItem({
    ownerId: item.ownerId,
    itemId: item.id,
    workerId,
    status: "awaiting_hermes",
    errorCode: "HERMES_UNAVAILABLE",
    availableAt: addMilliseconds(
      dependencies.now(),
      hermesBackoffMs(item.attemptCount),
    ),
  });
}

async function failItem(
  item: ClaimedIntakeItem,
  workerId: string,
  invalidPlanCount: number,
  errorCode: string,
  repository: IntakeRepository,
): Promise<void> {
  await repository.setItemDecision({
    ownerId: item.ownerId,
    itemId: item.id,
    workerId,
    status: "failed",
    confidence: null,
    decisionSummary: null,
    invalidPlanCount,
    errorCode,
  });
}

async function stopAttachedRun(
  runs: HermesRunsClient,
  runId: string | null,
): Promise<void> {
  if (!runId) return;
  try {
    await runs.stopRun(runId);
  } catch {
    // The persisted item state remains authoritative even if Hermes is down.
  }
}

function hermesBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(
    HERMES_BACKOFF_MAX_MS,
    HERMES_BACKOFF_BASE_MS * 2 ** exponent,
  );
}

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function stablePlanningError(error: unknown): string {
  if (
    error instanceof Error &&
    ["INTAKE_PROMPT_TOO_LARGE", "INVALID_HERMES_PLAN", "PLAN_DOCUMENT_MISMATCH"].includes(
      error.message,
    )
  ) {
    return error.message;
  }
  return "PROCESSING_FAILED";
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "INTAKE_LEASE_LOST";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
