import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { aiRequestSchema } from "@/lib/schemas";
import { runAI } from "@/lib/ai/prompts";
import { AIProviderError } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ai - 统一 AI 入口。 */
export async function POST(req: Request) {
  try {
    // 1) 身份校验
    const supabase = createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "未登录" } },
        { status: 401 },
      );
    }

    // 2) 解析与校验 body
    const body = (await req.json().catch(() => null)) ?? {};
    const input = aiRequestSchema.parse(body);

    // 3) 调用 AI
    const result = await runAI(input.action, input.prompt ?? "", input.context);

    // 4) 写操作日志（仅元数据）
    await supabase.from("ai_action_logs").insert({
      user_id: user.id,
      action_type: input.action,
      model: result.model,
      success: true,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      duration_ms: result.durationMs,
      error_code: null,
    });

    return NextResponse.json({
      content: result.content,
      action: result.action,
      model: result.model,
    });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: e.issues[0]?.message ?? "参数错误" } },
        { status: 400 },
      );
    }
    if (e instanceof AIProviderError) {
      logger.warn("ai.route", { code: e.code });
      return NextResponse.json(
        { error: { code: e.code, message: e.message } },
        { status: 502 },
      );
    }
    if (e instanceof Error && e.message === "AI_NOT_CONFIGURED") {
      return NextResponse.json(
        {
          error: {
            code: "AI_NOT_CONFIGURED",
            message: "AI 尚未配置：基础功能仍可使用",
          },
        },
        { status: 503 },
      );
    }
    logger.error("ai.route", { err: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "服务异常" } },
      { status: 500 },
    );
  }
}
