"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth, type AuthState } from "@/hooks/use-auth";

/**
 * 客户端守卫：未登录直接跳到 /login。
 * 中间件会做兜底，这里主要用于客户端路由切换。
 */
export function useRequireAuth(redirectTo = "/login"): AuthState {
  const auth = useAuth();
  const { user, loading, configured } = auth;
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!configured) {
      router.replace(`${redirectTo}?missing_config=supabase`);
      return;
    }
    if (!user) {
      const next =
        typeof window !== "undefined" ? window.location.pathname : "/";
      router.replace(`${redirectTo}?next=${encodeURIComponent(next)}`);
    }
  }, [user, loading, configured, router, redirectTo]);
  return auth;
}

/** 强制已登录用户跳到工作台（用于登录/注册/忘记密码页）。 */
export function useRedirectIfAuthenticated(to = "/workspace"): AuthState {
  const auth = useAuth();
  const { user, loading } = auth;
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (user) router.replace(to);
  }, [user, loading, router, to]);
  return auth;
}

/** 客户端登出。 */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
