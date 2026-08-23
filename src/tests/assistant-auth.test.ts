// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isPreviewAuthEnabled, getHarnessConfig, createRouteHandlerClient, getUser } =
  vi.hoisted(() => ({
    isPreviewAuthEnabled: vi.fn(),
    getHarnessConfig: vi.fn(),
    createRouteHandlerClient: vi.fn(),
    getUser: vi.fn(),
  }));

vi.mock("@/lib/auth/preview", () => ({ isPreviewAuthEnabled }));
vi.mock("@/lib/harness/config", () => ({ getHarnessConfig }));
vi.mock("@/lib/supabase/server", () => ({ createRouteHandlerClient }));

import { getAssistantOwner } from "@/lib/assistant/auth";

describe("assistant owner authentication", () => {
  beforeEach(() => {
    isPreviewAuthEnabled.mockReset();
    getHarnessConfig.mockReset();
    createRouteHandlerClient.mockReset();
    getUser.mockReset();
    getHarnessConfig.mockReturnValue({ ownerUserId: "owner-1" });
    createRouteHandlerClient.mockResolvedValue({ auth: { getUser } });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  });

  it("maps the development preview identity to the configured Harness owner", async () => {
    isPreviewAuthEnabled.mockReturnValue(true);

    await expect(getAssistantOwner()).resolves.toEqual({ id: "owner-1" });
    expect(createRouteHandlerClient).not.toHaveBeenCalled();
  });

  it("uses the real Supabase user when preview mode is disabled", async () => {
    isPreviewAuthEnabled.mockReturnValue(false);

    await expect(getAssistantOwner()).resolves.toEqual({ id: "owner-1" });
    expect(getUser).toHaveBeenCalledOnce();
  });
});
