import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalToolboxHealth,
  getLocalToolboxOrigin,
} from "@/lib/local-toolbox/client";

declare global {
  interface Window {
    __PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__?: string;
  }
}

describe("desktop local toolbox origin", () => {
  afterEach(() => {
    delete window.__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__;
  });

  it("uses the desktop-provided loopback origin when present", () => {
    window.__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__ =
      "http://127.0.0.1:49152";

    expect(getLocalToolboxOrigin()).toBe("http://127.0.0.1:49152");
  });

  it("checks health against the desktop-provided origin", async () => {
    window.__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__ =
      "http://127.0.0.1:49152";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          version: 1,
          winRarAvailable: true,
          sevenZipAvailable: true,
        }),
        { status: 200 },
      ),
    );

    await getLocalToolboxHealth();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:49152/health",
      expect.any(Object),
    );
    fetchMock.mockRestore();
  });
});
