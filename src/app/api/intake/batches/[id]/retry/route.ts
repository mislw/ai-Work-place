import { getAssistantOwner } from "@/lib/assistant/auth";
import { getIntakeRepository } from "@/lib/intake/repository";
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

    const batch = await repository.retryFailed(owner.id, context.params.id);
    return intakeJson({ batch });
  } catch (error) {
    return handleIntakeError(error);
  }
}
