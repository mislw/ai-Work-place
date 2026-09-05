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
    workerId: string;
    signal: AbortSignal;
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
  if (isExtractionFailed(knowledgeItem)) {
    await failItem(
      item,
      workerId,
      item.invalidPlanCount,
      "PROCESSING_FAILED",
      dependencies.repository,
    );
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

  let invalidPlanCount = item.invalidPlanCount;
  let pollMs = 1_000;
  let run: HermesRun | undefined;
  let runTiming = createRunTiming(dependencies.now());

  if (!runId) {
    let createdRun: HermesRun;
    try {
      createdRun = await dependencies.runs.createRun(request);
    } catch {
      await releaseForHermesRetry(item, workerId, dependencies);
      return;
    }
    runId = createdRun.runId;
    runTiming = createRunTiming(dependencies.now(), createdRun);
    if (
      !(await attachCreatedRun(
        item,
        workerId,
        createdRun,
        dependencies,
        signal,
      ))
    ) {
      return;
    }
    run = createdRun;
  }

  while (runId) {
    if (signal.aborted) {
      await stopAttachedRun(dependencies.runs, runId);
      return;
    }

    if (isRunTimedOut(runTiming, dependencies.now())) {
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

    if (!run || isActiveRun(run.status)) {
      if (!(await sleepOrAbort(dependencies.sleep, pollMs, signal))) {
        await stopAttachedRun(dependencies.runs, runId);
        return;
      }
      if (isRunTimedOut(runTiming, dependencies.now())) {
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
        await releaseForHermesRetry(
          item,
          workerId,
          dependencies,
          runId,
        );
        return;
      }
      if (signal.aborted) {
        await stopAttachedRun(dependencies.runs, runId);
        return;
      }
      runTiming = updateRunTiming(runTiming, run);
      if (isRunTimedOut(runTiming, dependencies.now())) {
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
      const nextInvalidPlanCount = invalidPlanCount + 1;
      if (nextInvalidPlanCount >= 2) {
        await failItem(
          item,
          workerId,
          nextInvalidPlanCount,
          "INVALID_HERMES_PLAN",
          dependencies.repository,
        );
        return;
      }

      let correctionRun: HermesRun;
      try {
        correctionRun = await dependencies.runs.createRun({
          ...request,
          prompt: `${request.prompt}\n\n${CORRECTION_INSTRUCTION}`,
        });
      } catch {
        await releaseForHermesRetry(item, workerId, dependencies);
        return;
      }
      const correctionTiming = createRunTiming(
        dependencies.now(),
        correctionRun,
      );
      if (
        !(await attachCreatedRun(
          item,
          workerId,
          correctionRun,
          dependencies,
          signal,
          () =>
            dependencies.repository.attachHermesCorrectionRun({
              ownerId: item.ownerId,
              itemId: item.id,
              workerId,
              runId: correctionRun.runId,
              invalidPlanCount: nextInvalidPlanCount,
            }),
        ))
      ) {
        return;
      }
      if (signal.aborted) {
        await stopAttachedRun(dependencies.runs, correctionRun.runId);
        return;
      }
      invalidPlanCount = nextInvalidPlanCount;
      run = correctionRun;
      runId = correctionRun.runId;
      runTiming = correctionTiming;
      pollMs = 1_000;
      continue;
    }

    if (
      !(await renewLeaseOrStop(
        item,
        workerId,
        runId,
        dependencies,
      ))
    ) {
      return;
    }
    if (signal.aborted) {
      await stopAttachedRun(dependencies.runs, runId);
      return;
    }
    await dependencies.executePlan({
      ownerId: item.ownerId,
      batchId: item.batchId,
      itemId: item.id,
      documentId: item.documentId,
      workerId,
      signal,
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
      try {
        await processClaimedIntakeItem(
          item,
          options.dependencies,
          options.signal,
        );
      } catch {
        if (options.signal.aborted) return;
        if (
          !(await sleepOrAbort(
            options.dependencies.sleep,
            idleMs,
            options.signal,
          ))
        ) {
          return;
        }
      }
      continue;
    }
    if (options.signal.aborted) return;
    if (
      !(await sleepOrAbort(
        options.dependencies.sleep,
        idleMs,
        options.signal,
      ))
    ) {
      return;
    }
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

function isExtractionFailed(value: unknown): boolean {
  const item = asRecord(value);
  return item.status === "failed" || item.stage === "failed";
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
  runId: string | null = null,
): Promise<void> {
  try {
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
  } catch (error) {
    if (isLeaseLost(error)) {
      await stopAttachedRun(dependencies.runs, runId);
      return;
    }
    throw error;
  }
}

async function attachCreatedRun(
  item: ClaimedIntakeItem,
  workerId: string,
  run: HermesRun,
  dependencies: IntakeOrchestratorDependencies,
  signal: AbortSignal,
  attach: () => Promise<void> = () =>
    dependencies.repository.attachHermesRun(
      item.id,
      workerId,
      run.runId,
    ),
): Promise<boolean> {
  if (signal.aborted) {
    await stopAttachedRun(dependencies.runs, run.runId);
    return false;
  }
  try {
    await attach();
  } catch (error) {
    await stopUnattachedRun(dependencies.runs, run.runId);
    if (isLeaseLost(error)) return false;
    throw error;
  }
  if (signal.aborted) {
    await stopAttachedRun(dependencies.runs, run.runId);
    return false;
  }
  return true;
}

async function stopUnattachedRun(
  runs: HermesRunsClient,
  runId: string,
): Promise<void> {
  try {
    await runs.stopRun(runId);
  } catch {
    throw new Error("HERMES_RUN_CLEANUP_FAILED");
  }
}

async function renewLeaseOrStop(
  item: ClaimedIntakeItem,
  workerId: string,
  runId: string,
  dependencies: IntakeOrchestratorDependencies,
): Promise<boolean> {
  try {
    await dependencies.repository.renewLease(
      item.id,
      workerId,
      DEFAULT_LEASE_SECONDS,
    );
    return true;
  } catch (error) {
    if (!isLeaseLost(error)) throw error;
    await stopAttachedRun(dependencies.runs, runId);
    return false;
  }
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

interface RunTiming {
  fallbackCreatedAtMs: number;
  createdAtMs?: number;
}

function createRunTiming(now: Date, run?: HermesRun): RunTiming {
  return {
    fallbackCreatedAtMs: now.getTime(),
    ...(run?.createdAtMs === undefined
      ? {}
      : { createdAtMs: run.createdAtMs }),
  };
}

function updateRunTiming(timing: RunTiming, run: HermesRun): RunTiming {
  return run.createdAtMs === undefined
    ? timing
    : { ...timing, createdAtMs: run.createdAtMs };
}

function isRunTimedOut(timing: RunTiming, now: Date): boolean {
  return (
    now.getTime() - (timing.createdAtMs ?? timing.fallbackCreatedAtMs) >=
    HERMES_RUN_TIMEOUT_MS
  );
}

async function sleepOrAbort(
  sleep: IntakeOrchestratorDependencies["sleep"],
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await sleep(milliseconds, signal);
    return !signal.aborted;
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
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
