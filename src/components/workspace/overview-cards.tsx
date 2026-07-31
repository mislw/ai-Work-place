"use client";

import { useMemo } from "react";
import { CheckSquare, FileText, CalendarDays, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useDataStore } from "@/lib/stores/data";
import { dateKey, hhmmToMinutes } from "@/lib/date";
import Link from "next/link";

export function OverviewCards() {
  const todos = useDataStore((s) => s.todos);
  const notes = useDataStore((s) => s.notes);
  const events = useDataStore((s) => s.events);

  const today = useMemo(() => dateKey(new Date()), []);

  const todayTodos = useMemo(
    () => todos.filter((t) => t.due_date === today),
    [todos, today],
  );
  const completed = todayTodos.filter((t) => t.status === "completed").length;
  const todayNotes = useMemo(
    () => notes.filter((n) => n.created_at.slice(0, 10) === today),
    [notes, today],
  );
  const todayEvents = useMemo(
    () => events.filter((e) => e.event_date === today),
    [events, today],
  );
  const focusMinutes = useMemo(() => {
    return todayEvents.reduce((acc, e) => {
      if (e.is_all_day || !e.start_time || !e.end_time) return acc;
      const start = hhmmToMinutes(e.start_time) ?? 0;
      const end = hhmmToMinutes(e.end_time) ?? start;
      return acc + Math.max(0, end - start);
    }, 0);
  }, [todayEvents]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <OverviewCard
        href="/todos"
        icon={<CheckSquare className="h-4 w-4" />}
        label="今日待办"
        value={`${completed}/${todayTodos.length || 0}`}
        sub={
          todayTodos.length > 0
            ? `已完成 ${Math.round((completed / todayTodos.length) * 100)}%`
            : "今天还没有待办"
        }
      />
      <OverviewCard
        href="/notes"
        icon={<FileText className="h-4 w-4" />}
        label="快速笔记"
        value={`${todayNotes.length} 条`}
        sub="今日记录"
      />
      <OverviewCard
        href="/calendar"
        icon={<CalendarDays className="h-4 w-4" />}
        label="日程安排"
        value={`${todayEvents.length} 个`}
        sub="今日事件"
      />
      <OverviewCard
        href="/calendar"
        icon={<Clock className="h-4 w-4" />}
        label="专注时间"
        value={`${(focusMinutes / 60).toFixed(1)} h`}
        sub="今日累计"
      />
    </div>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block focus-visible:outline-none"
    >
      <Card className="h-full p-4 transition-colors group-hover:bg-muted/50">
        <div className="flex items-start justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </Card>
    </Link>
  );
}
