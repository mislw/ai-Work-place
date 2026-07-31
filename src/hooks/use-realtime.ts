"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";

type RealtimeRow = Record<string, unknown>;

export interface UseCollectionRealtimeOptions {
  table: string;
  /** 收到变化时由调用方应用变更（合并、替换等）。 */
  onChange: (payload: RealtimePostgresChangesPayload<RealtimeRow>) => void;
  /** 可选过滤，RLS 会再次校验 user_id。 */
  filter?: string;
  enabled?: boolean;
}

/**
 * 通用 Realtime 订阅：监听当前用户的某张表变化。
 * 注意：依赖 RLS，channel 上无需额外 filter，但本 hook 仍提供 filter 供调试。
 */
export function useCollectionRealtime({
  table,
  onChange,
  filter,
  enabled = true,
}: UseCollectionRealtimeOptions): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const channel: RealtimeChannel = supabase
      .channel(`${table}-changes`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        (payload) => handlerRef.current(payload as RealtimePostgresChangesPayload<RealtimeRow>),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}
