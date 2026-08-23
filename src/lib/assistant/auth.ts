import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import { getHarnessConfig } from "@/lib/harness/config";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export class AssistantAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED",
    message: string,
  ) {
    super(message);
  }
}

export async function getAssistantOwner(): Promise<{ id: string }> {
  let ownerUserId: string;
  try {
    ownerUserId = getHarnessConfig().ownerUserId;
  } catch {
    throw new AssistantAuthError(503, "NOT_CONFIGURED", "AI 助手服务未配置");
  }

  if (isPreviewAuthEnabled()) {
    return { id: ownerUserId };
  }

  let supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>;
  try {
    supabase = await createRouteHandlerClient();
  } catch {
    throw new AssistantAuthError(503, "NOT_CONFIGURED", "AI 助手服务未配置");
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AssistantAuthError(401, "UNAUTHENTICATED", "未登录");
  }

  if (user.id !== ownerUserId) {
    throw new AssistantAuthError(403, "FORBIDDEN", "无权访问 AI 助手");
  }
  return { id: user.id };
}
