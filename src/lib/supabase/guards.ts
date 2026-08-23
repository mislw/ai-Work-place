import { createRouteHandlerClient } from "@/lib/supabase/server";
import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const PREVIEW_USER = {
  id: "00000000-0000-4000-8000-000000000000",
  email: "preview@example.local",
} as User;

/**
 * 服务端身份校验：未登录跳到 /login。
 * 同时返回当前 user 以供调用方复用。
 */
export async function requireUser(): Promise<{
  user: User;
  supabase: SupabaseClient | null;
}> {
  // Temporarily bypass Supabase login so protected pages render in local preview.
  if (isPreviewAuthEnabled()) {
    return { user: PREVIEW_USER, supabase: null };
  }

  let supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>;
  try {
    supabase = await createRouteHandlerClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Supabase 未配置";
    if (message.includes("Supabase")) {
      redirect("/login?missing_config=supabase");
    }
    throw e;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { user, supabase };
}
