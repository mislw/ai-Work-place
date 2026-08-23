"use client";

import { useMemo } from "react";
import { AlarmClock, CalendarDays, ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useDataStore } from "@/lib/stores/data";
import { dateKey, hhmmToMinutes } from "@/lib/date";
import Link from "next/link";
import { useClientNow } from "@/hooks/use-client-now";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

const TONE_CLASS = {
  yellow: "workspace-stat-yellow",
  green: "workspace-stat-green",
  blue: "workspace-stat-blue",
} as const;

export function OverviewCards() {
  const todos = useDataStore((s) => s.todos);
  const events = useDataStore((s) => s.events);
  const now = useClientNow();

  const today = useMemo(() => (now ? dateKey(now) : ""), [now]);

  const todayTodos = useMemo(
    () => todos.filter((t) => t.due_date === today),
    [todos, today],
  );
  const completed = todayTodos.filter((t) => t.status === "completed").length;
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
    <section
      aria-label="工作台概览"
      className="grid grid-cols-1 gap-3 lg:grid-cols-3"
    >
      <OverviewCard
        tone="yellow"
        href="/todos"
        icon={<ClipboardCheck className="h-9 w-9" />}
        label="今日待办"
        value={`${completed}/${todayTodos.length || 0}`}
        sub={
          todayTodos.length > 0
            ? `已完成 ${Math.round((completed / todayTodos.length) * 100)}%`
            : "今天还没有待办"
        }
      />
      <OverviewCard
        tone="green"
        href="/calendar"
        icon={<CalendarDays className="h-9 w-9" />}
        label="日程安排"
        value={`${todayEvents.length} 个`}
        sub="今日事件"
        character="standing"
      />
      <OverviewCard
        tone="blue"
        href="/calendar"
        icon={<AlarmClock className="h-9 w-9" />}
        label="专注时间"
        value={`${(focusMinutes / 60).toFixed(1)} h`}
        sub="今日累计"
      />
    </section>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  sub,
  href,
  tone,
  character,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  href: string;
  tone: "yellow" | "green" | "blue";
  character?: "standing";
}) {
  return (
    <Link
      href={href}
      className="group block min-w-0 focus-visible:outline-none"
    >
      <Card className={`workspace-stat-card ${TONE_CLASS[tone]} relative h-[142px] overflow-hidden p-4 transition-transform group-hover:-translate-y-0.5`}>
        <div className="relative z-10 flex h-full items-center gap-4">
          <span className="workspace-stat-icon shrink-0" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-foreground/80">{label}</span>
            <div className="mt-1 text-[32px] font-black leading-none text-foreground">
              {value}
            </div>
            <div className="mt-2 text-xs font-medium text-muted-foreground">{sub}</div>
          </div>
        </div>
        {character ? (
          <CrayonDecoration
            scene={character}
            className="absolute bottom-0 right-3 block h-[124px] w-auto opacity-95 lg:hidden xl:block"
          />
        ) : null}
      </Card>
    </Link>
  );
}
