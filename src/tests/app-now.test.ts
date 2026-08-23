import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppNow } from "@/lib/app-now";

describe("getAppNow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the explicit clock only for local auth preview", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_NOW", "2026-08-22T09:30:00+08:00");

    const now = getAppNow();

    expect(now.getFullYear()).toBe(2026);
    expect(now.getMonth()).toBe(7);
    expect(now.getDate()).toBe(22);
  });
});
