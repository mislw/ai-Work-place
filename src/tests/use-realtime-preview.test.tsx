import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCollectionRealtime } from "@/hooks/use-realtime";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(() => {
    throw new Error("Supabase should not initialize in preview mode");
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient,
  isSupabaseBrowserConfigured: () => false,
}));

describe("useCollectionRealtime in local preview", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    createClient.mockClear();
  });

  it("does not initialize Supabase when the preview has no backend", () => {
    expect(() =>
      renderHook(() =>
        useCollectionRealtime({
          table: "notes",
          onChange: () => undefined,
        }),
      ),
    ).not.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});
