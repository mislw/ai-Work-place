import { describe, expect, it } from "vitest";
import { workspacePageContextV1Schema } from "@/lib/intake/contracts";
import { captureWorkspacePageContext } from "@/lib/intake/page-context";

describe("captureWorkspacePageContext", () => {
  it.each([
    ["/workspace", "workspace"],
    ["/calendar?date=2026-09-06", "calendar"],
    ["/todos?status=pending", "todos"],
    ["/notes", "notes"],
    ["/documents?search=Hermes", "documents"],
    ["/assistant", "assistant"],
    ["/settings", "settings"],
    ["/unknown/private", "workspace"],
  ] as const)("maps %s to %s without DOM text", (route, pageType) => {
    const context = captureWorkspacePageContext({
      route,
      timezone: "Asia/Shanghai",
      triggerKind: "file_drop",
      clientBatchId: "client-1",
      capturedAt: new Date("2026-09-06T08:00:00.000Z"),
    });

    expect(context.pageType).toBe(pageType);
    expect(workspacePageContextV1Schema.parse(context)).toEqual(context);
  });

  it("bounds filters, omits secrets, and stores only selected IDs", () => {
    const long = "x".repeat(260);
    const context = captureWorkspacePageContext({
      route: `/todos?status=pending&status=done&search=${long}&password=hidden&token=secret`,
      timezone: "Asia/Shanghai",
      triggerKind: "file_picker",
      clientBatchId: "client-2",
      capturedAt: new Date("2026-09-06T09:00:00.000Z"),
      selectedEntity: { type: "todo", id: "todo-1" },
      assistantSessionId: "session-1",
    });
    const serialized = JSON.stringify(context);

    expect(context.route).not.toContain("password");
    expect(context.route).not.toContain("token");
    expect(context.view).toEqual({
      search: "x".repeat(200),
      filters: { status: ["pending", "done"] },
    });
    expect(context.selectedEntity).toEqual({ type: "todo", id: "todo-1" });
    expect(context.assistantSessionId).toBe("session-1");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("secret");
  });

  it("accepts explicit date ranges and never accepts an unsaved note body", () => {
    const context = captureWorkspacePageContext({
      route: "/notes?start=2026-09-01&end=2026-09-06&draft=private-body",
      timezone: "Asia/Shanghai",
      triggerKind: "file_drop",
      clientBatchId: "client-3",
      capturedAt: new Date("2026-09-06T10:00:00.000Z"),
    });

    expect(context.view).toEqual({
      dateRange: { start: "2026-09-01", end: "2026-09-06" },
    });
    expect(JSON.stringify(context)).not.toContain("private-body");
  });

  it("keeps the stored route valid when bounded filters are collectively large", () => {
    const query = new URLSearchParams();
    for (let index = 0; index < 20; index += 1) {
      query.set(`filter-${index}`, "x".repeat(200));
    }

    const context = captureWorkspacePageContext({
      route: `/documents?${query.toString()}`,
      timezone: "Asia/Shanghai",
      triggerKind: "file_drop",
      clientBatchId: "client-4",
      capturedAt: new Date("2026-09-06T11:00:00.000Z"),
    });

    expect(context.route.length).toBeLessThanOrEqual(2_000);
    expect(Object.keys(context.view?.filters ?? {})).toHaveLength(20);
    expect(workspacePageContextV1Schema.parse(context)).toEqual(context);
  });
});
