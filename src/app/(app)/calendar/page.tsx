"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useDataStore } from "@/lib/stores/data";
import { useAuth } from "@/hooks/use-auth";
import { dateKey, CHINESE_WEEKDAYS } from "@/lib/date";
import {
  createEvent,
  updateEvent,
  deleteEvent,
} from "@/lib/data/events";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { cn } from "@/lib/utils";
import {
  getChinaDayInfo,
  type ChinaDayInfo,
} from "@/lib/china-holidays";
import type { CalendarEvent } from "@/types/domain";
import { useClientNow } from "@/hooks/use-client-now";

export default function CalendarPage() {
  const { user } = useAuth();
  const events = useDataStore((s) => s.events);
  const upsertEvent = useDataStore((s) => s.upsertEvent);
  const removeEvent = useDataStore((s) => s.removeEvent);

  const now = useClientNow();
  const initialized = useRef(false);
  const [cursor, setCursor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (!now || initialized.current) return;
    initialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d) {
      const parsed = new Date(d);
      if (!Number.isNaN(parsed.getTime())) {
        setSelected(parsed);
        setCursor(parsed);
        return;
      }
    }
    setSelected(now);
    setCursor(now);
  }, [now]);

  const days = useMemo(() => {
    if (!cursor) return [];
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = e.event_date;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [events]);

  const dayEvents = useMemo(() => {
    if (!selected) return [];
    return eventsByDay.get(dateKey(selected)) ?? [];
  }, [eventsByDay, selected]);

  if (!cursor || !selected || !now) {
    return <CalendarPageSkeleton />;
  }

  const selectedChinaDay = getChinaDayInfo(dateKey(selected));
  const selectedIsToday = isSameDay(selected, now);

  async function handleSubmit(values: {
    title: string;
    description?: string | null;
    event_date: string;
    start_time?: string | null;
    end_time?: string | null;
    is_all_day: boolean;
  }) {
    if (!user) return;
    if (editing) {
      const optimistic: CalendarEvent = {
        ...editing,
        ...values,
        description: values.description ?? null,
        start_time: values.start_time ?? null,
        end_time: values.end_time ?? null,
      };
      upsertEvent(optimistic);
      try {
        const updated = await updateEvent(editing.id, values);
        upsertEvent(updated);
        toast.success("已更新");
      } catch {
        upsertEvent(editing);
        toast.error("更新失败");
      }
    } else {
      const created = await createEvent(user.id, values);
      upsertEvent(created);
      toast.success("已添加");
    }
    setOpen(false);
    setEditing(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snap = pendingDelete;
    removeEvent(id);
    setPendingDelete(null);
    try {
      await deleteEvent(id);
      toast.success("已删除");
    } catch {
      upsertEvent(snap);
      toast.error("删除失败");
    }
  }

  return (
    <div data-crayon-page="calendar" className="crayon-page">
      <PageHeader
        title="日历"
        description="查看月历、安排日程，与手机端实时同步。"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> 新建日程
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <Card className="overflow-hidden border-indigo-100/80 shadow-sm dark:border-indigo-950">
          <CardContent className="p-3 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden />
                <div className="text-lg font-semibold">
                  {format(cursor, "yyyy 年 M 月")}
                </div>
              </div>
              <div className="flex items-center gap-1 self-end sm:self-auto">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="上一月"
                  onClick={() => setCursor(subMonths(cursor, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCursor(now);
                    setSelected(now);
                  }}
                >
                  今天
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下一月"
                  onClick={() => setCursor(addMonths(cursor, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
                (d, index) => (
                  <div
                    key={d}
                    className={cn(
                      "py-2.5 font-semibold",
                      index === 5 && "text-amber-600 dark:text-amber-300",
                      index === 6 && "text-rose-600 dark:text-rose-300",
                    )}
                  >
                    {d}
                  </div>
                ),
              )}
            </div>
            <div
              role="grid"
              aria-label={`${format(cursor, "yyyy 年 M 月")}月历`}
              className="grid grid-cols-7 overflow-hidden rounded-lg border-l border-t border-border/80"
            >
              {days.map((d) => {
                const inMonth = isSameMonth(d, cursor);
                const isToday = isSameDay(d, now);
                const isSelected = isSameDay(d, selected);
                const isSaturday = d.getDay() === 6;
                const isSunday = d.getDay() === 0;
                const ev = eventsByDay.get(dateKey(d)) ?? [];
                const chinaDay = getChinaDayInfo(dateKey(d));
                return (
                  <button
                    key={d.toISOString()}
                    aria-label={calendarDayAriaLabel(d, chinaDay, ev.length)}
                    onClick={() => setSelected(d)}
                    className={cn(
                      "relative flex min-h-[80px] min-w-0 flex-col items-center justify-center gap-0.5 border-b border-r border-border/80 px-1 py-2 text-center transition-colors sm:min-h-[104px] sm:px-2",
                      !inMonth
                        ? "bg-muted/20 text-muted-foreground/45 hover:bg-muted/40"
                        : isSaturday
                          ? "bg-amber-50/70 hover:bg-amber-100/80 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
                          : isSunday
                            ? "bg-rose-50/70 hover:bg-rose-100/80 dark:bg-rose-950/20 dark:hover:bg-rose-950/30"
                            : "hover:bg-muted/50",
                      inMonth && chinaDay.festival
                        ? "border-rose-200 bg-rose-50/80 shadow-[inset_0_0_24px_rgba(244,63,94,0.08)] hover:bg-rose-100/80 dark:border-rose-900/60 dark:bg-rose-950/25"
                        : "",
                      isSelected
                        ? "z-10 ring-2 ring-inset ring-indigo-300 dark:ring-indigo-700"
                        : "",
                    )}
                  >
                    {isToday ? (
                      <span className="absolute left-1 top-1 text-[9px] font-semibold text-indigo-600 dark:text-indigo-300">
                        今天
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "relative inline-flex h-9 w-9 items-center justify-center rounded-full text-lg font-semibold tabular-nums transition-colors sm:h-10 sm:w-10",
                        isSelected || isToday
                          ? "bg-indigo-600 text-white shadow-sm dark:bg-indigo-500"
                          : inMonth && isSaturday
                            ? "text-amber-700 dark:text-amber-300"
                            : inMonth && isSunday
                              ? "text-rose-700 dark:text-rose-300"
                              : "",
                      )}
                    >
                      {format(d, "d")}
                      {chinaDay.schedule ? (
                        <span
                          title={chinaDay.scheduleName}
                          aria-label={chinaDay.scheduleName}
                          className={cn(
                            "absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none",
                            chinaDay.schedule === "holiday"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-800",
                          )}
                        >
                          {chinaDay.schedule === "holiday" ? "休" : "班"}
                        </span>
                      ) : null}
                    </span>
                    <span className="max-w-full truncate text-[10px] text-muted-foreground sm:text-xs">
                      {chinaDay.lunarLabel}
                    </span>
                    {chinaDay.festival ? (
                      <span className="flex max-w-full items-center gap-0.5 truncate text-[10px] font-semibold text-rose-600 sm:text-xs dark:text-rose-300">
                        <Sparkles className="h-2.5 w-2.5 shrink-0" aria-hidden />
                        <span className="truncate">{chinaDay.festival}</span>
                      </span>
                    ) : chinaDay.solarTerm ? (
                      <span className="max-w-full truncate text-[10px] font-semibold text-emerald-600 sm:text-xs dark:text-emerald-400">
                        {chinaDay.solarTerm}
                      </span>
                    ) : null}
                    {ev.length > 0 ? (
                      <span
                        role="img"
                        aria-label={`${ev.length} 项日程`}
                        className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-indigo-100/80 shadow-sm dark:border-indigo-950">
          <CardContent className="p-0">
            <section
              aria-label="所选日期详情"
              className="grid md:grid-cols-[168px_minmax(0,1fr)]"
            >
              <div className="flex flex-col items-center justify-center border-b border-indigo-100 bg-indigo-50/70 px-4 py-5 text-center md:border-b-0 md:border-r dark:border-indigo-950 dark:bg-indigo-950/20">
                <div className="text-5xl font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">
                  {format(selected, "d")}
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {CHINESE_WEEKDAYS[selected.getDay()]}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {selectedChinaDay.lunarDate}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {selectedIsToday ? (
                    <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-[10px] font-semibold text-white">
                      今天
                    </span>
                  ) : null}
                  {selectedChinaDay.festival ? (
                    <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                      {selectedChinaDay.festival}
                    </span>
                  ) : null}
                  {selectedChinaDay.solarTerm ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {selectedChinaDay.solarTerm}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 p-4 sm:p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                      {format(selected, "yyyy 年 M 月 d 日")} ·{" "}
                      {CHINESE_WEEKDAYS[selected.getDay()]}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      共 {dayEvents.length} 项
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(null);
                      setOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    添加
                  </Button>
                </div>
                {dayEvents.length === 0 ? (
                  <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                    <CalendarDays className="h-10 w-10 text-indigo-300 dark:text-indigo-700" />
                    <h3 className="mt-3 text-base font-semibold">当天没有日程</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      点击右上角添加一个日程
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                {dayEvents.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 py-2.5 text-sm"
                  >
                    <div className="w-16 shrink-0 text-xs text-muted-foreground">
                      {e.is_all_day
                        ? "全天"
                        : `${e.start_time ?? ""}${e.end_time ? `-${e.end_time}` : ""}`}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{e.title}</div>
                      {e.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {e.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="编辑"
                        onClick={() => {
                          setEditing(e);
                          setOpen(true);
                        }}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="删除"
                        onClick={() => setPendingDelete(e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
                  </ul>
                )}
              </div>
            </section>
          </CardContent>
        </Card>
      </div>

      <EventFormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
        defaultDate={editing?.event_date ?? dateKey(selected)}
        onSubmit={handleSubmit}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="删除日程？"
        description={`确定删除「${pendingDelete?.title}」吗？`}
        confirmText="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CalendarPageSkeleton() {
  return (
    <div data-crayon-page="calendar" className="crayon-page">
      <PageHeader
        title="日历"
        description="查看月历、安排日程，与手机端实时同步。"
        actions={
          <Button disabled>
            <Plus className="h-4 w-4" /> 新建日程
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
        <Card>
          <CardContent className="space-y-4 p-3 sm:p-4">
            <div className="h-7 w-32 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-7 overflow-hidden rounded-lg border-l border-t">
              {Array.from({ length: 42 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden
                  className="flex min-h-[80px] items-center justify-center border-b border-r sm:min-h-[104px]"
                >
                  <span className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function calendarDayAriaLabel(
  date: Date,
  chinaDay: ChinaDayInfo,
  eventCount: number,
) {
  return [
    format(date, "M月d日"),
    chinaDay.lunarDate,
    chinaDay.festival,
    chinaDay.solarTerm,
    chinaDay.scheduleName,
    eventCount > 0 ? `${eventCount}项日程` : undefined,
  ]
    .filter(Boolean)
    .join("，");
}
