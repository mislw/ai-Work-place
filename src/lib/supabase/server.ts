import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 服务端 Supabase 客户端（绑定到当前请求的 cookies）。
 * 用于 Server Components / Route Handlers 中的受身份校验操作。
 */
export function createClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase 服务端未配置：缺少 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }
  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // 在 Server Component 中不可写，忽略；Route Handler 中允许。
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // 同上
        }
      },
    },
  });
}

/** 仅在 Route Handler 中使用：可在响应里写 cookie。 */
export function createRouteHandlerClient() {
  return createClient();
}

/**
 * 服务端特权客户端，使用 SERVICE_ROLE_KEY，可绕过 RLS。
 * **严禁暴露到客户端代码**。仅在受信任的、需要管理员写日志的 Server Action 中使用。
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase 服务端特权客户端未配置：缺少 SERVICE_ROLE_KEY");
  }
  // 使用动态 import 避免在 edge runtime 误引入
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient: createRaw } = require("@supabase/supabase-js");
  return createRaw(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
