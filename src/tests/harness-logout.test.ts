// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, supabaseSignOut, useAuth, useRouter } = vi.hoisted(
  () => ({
    createClient: vi.fn(),
    supabaseSignOut: vi.fn(),
    useAuth: vi.fn(),
    useRouter: vi.fn(),
  }),
);

vi.mock("@/lib/supabase/client", () => ({ createClient }));
vi.mock("@/hooks/use-auth", () => ({ useAuth }));
vi.mock("next/navigation", () => ({ useRouter }));

describe("Harness logout", () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseSignOut.mockResolvedValue({ error: null });
    createClient.mockReturnValue({ auth: { signOut: supabaseSignOut } });
    useAuth.mockReturnValue({ user: null, loading: false, configured: true });
    useRouter.mockReturnValue({ replace: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts credentials to the agent origin and contains network failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "https://agent.mislw.cn");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    const { clearHarnessSession } = await import(
      "@/lib/harness/clear-session"
    );

    await expect(clearHarnessSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.mislw.cn/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("contains an invalid configured origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "not a url");

    const { clearHarnessSession } = await import(
      "@/lib/harness/clear-session"
    );

    await expect(clearHarnessSession()).resolves.toBeUndefined();
  });

  it("continues to Supabase logout when Harness clearing fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "https://agent.mislw.cn");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    const { signOut } = await import("@/hooks/use-require-auth");

    await expect(signOut()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.mislw.cn/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(supabaseSignOut).toHaveBeenCalledTimes(1);
  });
});
