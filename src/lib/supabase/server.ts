import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getServerSupabaseUrl,
  getSupabaseAuthCookieName,
} from "@/lib/supabase/config";

/**
 * 服务端 Supabase 客户端（绑定到当前请求的 cookies）。
 * 用于 Server Components / Route Handlers 中的受身份校验操作。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const url = getServerSupabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase 服务端未配置：缺少 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }
  return createServerClient(url, anon, {
    cookieOptions: { name: getSupabaseAuthCookieName() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 在 Server Component 中不可写，忽略；Route Handler 中允许。
        }
      },
    },
  });
}

/** 仅在 Route Handler 中使用：可在响应里写 cookie。 */
export async function createRouteHandlerClient() {
  return createClient();
}

export function createAuthRouteClient(request: NextRequest) {
  const url = getServerSupabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase 服务端未配置：缺少 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }

  let pendingCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient(url, anon, {
    cookieOptions: { name: getSupabaseAuthCookieName() },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        pendingCookies = cookiesToSet;
      },
    },
  });

  return {
    supabase,
    applyCookies(response: NextResponse) {
      pendingCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    },
  };
}

/**
 * 服务端特权客户端，使用 SERVICE_ROLE_KEY，可绕过 RLS。
 * **严禁暴露到客户端代码**。仅在受信任的、需要管理员写日志的 Server Action 中使用。
 */
export function createServiceClient() {
  const url = getServerSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase 服务端特权客户端未配置：缺少 SERVICE_ROLE_KEY");
  }
  return createRawClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
