// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

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
