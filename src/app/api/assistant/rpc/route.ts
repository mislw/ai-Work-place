import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import {
  buildHarnessRequest,
  type HarnessMethod,
} from "@/lib/assistant/harness-protocol";
import { callHarnessRpc } from "@/lib/assistant/harness-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  method: z.enum([
    "session.create",
    "session.history",
    "session.prompt",
    "session.cancel",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "请求格式无效" } },
        { status: 400 },
      );
    }

    const method = parsed.data.method as HarnessMethod;
    const envelope = buildHarnessRequest(method, parsed.data.payload);
    const body = await callHarnessRpc(
      owner.id,
      `/api/${method}`,
      envelope,
    );
    return NextResponse.json(body, {
      headers: { "cache-control": "no-store" },
    });
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
          code: "HARNESS_UNAVAILABLE",
          message: error instanceof Error ? error.message : "AI 助手暂时不可用",
        },
      },
      { status: 502 },
    );
  }
}
