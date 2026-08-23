// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  createRouteHandlerClient: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: authMocks.createRouteHandlerClient,
}));

vi.mock("next/navigation", () => ({
  redirect: authMocks.redirect,
}));

import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import { requireUser } from "@/lib/supabase/guards";

describe("requireUser preview boundary", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    authMocks.createRouteHandlerClient.mockReset();
    authMocks.getUser.mockReset();
    authMocks.redirect.mockReset();
    authMocks.createRouteHandlerClient.mockResolvedValue({
      auth: { getUser: authMocks.getUser },
    });
    authMocks.getUser.mockResolvedValue({
      data: { user: null },
    });
    authMocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
  });

  it("refuses the shared preview flag in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    expect(isPreviewAuthEnabled()).toBe(false);
  });

  it("allows the shared preview flag only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    expect(isPreviewAuthEnabled()).toBe(true);
  });

  it("uses the real Supabase path in production even when preview is requested", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    await expect(requireUser()).rejects.toThrow("redirect:/login");

    expect(authMocks.createRouteHandlerClient).toHaveBeenCalledOnce();
    expect(authMocks.getUser).toHaveBeenCalledOnce();
    expect(authMocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("returns the preview user in development without creating Supabase", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    await expect(requireUser()).resolves.toEqual({
      user: {
        id: "00000000-0000-4000-8000-000000000000",
        email: "preview@example.local",
      },
      supabase: null,
    });
    expect(authMocks.createRouteHandlerClient).not.toHaveBeenCalled();
    expect(authMocks.redirect).not.toHaveBeenCalled();
  });
});
