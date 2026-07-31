"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useDataStore } from "@/lib/stores/data";
import { useBootstrapData } from "@/hooks/use-bootstrap-data";
import { useAuth } from "@/hooks/use-auth";
import { dateKey, CHINESE_WEEKDAYS } from "@/lib/date";
import {
  createEvent,
  updateEvent,
  deleteEvent,
} from "@/lib/data/events";
import { EventFormDialog } from "@/components/calendar/event-form-dialog";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/domain";

export default function CalendarPage() {
  useBootstrapData();
  const { user } = useAuth();
  const events = useDataStore((s) => s.events);
  const upsertEvent = useDataStore((s) => s.upsertEvent);
  const removeEvent = useDataStore((s) => s.removeEvent);

  const [cursor, setCursor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const d = params.get("date");
    if (d) {
      const parsed = new Date(d);
      if (!Number.isNaN(parsed.getTime())) {
        setSelected(parsed);
        setCursor(parsed);
      }
    }
  }, []);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const days = useMemo(() => {
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [monthStart, monthEnd]);

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
    return eventsByDay.get(dateKey(selected)) ?? [];
  }, [eventsByDay, selected]);

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
    <>
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
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">
                {format(cursor, "yyyy 年 M 月")}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一月"
                  onClick={() => setCursor(subMonths(cursor, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const t = new Date();
                    setCursor(t);
                    setSelected(t);
                  }}
                >
                  今天
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一月"
                  onClick={() => setCursor(addMonths(cursor, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
              {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => {
                const inMonth = isSameMonth(d, cursor);
                const isToday = isSameDay(d, new Date());
                const isSelected = isSameDay(d, selected);
                const ev = eventsByDay.get(dateKey(d)) ?? [];
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => setSelected(d)}
                    className={cn(
                      "min-h-[64px] rounded-md border border-transparent p-1.5 text-left text-sm transition-colors",
                      inMonth ? "" : "text-muted-foreground/50",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                        isToday
                          ? "bg-primary text-primary-foreground"
                          : "",
                      )}
                    >
                      {format(d, "d")}
                    </div>
                    <ul className="space-y-0.5">
                      {ev.slice(0, 2).map((e) => (
                        <li
                          key={e.id}
                          className="truncate rounded bg-muted px-1 py-0.5 text-[10px] text-foreground/80"
                        >
                          {e.start_time && !e.is_all_day ? `${e.start_time} ` : ""}
                          {e.title}
                        </li>
                      ))}
                      {ev.length > 2 ? (
                        <li className="text-[10px] text-muted-foreground">
                          +{ev.length - 2} 项
                        </li>
                      ) : null}
                    </ul>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">
                  {format(selected, "yyyy 年 M 月 d 日")} ·{" "}
                  {CHINESE_WEEKDAYS[selected.getDay()]}
                </h3>
                <p className="text-xs text-muted-foreground">
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
              <EmptyState
                title="当天没有日程"
                description="点击右上角添加一个日程"
                className="bg-muted/30 py-8"
              />
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
    </>
  );
}
