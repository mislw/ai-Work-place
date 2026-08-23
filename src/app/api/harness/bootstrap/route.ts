import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { signHarnessBootstrapToken } from "@/lib/harness/bootstrap-token";
import { getHarnessConfig } from "@/lib/harness/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request) {
  try {
    const owner = await getAssistantOwner();
    const config = getHarnessConfig();
    const token = await signHarnessBootstrapToken(owner.id);
    return NextResponse.json({
      url: `${config.publicOrigin}/auth/bootstrap?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    const authError = readAuthError(error);
    if (authError) {
      return NextResponse.json(
        { error: { code: authError.code, message: authError.message } },
        { status: authError.status },
      );
    }
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

function readAuthError(error: unknown) {
  if (error instanceof AssistantAuthError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    "message" in error &&
    (error.status === 401 || error.status === 403 || error.status === 503) &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return error as {
      status: 401 | 403 | 503;
      code: string;
      message: string;
    };
  }
  return null;
}
