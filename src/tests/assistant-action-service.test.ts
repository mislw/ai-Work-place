// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { createRouteHandlerClient, executeWorkbenchAction } = vi.hoisted(() => ({
  createRouteHandlerClient: vi.fn(),
  executeWorkbenchAction: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createRouteHandlerClient }));
vi.mock("@/lib/assistant/action-executor", () => ({ executeWorkbenchAction }));

import { executeIdempotentWorkbenchAction } from "@/lib/assistant/action-service";

describe("executeIdempotentWorkbenchAction", () => {
  beforeEach(() => {
    createRouteHandlerClient.mockReset();
    executeWorkbenchAction.mockReset();
  });

  it("reuses an injected client for the receipt and action execution", async () => {
    const receiptTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { request_id: "message-1:0" },
            error: null,
          }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const fallbackClient = {
      from: vi.fn(() => receiptTable),
    } as unknown as SupabaseClient;
    const injectedClient = {
      from: vi.fn(() => receiptTable),
    } as unknown as SupabaseClient;
    createRouteHandlerClient.mockResolvedValue(fallbackClient);
    executeWorkbenchAction.mockResolvedValue({ id: "todo-1", title: "整理 UI" });

    await expect(
      executeIdempotentWorkbenchAction(
        "owner-1",
        { action: "todo.create", input: { title: "整理 UI" } },
        "message-1:0",
        injectedClient,
      ),
    ).resolves.toEqual({
      result: { id: "todo-1", title: "整理 UI" },
      replayed: false,
    });

    expect(createRouteHandlerClient).not.toHaveBeenCalled();
    expect(injectedClient.from).toHaveBeenCalledWith("assistant_action_receipts");
    expect(fallbackClient.from).not.toHaveBeenCalled();
    expect(executeWorkbenchAction.mock.calls[0]?.[2]).toBe(injectedClient);
  });

  it("does not retry a committed create when receipt completion fails", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const receiptTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { request_id: "message-1:0" },
            error: null,
          }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: { message: "receipt update failed" } }),
      })),
      delete: vi.fn(() => ({ eq: deleteEq })),
    };
    createRouteHandlerClient.mockResolvedValue({
      from: vi.fn(() => receiptTable),
    });
    executeWorkbenchAction.mockResolvedValue({ id: "todo-1", title: "整理 UI" });

    await expect(
      executeIdempotentWorkbenchAction(
        "owner-1",
        { action: "todo.create", input: { title: "整理 UI" } },
        "message-1:0",
      ),
    ).resolves.toEqual({
      result: { id: "todo-1", title: "整理 UI" },
      replayed: false,
    });
    expect(deleteEq).not.toHaveBeenCalled();
  });
});
