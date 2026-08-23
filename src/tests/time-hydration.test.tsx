import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => false,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: null,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useThemeMode: () => ({
    mode: "light",
    setMode: vi.fn(),
  }),
}));

import CalendarPage from "@/app/(app)/calendar/page";
import { TopBar } from "@/components/layout/topbar";
import { WeekStripCard } from "@/components/workspace/week-strip";

function renderDateSensitiveShell(): string {
  return renderToString(
    <>
      <TopBar />
      <WeekStripCard />
      <CalendarPage />
    </>,
  );
}

describe("date-sensitive server rendering", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps server markup stable when the clock crosses into another day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T15:20:00.000Z"));
    const beforeMidnight = renderDateSensitiveShell();

    vi.setSystemTime(new Date("2026-08-22T17:20:00.000Z"));
    const afterMidnight = renderDateSensitiveShell();

    expect(afterMidnight).toBe(beforeMidnight);
  });
});
