// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  AssistantAuthError,
  getAssistantOwner,
  getHarnessConfig,
  signHarnessBootstrapToken,
} = vi.hoisted(() => ({
  AssistantAuthError: class AssistantAuthError extends Error {},
  getAssistantOwner: vi.fn(),
  getHarnessConfig: vi.fn(),
  signHarnessBootstrapToken: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError,
  getAssistantOwner,
}));
vi.mock("@/lib/harness/config", () => ({ getHarnessConfig }));
vi.mock("@/lib/harness/bootstrap-token", () => ({
  signHarnessBootstrapToken,
}));

import { POST } from "@/app/api/harness/bootstrap/route";

describe("POST /api/harness/bootstrap", () => {
  beforeEach(() => {
    getAssistantOwner.mockReset();
    getHarnessConfig.mockReset();
    signHarnessBootstrapToken.mockReset();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
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
    getAssistantOwner.mockRejectedValue(
      Object.assign(new Error("未登录"), {
        status: 401,
        code: "UNAUTHENTICATED",
      }),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for an authenticated non-owner", async () => {
    getAssistantOwner.mockRejectedValue(
      Object.assign(new Error("无权访问 AI 助手"), {
        status: 403,
        code: "FORBIDDEN",
      }),
    );
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
