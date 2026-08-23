"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAuthCookieName } from "@/lib/supabase/config";

/** 浏览器端是否已配置 Supabase。 */
export function isSupabaseBrowserConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * 浏览器端 Supabase 客户端。
 * 使用 anon key + RLS，浏览器可见但仅可操作 auth.uid() 范围的数据。
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase 客户端未配置：请在 .env 中设置 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, anon, {
    cookieOptions: { name: getSupabaseAuthCookieName() },
  });
}
