"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  Bot,
  CheckSquare,
  FileText,
  House,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { signOut } from "@/hooks/use-require-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

const NAV = [
  { href: "/workspace", label: "工作台", icon: House, iconClass: "text-[#e94235]" },
  { href: "/assistant", label: "AI 助手", icon: Bot, iconClass: "text-[#3c8dce]" },
  { href: "/calendar", label: "日历", icon: CalendarDays, iconClass: "text-[#e94235]" },
  { href: "/todos", label: "今日待办", icon: CheckSquare, iconClass: "text-[#c39809]" },
  { href: "/notes", label: "笔记", icon: FileText, iconClass: "text-[#64a85c]" },
  { href: "/documents", label: "文档", icon: Sparkles, iconClass: "text-[#3c8dce]" },
  { href: "/settings", label: "设置", icon: SettingsIcon, iconClass: "text-foreground/70" },
] as const;
const BOTTOM_NAV_HREFS = new Set(["/workspace", "/calendar", "/todos", "/notes"]);

export function Sidebar() {
  const pathname = usePathname();
  const { pendingHref, markPending } = usePendingNavigation(pathname);
  return (
    <aside className="crayon-sidebar sticky top-0 hidden h-svh shrink-0 self-start flex-col overflow-hidden border-r border-border bg-[#fff9e9]/92 md:flex md:w-[240px] lg:w-[256px] dark:bg-card">
      <div className="relative flex h-[78px] items-center gap-3 border-b border-border px-5">
        <div className="crayon-brand-mark flex h-11 w-12 rotate-[-2deg] items-center justify-center rounded-md bg-white/70 text-xl font-black dark:bg-card">
          <span className="text-[#e94235]">A</span>
          <span className="text-[#3c8dce]">I</span>
        </div>
        <div className="min-w-0">
          <span className="crayon-display block text-lg leading-none text-[#29251e] dark:text-foreground">
            AI 工作站
          </span>
          <span className="mt-1.5 block text-[10px] font-semibold text-muted-foreground">今天也要元气满满</span>
        </div>
        <CrayonDecoration
          scene="head"
          className="absolute -right-1 bottom-0 h-[56px] w-auto"
        />
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const pending = pendingHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.href !== "/settings"}
              aria-busy={pending}
              onClick={() => markPending(item.href)}
              className={cn(
                "flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-[#d93636]/70 bg-[#e94743] text-white"
                  : "text-foreground/80 hover:bg-[#fff1bd]/70 hover:text-foreground dark:hover:bg-muted",
              )}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <item.icon
                  className={cn(
                    "h-4 w-4",
                    active ? "text-white" : item.iconClass,
                  )}
                />
              )}
              {item.label}
              {active ? (
                <span className="ml-auto text-[#f5d447]" aria-hidden>
                  ★
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="crayon-sidebar-cameo relative flex h-[246px] min-h-[104px] shrink items-end justify-center overflow-hidden px-2">
        <CrayonDecoration
          scene="sidebar"
          className="absolute bottom-0 h-auto w-[190px] max-w-none translate-y-1"
        />
      </div>
      <LogoutButton />
    </aside>
  );
}

function LogoutButton() {
  const router = useRouter();
  return (
    <div className="border-t border-border bg-[#fff9e9]/92 p-3 dark:bg-card">
      <Button
        variant="ghost"
        className="w-full justify-start gap-3 shadow-none"
        onClick={async () => {
          await signOut();
          toast.success("已退出登录");
          router.replace("/login");
        }}
      >
        <LogOut className="h-4 w-4" />
        退出登录
      </Button>
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { pendingHref, markPending } = usePendingNavigation(pathname);
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (!isMobile) return null;

  return (
    <>
      <button
        aria-label="打开菜单"
        className="md:hidden fixed left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="crayon-paper absolute left-0 top-0 h-full w-72 max-w-[80%] border-r-2 border-border p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4">
              <span className="crayon-display text-lg text-[#e94743]">AI 工作站</span>
              <button
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="space-y-1">
              {NAV.map((item) => {
                const active = pathname?.startsWith(item.href);
                const pending = pendingHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={item.href !== "/settings"}
                    aria-busy={pending}
                    onClick={() => {
                      markPending(item.href);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-md border-2 border-transparent px-3 py-2 text-sm font-semibold transition-colors",
                      active
                        ? "border-[#d93636] bg-[#e94743] text-white"
                        : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <item.icon className="h-4 w-4" />
                    )}
                    {item.label}
                  </Link>
                );
              })}
              <button
                onClick={async () => {
                  setOpen(false);
                  await signOut();
                  toast.success("已退出登录");
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 手机底部固定 5 项导航（不含文档，避免过密）。 */
export function BottomNav() {
  const pathname = usePathname();
  const { pendingHref, markPending } = usePendingNavigation(pathname);
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (pathname?.startsWith("/assistant")) return null;
  if (!isMobile) return null;
  const items = NAV.filter((item) => BOTTOM_NAV_HREFS.has(item.href));
  return (
    <nav
      className="crayon-paper fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t-2 border-border md:hidden safe-bottom"
      aria-label="底部导航"
    >
      {items.map((item) => {
        const active = pathname?.startsWith(item.href);
        const pending = pendingHref === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={item.href !== "/settings"}
            aria-busy={pending}
            onClick={() => markPending(item.href)}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 py-2 text-xs font-semibold",
              active ? "text-[#e94743]" : "text-muted-foreground",
            )}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <item.icon className="h-4 w-4" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function usePendingNavigation(pathname: string | null) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return {
    pendingHref,
    markPending: (href: string) => {
      setPendingHref(pathname === href ? null : href);
    },
  };
}
