import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import {
  getActionPolicy,
  workbenchActionSchema,
} from "@/lib/assistant/actions";
import { executeIdempotentWorkbenchAction } from "@/lib/assistant/action-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: workbenchActionSchema,
  requestId: z.string().min(1).max(300).optional(),
  confirmed: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "BAD_ACTION", message: "操作参数无效" } },
        { status: 400 },
      );
    }

    const { action, confirmed, requestId } = parsed.data;
    if (action.action.endsWith(".create") && !requestId) {
      return NextResponse.json(
        { error: { code: "REQUEST_ID_REQUIRED", message: "创建操作缺少 requestId" } },
        { status: 400 },
      );
    }
    if (getActionPolicy(action.action) === "confirm" && !confirmed) {
      return NextResponse.json(
        { requiresConfirmation: true, action },
        { status: 409 },
      );
    }

    const execution = await executeIdempotentWorkbenchAction(
      owner.id,
      action,
      requestId,
    );
    return NextResponse.json({ ok: true, ...execution });
  } catch (error) {
    if (error instanceof AssistantAuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "ACTION_FAILED",
          message: error instanceof Error ? error.message : "工作台操作失败",
        },
      },
      { status: 500 },
    );
  }
}
