// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { getHarnessConfig, signHarnessBootstrapToken } = vi.hoisted(() => ({
  getHarnessConfig: vi.fn(),
  signHarnessBootstrapToken: vi.fn(),
}));

vi.mock("@/lib/harness/config", () => ({ getHarnessConfig }));
vi.mock("@/lib/harness/bootstrap-token", () => ({
  signHarnessBootstrapToken,
}));

import {
  callHarnessRpc,
} from "@/lib/assistant/harness-server";

describe("server-side Harness adapter", () => {
  it("exchanges a one-time token and forwards RPC with only the gateway cookie", async () => {
    getHarnessConfig.mockReturnValue({
      publicOrigin: "https://agent.example.com",
      ownerUserId: "owner-1",
    });
    signHarnessBootstrapToken.mockResolvedValue("bootstrap-token");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie": "dsh_embed=session-token; Path=/; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          type: "server-response",
          rpcId: "rpc-1",
          result: { ok: true, value: { sessionId: "session-1" } },
        }),
      );

    const body = await callHarnessRpc(
      "owner-1",
      "/api/session.create",
      {
        type: "client-request",
        rpcId: "rpc-1",
        method: "session.create",
        payload: {},
      },
      fetcher,
    );

    expect(body).toEqual(
      expect.objectContaining({ type: "server-response", rpcId: "rpc-1" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://agent.example.com/auth/bootstrap?token=bootstrap-token",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://agent.example.com/api/session.create",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ cookie: "dsh_embed=session-token" }),
      }),
    );
  });
});
