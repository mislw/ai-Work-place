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

export async function GET(_request: Request, context: IntakeRouteContext) {
  try {
    const owner = await getAssistantOwner();
    const batch = await getIntakeRepository().getBatch(
      owner.id,
      context.params.id,
    );
    if (!batch) return intakeNotFound();
    return intakeJson({ batch });
  } catch (error) {
    return handleIntakeError(error);
  }
}
