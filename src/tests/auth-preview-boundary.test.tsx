import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const clientMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  isSupabaseBrowserConfigured: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: clientMocks.createClient,
  isSupabaseBrowserConfigured: clientMocks.isSupabaseBrowserConfigured,
}));

import { middleware } from "../../middleware";
import { useAuth } from "@/hooks/use-auth";

describe("preview authentication boundary", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clientMocks.createClient.mockReset();
    clientMocks.isSupabaseBrowserConfigured.mockReset();
    clientMocks.isSupabaseBrowserConfigured.mockReturnValue(false);
  });

  it("redirects an unauthenticated production workspace request even when preview is requested", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    const response = middleware(
      new NextRequest("http://localhost/workspace"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fworkspace",
    );
  });

  it("stays unauthenticated in production when browser Supabase is unavailable", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    const { result } = renderHook(() => useAuth());

    expect(result.current).toEqual({
      user: null,
      loading: false,
      error: "Supabase 尚未配置",
      configured: false,
    });
  });

  it("returns the preview user in development without initializing Supabase", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    clientMocks.isSupabaseBrowserConfigured.mockReturnValue(true);

    const { result } = renderHook(() => useAuth());

    expect(result.current).toMatchObject({
      user: {
        id: "00000000-0000-4000-8000-000000000000",
        email: "preview@example.local",
      },
      loading: false,
      error: null,
      configured: true,
    });
    expect(clientMocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps hook order stable when the preview flag changes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");

    const { result, rerender } = renderHook(() => useAuth());
    expect(result.current.user?.id).toBe(
      "00000000-0000-4000-8000-000000000000",
    );

    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "false");
    rerender();

    await waitFor(() => {
      expect(result.current).toEqual({
        user: null,
        loading: false,
        error: "Supabase 尚未配置",
        configured: false,
      });
    });
  });

  it("clears the preview user when real Supabase initialization fails", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    clientMocks.isSupabaseBrowserConfigured.mockReturnValue(true);
    clientMocks.createClient.mockImplementation(() => {
      throw new Error("Supabase 初始化失败");
    });

    const { result, rerender } = renderHook(() => useAuth());
    expect(result.current.user?.id).toBe(
      "00000000-0000-4000-8000-000000000000",
    );

    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "false");
    rerender();

    await waitFor(() => {
      expect(result.current).toEqual({
        user: null,
        loading: false,
        error: "Supabase 初始化失败",
        configured: true,
      });
    });
    expect(clientMocks.createClient).toHaveBeenCalledOnce();
  });
});
