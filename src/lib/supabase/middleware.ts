import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  getServerSupabaseUrl,
  getSupabaseAuthCookieName,
} from "@/lib/supabase/config";

/**
 * 中间件专用：刷新 Supabase 会话 cookie，避免过期。
 */
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const url = getServerSupabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { supabase: null, response, getResponse: () => response };
  }
  const supabase = createServerClient(url, anon, {
    cookieOptions: { name: getSupabaseAuthCookieName() },
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });
  return { supabase, response, getResponse: () => response };
}
