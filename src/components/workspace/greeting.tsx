"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { greeting, formatChineseDate, chineseWeekday } from "@/lib/date";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceGreeting() {
  const { user, loading } = useAuth();
  const [now, setNow] = useState<Date | null>(null);
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name =
          (data?.display_name as string | null) ||
          (user.email ? user.email.split("@")[0] ?? "" : "") ||
          "你";
        setDisplayName(name);
      });
  }, [user]);

  return (
    <div className="space-y-1.5">
      {loading || !now ? (
        <>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-44" />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
            {greeting(now)}，{displayName || "你"}。
          </h1>
          <p className="text-sm text-muted-foreground">
            今天是 {formatChineseDate(now)}，{chineseWeekday(now)}
            {now ? ` · ${formatTime(now)}` : ""}
          </p>
        </>
      )}
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
