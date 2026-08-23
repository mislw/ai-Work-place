// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssistantOwner, callHarnessRpc } = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  callHarnessRpc: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({ getAssistantOwner }));
vi.mock("@/lib/assistant/harness-server", () => ({ callHarnessRpc }));

import { POST } from "@/app/api/assistant/rpc/route";

describe("POST /api/assistant/rpc", () => {
  beforeEach(() => {
    getAssistantOwner.mockReset();
    callHarnessRpc.mockReset();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
  });

  it("forwards only an allowlisted Harness RPC", async () => {
    callHarnessRpc.mockResolvedValue({
      type: "server-response",
      rpcId: "rpc-1",
      result: { ok: true, value: { sessionId: "session-1" } },
    });

    const response = await POST(
      new Request("http://localhost/api/assistant/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "session.create", payload: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect(callHarnessRpc).toHaveBeenCalledWith(
      "owner-1",
      "/api/session.create",
      expect.objectContaining({
        type: "client-request",
        method: "session.create",
      }),
    );
  });

  it("rejects arbitrary Harness methods", async () => {
    const response = await POST(
      new Request("http://localhost/api/assistant/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "settings.write", payload: {} }),
      }),
    );

    expect(response.status).toBe(400);
    expect(callHarnessRpc).not.toHaveBeenCalled();
  });
});
