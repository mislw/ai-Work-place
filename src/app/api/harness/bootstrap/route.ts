import { NextResponse } from "next/server";
import { signHarnessBootstrapToken } from "@/lib/harness/bootstrap-token";
import { getHarnessConfig } from "@/lib/harness/config";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "未登录" } },
        { status: 401 },
      );
    }

    const config = getHarnessConfig();
    if (user.id !== config.ownerUserId) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "无权访问 AI 助手" } },
        { status: 403 },
      );
    }

    const token = await signHarnessBootstrapToken(user.id);
    return NextResponse.json({
      url: `${config.publicOrigin}/auth/bootstrap?token=${encodeURIComponent(token)}`,
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "HARNESS_NOT_CONFIGURED",
          message: "AI 助手服务未配置",
        },
      },
      { status: 503 },
    );
  }
}
