import { getAssistantOwner } from "@/lib/assistant/auth";
import { getIntakeRepository } from "@/lib/intake/repository";
import { undoIntakeBatch } from "@/lib/intake/undo";
import {
  handleIntakeError,
  intakeJson,
  intakeNotFound,
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

    const batch = await undoIntakeBatch(owner.id, context.params.id, {
      repository,
    });
    return intakeJson({ batch });
  } catch (error) {
    return handleIntakeError(error);
  }
}
