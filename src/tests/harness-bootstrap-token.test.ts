// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";

describe("Harness bootstrap token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HARNESS_EMBED_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("HARNESS_OWNER_USER_ID", "owner-1");
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "https://agent.mislw.cn");
  });

  it("mints a one-minute owner-scoped token", async () => {
    const { signHarnessBootstrapToken } = await import(
      "@/lib/harness/bootstrap-token"
    );
    const token = await signHarnessBootstrapToken(
      "owner-1",
      new Date("2026-08-22T00:00:00.000Z"),
    );
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
      {
        audience: "harness-bootstrap",
        currentDate: new Date("2026-08-22T00:00:30.000Z"),
      },
    );
    expect(verified.payload.sub).toBe("owner-1");
    expect(verified.payload.exp! - verified.payload.iat!).toBe(60);
    expect(verified.payload.jti).toEqual(expect.any(String));
  });

  it("rejects a non-owner user", async () => {
    const { signHarnessBootstrapToken } = await import(
      "@/lib/harness/bootstrap-token"
    );
    await expect(signHarnessBootstrapToken("other-user")).rejects.toThrow(
      "Harness owner mismatch",
    );
  });
});
