import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDataStore, useUIStore } from "@/lib/stores/data";

globalThis.React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "preview-user", email: "preview@example.local" },
    loading: false,
  }),
}));

vi.mock("@/hooks/use-client-now", () => ({
  useClientNow: () => new Date("2026-08-22T09:30:00+08:00"),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
  isSupabaseBrowserConfigured: () => false,
}));

import WorkspacePage from "@/app/(app)/workspace/page";

describe("workspace home layout", () => {
  beforeEach(() => {
    useDataStore.getState().reset();
    useUIStore.getState().setCapabilities(false, false);
  });

  it("shows exactly the three overview cards from the approved dashboard", () => {
    render(<WorkspacePage />);

    const overview = screen.getByRole("region", { name: "工作台概览" });
    const cards = within(overview).getAllByRole("link");

    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("今日待办"),
      expect.stringContaining("日程安排"),
      expect.stringContaining("专注时间"),
    ]);
  });

  it("keeps todos and AI together, then ends the home with the weekly calendar", () => {
    render(<WorkspacePage />);

    const primary = screen.getByRole("region", { name: "今日工作" });
    expect(
      within(primary).getByRole("heading", { name: "今日待办" }),
    ).toBeInTheDocument();
    expect(
      within(primary).getByRole("heading", { name: "AI 助手" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "本周日历" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "快速笔记" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "最近文档" }),
    ).not.toBeInTheDocument();
  });
});
