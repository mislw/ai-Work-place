"use client";

import { useMemo } from "react";
import { useDataStore } from "@/lib/stores/data";
import { dateKey, CHINESE_WEEKDAYS } from "@/lib/date";
import {
  addDays,
  format,
  isSameDay,
  startOfWeek,
  subDays,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function WeekStripCard() {
  const router = useRouter();
  const events = useDataStore((s) => s.events);
  const todos = useDataStore((s) => s.todos);
  const today = useMemo(() => new Date(), []);

  const days = useMemo(() => {
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
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>本周日历</CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link href="/calendar">打开日历</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const isToday = isSameDay(d, today);
            const ev = eventCount(d);
            const td = todoCount(d);
            return (
              <button
                key={d.toISOString()}
                onClick={() => router.push(`/calendar?date=${dateKey(d)}`)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md py-2 text-sm transition-colors",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                <span className="font-medium">{format(d, "d")}</span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {ev + td > 0 ? (
                    <>
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isToday ? "bg-primary-foreground" : "bg-foreground/70",
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
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          数字表示当天事件 + 待办数量。圆点越多表示当天越忙。
        </div>
      </CardContent>
    </Card>
  );
}
