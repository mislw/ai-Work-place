// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssistantOwner, executeIdempotentWorkbenchAction } = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  executeIdempotentWorkbenchAction: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {},
  getAssistantOwner,
}));
vi.mock("@/lib/assistant/action-service", () => ({
  executeIdempotentWorkbenchAction,
}));

import { POST } from "@/app/api/assistant/actions/route";

function actionRequest(body: unknown) {
  return new Request("http://localhost/api/assistant/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/assistant/actions", () => {
  beforeEach(() => {
    getAssistantOwner.mockReset();
    executeIdempotentWorkbenchAction.mockReset();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
  });

  it("executes create actions immediately", async () => {
    executeIdempotentWorkbenchAction.mockResolvedValue({
      result: { id: "todo-1", title: "整理 UI" },
      replayed: false,
    });

    const response = await POST(
      actionRequest({
        action: { action: "todo.create", input: { title: "整理 UI" } },
        requestId: "assistant-1:0",
      }),
    );

    expect(response.status).toBe(200);
    expect(executeIdempotentWorkbenchAction).toHaveBeenCalledWith(
      "owner-1",
      { action: "todo.create", input: { title: "整理 UI" } },
      "assistant-1:0",
    );
  });

  it("returns a confirmation requirement without executing a completion", async () => {
    const response = await POST(
      actionRequest({
        action: { action: "todo.complete", input: { id: "todo-1" } },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({ requiresConfirmation: true }),
    );
    expect(executeIdempotentWorkbenchAction).not.toHaveBeenCalled();
  });

  it("executes a confirmation-required action after explicit confirmation", async () => {
    executeIdempotentWorkbenchAction.mockResolvedValue({
      result: { id: "todo-1", status: "completed" },
      replayed: false,
    });

    const response = await POST(
      actionRequest({
        confirmed: true,
        action: { action: "todo.complete", input: { id: "todo-1" } },
      }),
    );

    expect(response.status).toBe(200);
    expect(executeIdempotentWorkbenchAction).toHaveBeenCalledTimes(1);
  });

  it("requires a stable request id for create actions", async () => {
    const response = await POST(
      actionRequest({
        action: { action: "note.create", input: { title: "Harness" } },
      }),
    );

    expect(response.status).toBe(400);
    expect(executeIdempotentWorkbenchAction).not.toHaveBeenCalled();
  });
});
