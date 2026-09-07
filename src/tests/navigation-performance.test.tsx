import fs from "node:fs";
import path from "node:path";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

const navigationState = vi.hoisted(() => ({
  pathname: "/todos",
}));

const bootstrapState = vi.hoisted(() => ({
  configured: false,
  run: vi.fn(),
}));

const viewportState = vi.hoisted(() => ({
  isMobile: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
      prefetch?: boolean;
    }
  >(function MockLink(
    { href, children, onClick, prefetch: _prefetch, ...props },
    ref,
  ) {
    return (
      <a
        ref={ref}
        href={href}
        data-prefetch={String(_prefetch)}
        onClick={(event) => {
          event.preventDefault();
          onClick?.(event);
        }}
        {...props}
      >
        {children}
      </a>
    );
  }),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => viewportState.isMobile,
}));

vi.mock("@/hooks/use-bootstrap-data", () => ({
  useBootstrapData: bootstrapState.run,
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseBrowserConfigured: () => bootstrapState.configured,
}));

import { BottomNav, MobileNav, Sidebar } from "@/components/layout/nav";
import { TopBar } from "@/components/layout/topbar";
import { AppDataBootstrap } from "@/components/layout/app-data-bootstrap";

const projectRoot = path.resolve(__dirname, "../..");
const appPages = [
  "workspace/page.tsx",
  "assistant/page.tsx",
  "todos/page.tsx",
  "calendar/page.tsx",
  "notes/page.tsx",
  "documents/page.tsx",
  "toolbox/page.tsx",
];

describe("navigation performance safeguards", () => {
  beforeEach(() => {
    navigationState.pathname = "/todos";
    viewportState.isMobile = false;
    bootstrapState.configured = false;
    bootstrapState.run.mockReset();
  });

  it("starts shared data bootstrap from the persistent app layout only", () => {
    const layout = fs.readFileSync(
      path.join(projectRoot, "src/app/(app)/layout.tsx"),
      "utf8",
    );

    expect(layout).toContain("AppDataBootstrap");
    for (const page of appPages) {
      const source = fs.readFileSync(
        path.join(projectRoot, "src/app/(app)", page),
        "utf8",
      );
      expect(source).not.toContain("useBootstrapData");
    }
  });

  it("provides an instant route loading state", () => {
    expect(
      fs.existsSync(path.join(projectRoot, "src/app/(app)/loading.tsx")),
    ).toBe(true);
  });

  it("skips shared data bootstrap when Supabase is not configured", () => {
    render(<AppDataBootstrap />);

    expect(bootstrapState.run).not.toHaveBeenCalled();
  });

  it("marks a clicked navigation item busy before the route changes", () => {
    render(<Sidebar />);

    const notesLink = screen.getByRole("link", { name: "笔记" });
    fireEvent.click(notesLink);

    expect(notesLink).toHaveAttribute("aria-busy", "true");
  });

  it("keeps a local Shin-chan character visible in the desktop sidebar", () => {
    const { container } = render(<Sidebar />);
    const character = container.querySelector(
      'img[src*="shinchan-sidebar-clean"]',
    );

    expect(character).toBeInTheDocument();
    expect(character).toHaveAttribute("aria-hidden", "true");
  });

  it("does not leave the current navigation item busy when clicked again", () => {
    render(<Sidebar />);

    const todosLink = screen.getByRole("link", { name: "今日待办" });
    fireEvent.click(todosLink);

    expect(todosLink).toHaveAttribute("aria-busy", "false");
  });

  it("fully prefetches business routes but keeps settings on demand", () => {
    render(<Sidebar />);

    const assistantLink = screen.getByRole("link", { name: "AI 助手" });
    const notesLink = screen.getByRole("link", { name: "笔记" });
    const settingsLink = screen.getByRole("link", { name: "设置" });

    expect(assistantLink).toHaveAttribute("data-prefetch", "true");
    expect(notesLink).toHaveAttribute("data-prefetch", "true");
    expect(settingsLink).toHaveAttribute("data-prefetch", "false");
  });

  it("keeps the assistant route out of PWA document caching", () => {
    const source = fs.readFileSync(path.join(projectRoot, "next.config.mjs"), {
      encoding: "utf8",
    });

    expect(source).toContain("cacheOnFrontEndNav: false");
    expect(source).toContain("/^\\/assistant(?:\\/|$)/");
    expect(source).toContain('handler: "NetworkOnly"');
    expect(source).toContain('url.pathname === "/assistant"');
    expect(source).toContain('url.pathname.startsWith("/assistant/")');
  });

  it("keeps the mobile bottom nav on the primary productivity routes", () => {
    viewportState.isMobile = true;
    navigationState.pathname = "/workspace";

    render(<BottomNav />);

    const bottomNav = screen.getByRole("navigation", { name: "底部导航" });
    const labels = within(bottomNav)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(labels).toEqual(["工作台", "日历", "今日待办", "笔记"]);
    expect(
      within(bottomNav).queryByRole("link", { name: "AI 助手" }),
    ).not.toBeInTheDocument();
  });

  it("hides assistant chrome while keeping the mobile drawer available", () => {
    viewportState.isMobile = true;
    navigationState.pathname = "/assistant";

    render(
      <>
        <MobileNav />
        <TopBar />
        <BottomNav />
      </>,
    );

    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "底部导航" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开菜单" }));

    expect(screen.getByRole("link", { name: "工作台" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI 助手" })).toHaveAttribute(
      "data-prefetch",
      "true",
    );
  });
});
