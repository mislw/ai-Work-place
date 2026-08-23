"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { greeting, formatChineseDate, chineseWeekday } from "@/lib/date";
import {
  createClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientNow } from "@/hooks/use-client-now";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

export function WorkspaceGreeting() {
  const { user, loading } = useAuth();
  const now = useClientNow();
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    if (!user) return;
    const fallbackName = user.email ? user.email.split("@")[0] ?? "" : "";
    if (!isSupabaseBrowserConfigured()) {
      setDisplayName(fallbackName || "你");
      return;
    }
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name =
          (data?.display_name as string | null) ||
          fallbackName ||
          "你";
        setDisplayName(name);
      });
  }, [user]);

  return (
    <div className="relative z-10 flex min-h-[104px] items-center justify-between gap-3 overflow-hidden border-b border-[#e6d4b8] pb-3 sm:min-h-[118px] sm:gap-6 dark:border-border">
      <div className="min-w-0 flex-1 space-y-1.5">
        {loading || !now ? (
          <>
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-44 max-w-full" />
          </>
        ) : (
          <>
            <h1 className="crayon-display text-2xl text-[#e94743] sm:text-[28px] dark:text-[#ff7772]">
              {greeting(now)}，{displayName || "你"}。
            </h1>
            <p className="text-sm font-medium text-muted-foreground">
              今天是 {formatChineseDate(now)}，{chineseWeekday(now)}
              {now ? ` · ${formatTime(now)}` : ""}
            </p>
          </>
        )}
      </div>
      <CrayonDecoration
        scene="friends"
        className="h-auto w-[96px] shrink-0 self-end sm:w-[132px] lg:w-[150px]"
      />
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
