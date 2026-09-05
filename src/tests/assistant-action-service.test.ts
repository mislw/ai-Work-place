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
      update: vi.fn(() => createFilterQuery([], { error: null })),
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

  it("owner-scopes a conflicting receipt read", async () => {
    const readFilters: Array<[string, unknown]> = [];
    const readQuery = createFilterQuery(readFilters, {
      data: { status: "completed", result: { id: "todo-existing" } },
      error: null,
    });
    const receiptTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "duplicate request id" },
          }),
        })),
      })),
      select: vi.fn(() => readQuery),
    };
    const client = {
      from: vi.fn(() => receiptTable),
    } as unknown as SupabaseClient;

    await expect(
      executeIdempotentWorkbenchAction(
        "owner-1",
        { action: "todo.create", input: { title: "Existing" } },
        "message-1:0",
        client,
      ),
    ).resolves.toEqual({
      result: { id: "todo-existing" },
      replayed: true,
    });

    expect(readFilters).toEqual([
      ["request_id", "message-1:0"],
      ["user_id", "owner-1"],
    ]);
    expect(executeWorkbenchAction).not.toHaveBeenCalled();
  });

  it("owner-scopes failed receipt cleanup", async () => {
    const deleteFilters: Array<[string, unknown]> = [];
    const deleteQuery = createFilterQuery(deleteFilters, { error: null });
    const receiptTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { request_id: "message-1:0" },
            error: null,
          }),
        })),
      })),
      delete: vi.fn(() => deleteQuery),
    };
    const client = {
      from: vi.fn(() => receiptTable),
    } as unknown as SupabaseClient;
    executeWorkbenchAction.mockRejectedValue(new Error("write failed"));

    await expect(
      executeIdempotentWorkbenchAction(
        "owner-1",
        { action: "todo.create", input: { title: "Fail" } },
        "message-1:0",
        client,
      ),
    ).rejects.toThrow("write failed");

    expect(deleteFilters).toEqual([
      ["request_id", "message-1:0"],
      ["user_id", "owner-1"],
    ]);
  });

  it("owner-scopes completed receipt updates", async () => {
    const updateFilters: Array<[string, unknown]> = [];
    const updateQuery = createFilterQuery(updateFilters, { error: null });
    const receiptTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { request_id: "message-1:0" },
            error: null,
          }),
        })),
      })),
      update: vi.fn(() => updateQuery),
    };
    const client = {
      from: vi.fn(() => receiptTable),
    } as unknown as SupabaseClient;
    executeWorkbenchAction.mockResolvedValue({ id: "todo-1" });

    await executeIdempotentWorkbenchAction(
      "owner-1",
      { action: "todo.create", input: { title: "Done" } },
      "message-1:0",
      client,
    );

    expect(updateFilters).toEqual([
      ["request_id", "message-1:0"],
      ["user_id", "owner-1"],
    ]);
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
      update: vi.fn(() =>
        createFilterQuery([], {
          error: { message: "receipt update failed" },
        }),
      ),
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

function createFilterQuery(
  filters: Array<[string, unknown]>,
  result: { data?: unknown; error: { message: string } | null },
) {
  const query = {
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: vi.fn().mockResolvedValue(result),
    then(
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}
