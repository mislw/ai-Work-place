"use client";

import { Bell, Cloud, Search, Sun, Moon, Monitor } from "lucide-react";
import { usePathname } from "next/navigation";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { chineseWeekday, formatChineseDate, dateKey } from "@/lib/date";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useClientNow } from "@/hooks/use-client-now";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

export function TopBar() {
  const pathname = usePathname();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const now = useClientNow(30_000);

  if (pathname?.startsWith("/assistant")) return null;

  return (
    <header className="crayon-paper sticky top-0 z-20 flex h-[78px] items-center gap-3 border-b border-border pl-14 pr-4 sm:px-6">
      <div className="flex items-center gap-3 text-sm font-semibold text-foreground/80">
        <span className="hidden h-10 w-10 rotate-[-8deg] items-center justify-center rounded-full text-[#e94235] sm:flex" aria-hidden>
          <Sun className="h-8 w-8" strokeWidth={2.4} />
        </span>
        <CalendarIcon />
        <span className="hidden sm:inline">
          {now ? (
            <>
              {formatChineseDate(now)} · {chineseWeekday(now)}
            </>
          ) : (
            <span aria-hidden className="inline-block h-5 w-44" />
          )}
        </span>
        <span className="sm:hidden">
          {now ? dateKey(now) : <span aria-hidden className="inline-block w-20" />}
        </span>
      </div>
      <Cloud className="ml-6 hidden h-9 w-9 text-[#3c8dce]/65 md:block" strokeWidth={1.8} aria-hidden />
      <div className="ml-auto flex items-center gap-2">
        {!isMobile ? (
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索 / 命令"
              className="h-9 w-64 pl-8 pr-12"
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
        <span className="relative hidden h-12 w-12 overflow-hidden xl:block" aria-hidden>
          <CrayonDecoration
            scene="head"
            className="absolute left-0 top-1 h-[58px] w-auto"
          />
        </span>
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
      data-ui="page-header"
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
