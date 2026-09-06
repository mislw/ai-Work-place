import { NextResponse } from "next/server";
import { AssistantAuthError } from "@/lib/assistant/auth";
import type {
  IntakeBatchStatus,
  IntakeItemStatus,
} from "@/lib/intake/contracts";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

const CANCELLABLE_BATCH_STATUSES = new Set<IntakeBatchStatus>([
  "uploading",
  "processing",
  "orchestrating",
  "executing",
]);

const ACTIVE_ITEM_STATUSES = new Set<IntakeItemStatus>([
  "waiting_extraction",
  "awaiting_hermes",
  "orchestrating",
  "executing",
]);

const CONFLICT_ERRORS = {
  INTAKE_BATCH_NOT_RETRYABLE: "接管批次没有可重试的失败项",
  INTAKE_BATCH_NOT_CANCELLABLE: "接管批次当前不可取消",
  INTAKE_BATCH_NOT_UNDOABLE: "接管批次当前不可撤销",
  UNDO_WINDOW_EXPIRED: "接管批次的撤销窗口已过期",
} as const;

export interface IntakeRouteContext {
  params: { id: string };
}

export function intakeJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export function intakeError(status: number, code: string, message: string) {
  return intakeJson({ error: { code, message } }, status);
}

export function intakeNotFound() {
  return intakeError(404, "INTAKE_BATCH_NOT_FOUND", "接管批次不存在");
}

export function handleIntakeError(error: unknown) {
  if (error instanceof AssistantAuthError) {
    return intakeError(error.status, error.code, error.message);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "INTAKE_BATCH_NOT_FOUND") return intakeNotFound();
  if (Object.prototype.hasOwnProperty.call(CONFLICT_ERRORS, code)) {
    return intakeError(
      409,
      code,
      CONFLICT_ERRORS[code as keyof typeof CONFLICT_ERRORS],
    );
  }
  return intakeError(
    500,
    "INTAKE_REQUEST_FAILED",
    "接管批次请求失败",
  );
}

export function isCancellableBatchStatus(status: IntakeBatchStatus) {
  return CANCELLABLE_BATCH_STATUSES.has(status);
}

export function isActiveItemStatus(status: IntakeItemStatus) {
  return ACTIVE_ITEM_STATUSES.has(status);
}

export function clampRecent(value: string | null) {
  const parsed = Number.parseInt(value ?? "10", 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(20, Math.max(1, parsed));
}
