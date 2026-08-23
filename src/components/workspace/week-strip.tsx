"use client";

import { useMemo } from "react";
import { useDataStore } from "@/lib/stores/data";
import { dateKey } from "@/lib/date";
import {
  addDays,
  format,
  isSameDay,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClientNow } from "@/hooks/use-client-now";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function WeekStripCard() {
  const router = useRouter();
  const events = useDataStore((s) => s.events);
  const todos = useDataStore((s) => s.todos);
  const today = useClientNow();

  const days = useMemo(() => {
    if (!today) return [];
    // 周一开始
    const monday = startOfWeek(today, { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(monday, i));
  }, [today]);

  const eventCount = (d: Date) =>
    events.filter((e) => e.event_date === dateKey(d)).length;
  const todoCount = (d: Date) =>
    todos.filter((t) => t.due_date === dateKey(d) && t.status === "pending")
      .length;

  return (
    <Card className="workspace-feature-card workspace-calendar-card relative h-full overflow-hidden">
      <CardHeader className="workspace-card-header relative flex min-h-[72px] flex-row items-start justify-between">
        <div className="workspace-title-ribbon workspace-title-green">
          <CardTitle className="text-lg text-white">本周日历</CardTitle>
        </div>
        <CrayonDecoration
          scene="calendar"
          className="pointer-events-none absolute left-1/2 top-0 hidden h-[68px] w-auto -translate-x-1/2 md:block"
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/calendar">打开日历</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {today
            ? days.map((d, index) => {
                const isToday = isSameDay(d, today);
                const ev = eventCount(d);
                const td = todoCount(d);
                const isSaturday = index === 5;
                const isSunday = index === 6;
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => router.push(`/calendar?date=${dateKey(d)}`)}
                    className={cn(
                      "workspace-week-day relative flex min-h-[84px] flex-col items-center gap-1 overflow-hidden rounded-md px-1 py-2 text-sm transition-colors",
                      isToday
                        ? "workspace-week-day-today"
                        : "hover:bg-muted",
                      isSaturday && !isToday && "bg-[#fff6cf]/70",
                      isSunday && !isToday && "bg-[#fff0ed]/70",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-semibold text-muted-foreground",
                        isSaturday && "text-[#b27b10]",
                        isSunday && "text-[#c94a44]",
                      )}
                    >
                      {WEEK_LABELS[index]}
                    </span>
                    <span className="text-lg font-black">{format(d, "d")}</span>
                    <span className="flex h-1.5 items-center gap-0.5">
                      {ev + td > 0 ? (
                        <>
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isToday
                                ? "bg-primary-foreground"
                                : "bg-foreground/70",
                            )}
                          />
                          {ev + td > 1 ? (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                isToday
                                  ? "bg-primary-foreground/70"
                                  : "bg-foreground/40",
                              )}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </span>
                    {isToday ? (
                      <CrayonDecoration
                        scene="head"
                        className="absolute -bottom-9 h-[58px] w-auto"
                      />
                    ) : null}
                  </button>
                );
              })
            : Array.from({ length: 7 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden
                  className="flex h-[54px] items-center justify-center rounded-md"
                >
                  <span className="h-5 w-5 animate-pulse rounded bg-muted" />
                </div>
              ))}
        </div>
        <div className="mt-3 text-xs font-medium text-muted-foreground">
          数字表示当天事件 + 待办数量。圆点越多表示当天越忙。
        </div>
      </CardContent>
    </Card>
  );
}
