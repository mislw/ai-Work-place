"use client";

import { useEffect, useState } from "react";
import { Bell, Search, Sun, Moon, Monitor } from "lucide-react";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { chineseWeekday, formatChineseDate, dateKey } from "@/lib/date";
import { useMediaQuery } from "@/hooks/use-media-query";

export function TopBar() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarIcon />
        <span className="hidden sm:inline">
          {formatChineseDate(now)} · {chineseWeekday(now)}
        </span>
        <span className="sm:hidden">{dateKey(now)}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {!isMobile ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索 / 命令"
              className="h-9 w-56 pl-8"
              aria-label="搜索"
            />
            <kbd className="pointer-events-none absolute right-2 top-2 inline-flex h-5 select-none items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        ) : null}
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label="通知">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  const next: Record<ThemeMode, ThemeMode> = {
    light: "dark",
    dark: "system",
    system: "light",
  };
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="切换主题"
      onClick={() => setMode(next[mode])}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border bg-background px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6",
      )}
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
