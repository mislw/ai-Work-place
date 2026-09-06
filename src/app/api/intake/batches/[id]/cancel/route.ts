import { getAssistantOwner } from "@/lib/assistant/auth";
import type { IntakeItem } from "@/lib/intake/contracts";
import { HermesRunsClient } from "@/lib/intake/hermes-runs";
import { getIntakeRepository } from "@/lib/intake/repository";
import {
  handleIntakeError,
  intakeError,
  intakeJson,
  intakeNotFound,
  isActiveItemStatus,
  isCancellableBatchStatus,
  type IntakeRouteContext,
} from "@/app/api/intake/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: IntakeRouteContext) {
  try {
    const owner = await getAssistantOwner();
    const repository = getIntakeRepository();
    const existing = await repository.getBatch(owner.id, context.params.id);
    if (!existing) return intakeNotFound();
    if (!isCancellableBatchStatus(existing.status)) {
      return intakeError(
        409,
        "INTAKE_BATCH_NOT_CANCELLABLE",
        "接管批次当前不可取消",
      );
    }

    await stopActiveRuns(existing.items);
    const batch = await repository.cancel(owner.id, context.params.id);
    return intakeJson({ batch });
  } catch (error) {
    return handleIntakeError(error);
  }
}

async function stopActiveRuns(items: IntakeItem[]) {
  const runIds = [
    ...new Set(
      items
        .filter(
          (item) => isActiveItemStatus(item.status) && item.hermesRunId,
        )
        .map((item) => item.hermesRunId as string),
    ),
  ];
  if (runIds.length === 0) return;

  try {
    const hermes = new HermesRunsClient();
    await Promise.allSettled(runIds.map((runId) => hermes.stopRun(runId)));
  } catch {
    // Cancellation persistence remains authoritative if Hermes is unavailable.
  }
}
