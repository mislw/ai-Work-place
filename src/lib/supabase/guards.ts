import { createRouteHandlerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * 服务端身份校验：未登录跳到 /login。
 * 同时返回当前 user 以供调用方复用。
 */
export async function requireUser() {
  let supabase: ReturnType<typeof createRouteHandlerClient>;
  try {
    supabase = createRouteHandlerClient();
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
