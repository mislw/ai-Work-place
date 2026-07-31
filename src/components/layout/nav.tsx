"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { signOut } from "@/hooks/use-require-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";

const NAV = [
  { href: "/workspace", label: "工作台", icon: LayoutDashboard },
  { href: "/calendar", label: "日历", icon: CalendarDays },
  { href: "/todos", label: "今日待办", icon: CheckSquare },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/documents", label: "文档", icon: Sparkles },
  { href: "/settings", label: "设置", icon: SettingsIcon },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-[240px] lg:w-[256px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
          AI
        </div>
        <span className="text-sm font-semibold tracking-tight">AI 工作站</span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <LogoutButton />
    </aside>
  );
}

function LogoutButton() {
  const router = useRouter();
  return (
    <div className="border-t border-border p-3">
      <Button
        variant="ghost"
        className="w-full justify-start gap-3"
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
            className="absolute left-0 top-0 h-full w-72 max-w-[80%] bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4">
              <span className="text-sm font-semibold">AI 工作站</span>
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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
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
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (!isMobile) return null;
  const items = NAV.slice(0, 4);
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card safe-bottom"
      aria-label="底部导航"
    >
      {items.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-1 py-2 text-xs",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
