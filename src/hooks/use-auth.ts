"use client";

import { useEffect, useState } from "react";
import {
  createClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
}

export function useAuth(): AuthState {
  const configured = isSupabaseBrowserConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(
    configured ? null : "Supabase 尚未配置",
  );

  useEffect(() => {
    if (!configured) {
      setUser(null);
      setLoading(false);
      setError("Supabase 尚未配置");
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = createClient();

      supabase.auth
        .getUser()
        .then(({ data, error: e }) => {
          if (!active) return;
          if (e) setError(e.message);
          setUser(data.user ?? null);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (!active) return;
          setError(e instanceof Error ? e.message : "获取登录状态失败");
          setLoading(false);
        });

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch (e) {
      if (!active) return;
      setError(e instanceof Error ? e.message : "Supabase 初始化失败");
      setLoading(false);
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [configured]);

  return { user, loading, error, configured };
}
