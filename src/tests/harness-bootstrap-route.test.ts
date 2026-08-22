// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getUser,
  createRouteHandlerClient,
  getHarnessConfig,
  signHarnessBootstrapToken,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  createRouteHandlerClient: vi.fn(),
  getHarnessConfig: vi.fn(),
  signHarnessBootstrapToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createRouteHandlerClient }));
vi.mock("@/lib/harness/config", () => ({ getHarnessConfig }));
vi.mock("@/lib/harness/bootstrap-token", () => ({
  signHarnessBootstrapToken,
}));

import { POST } from "@/app/api/harness/bootstrap/route";

describe("POST /api/harness/bootstrap", () => {
  beforeEach(() => {
    getUser.mockReset();
    createRouteHandlerClient.mockReset();
    getHarnessConfig.mockReset();
    signHarnessBootstrapToken.mockReset();
    createRouteHandlerClient.mockResolvedValue({ auth: { getUser } });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    getHarnessConfig.mockReturnValue({
      publicOrigin: "https://agent.mislw.cn",
      ownerUserId: "owner-1",
      secret: new Uint8Array(32),
    });
    signHarnessBootstrapToken.mockResolvedValue("a+b/c=d?");
  });

  it("returns a bootstrap URL for the authenticated owner", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: `https://agent.mislw.cn/auth/bootstrap?token=${encodeURIComponent(
        "a+b/c=d?",
      )}`,
    });
  });

  it("returns 401 without a Supabase user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for an authenticated non-owner", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "other-user" } } });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 503 when Harness configuration is unavailable", async () => {
    getHarnessConfig.mockImplementation(() => {
      throw new Error("not configured");
    });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(503);
  });
});
