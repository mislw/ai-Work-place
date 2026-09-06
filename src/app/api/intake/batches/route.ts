import { getAssistantOwner } from "@/lib/assistant/auth";
import { createIntakeBatchRequestSchema } from "@/lib/intake/contracts";
import { getIntakeRepository } from "@/lib/intake/repository";
import {
  clampRecent,
  handleIntakeError,
  intakeError,
  intakeJson,
} from "@/app/api/intake/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const owner = await getAssistantOwner();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidRequest();
    }
    const parsed = createIntakeBatchRequestSchema.safeParse(body);
    if (!parsed.success) return invalidRequest();

    const result = await getIntakeRepository().registerBatch(
      owner.id,
      parsed.data,
    );
    return intakeJson(
      { batch: result.batch },
      result.registration === "created" ? 201 : 200,
    );
  } catch (error) {
    return handleIntakeError(error);
  }
}

export async function GET(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const recent = clampRecent(
      new URL(request.url).searchParams.get("recent"),
    );
    const batches = await getIntakeRepository().listActiveAndRecent(
      owner.id,
      recent,
    );
    return intakeJson({ batches });
  } catch (error) {
    return handleIntakeError(error);
  }
}

function invalidRequest() {
  return intakeError(
    400,
    "INVALID_INTAKE_REQUEST",
    "接管批次参数无效",
  );
}
