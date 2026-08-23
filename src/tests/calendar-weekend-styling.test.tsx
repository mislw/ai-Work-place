import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/types/domain";

globalThis.React = React;

const dataState = vi.hoisted(() => ({
  events: [] as CalendarEvent[],
  upsertEvent: vi.fn(),
  removeEvent: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "preview-user" },
  }),
}));

vi.mock("@/hooks/use-client-now", () => ({
  useClientNow: () => new Date(2026, 7, 22),
}));

vi.mock("@/lib/stores/data", () => ({
  useDataStore: (selector: (state: typeof dataState) => unknown) =>
    selector(dataState),
}));

import CalendarPage from "@/app/(app)/calendar/page";

describe("calendar weekend styling", () => {
  beforeEach(() => {
    dataState.events = [];
    window.history.replaceState(null, "", "/calendar?date=2026-08-19");
  });

  it("gives Saturday and Sunday distinct bright colors", async () => {
    render(<CalendarPage />);

    const saturday = await screen.findByRole("button", { name: /8月22日/ });
    const sunday = screen.getByRole("button", { name: /8月23日/ });

    expect(screen.getByText("周六")).toHaveClass("text-amber-600");
    expect(screen.getByText("周日")).toHaveClass("text-rose-600");
    expect(saturday).toHaveClass("bg-amber-50/70");
    expect(sunday).toHaveClass("bg-rose-50/70");

    expect(within(saturday).getByText("22")).toHaveClass("bg-indigo-600");
    expect(within(sunday).getByText("23")).toHaveClass("text-rose-700");
  });

  it("renders a bordered lunar grid with emphasized festivals and date details", async () => {
    render(<CalendarPage />);

    const grid = await screen.findByRole("grid", {
      name: "2026 年 8 月月历",
    });
    const festivalDay = screen.getByRole("button", {
      name: /8月19日.*农历七月初七.*七夕/,
    });
    const solarTermDay = screen.getByRole("button", {
      name: /8月7日.*立秋/,
    });

    expect(grid).toHaveClass("border-l", "border-t");
    expect(festivalDay).toHaveClass("bg-rose-50/80", "border-rose-200");
    expect(festivalDay).toHaveClass("ring-indigo-300");
    expect(within(festivalDay).getByText("19")).toHaveClass("bg-indigo-600");
    expect(solarTermDay).toHaveTextContent("立秋");
    expect(
      screen.getByRole("region", { name: "所选日期详情" }),
    ).toHaveTextContent("农历七月初七");
  });

  it("keeps schedules and personal events compact inside date cells", async () => {
    dataState.events = [
      {
        id: "event-1",
        user_id: "preview-user",
        title: "项目复盘",
        description: null,
        event_date: "2026-02-17",
        start_time: null,
        end_time: null,
        is_all_day: true,
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ];
    window.history.replaceState(null, "", "/calendar?date=2026-02-17");

    render(<CalendarPage />);

    const grid = await screen.findByRole("grid", {
      name: "2026 年 2 月月历",
    });
    const springFestival = screen.getByRole("button", {
      name: /2月17日.*春节.*1项日程/,
    });

    expect(within(springFestival).getByLabelText("春节")).toHaveTextContent(
      "休",
    );
    expect(
      within(springFestival).getByRole("img", { name: "1 项日程" }),
    ).toBeInTheDocument();
    expect(within(grid).queryByText("项目复盘")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "所选日期详情" }),
    ).toHaveTextContent("项目复盘");
  });
});
