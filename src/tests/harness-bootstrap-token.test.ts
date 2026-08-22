// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeProtectedHeader, jwtVerify } from "jose";

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
    const protectedHeader = decodeProtectedHeader(token);
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
      {
        audience: "harness-bootstrap",
        currentDate: new Date("2026-08-22T00:00:30.000Z"),
      },
    );
    expect(protectedHeader.alg).toBe("HS256");
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

  it("rejects a non-HTTPS harness origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "http://agent.mislw.cn");
    const { getHarnessConfig } = await import("@/lib/harness/config");
    expect(() => getHarnessConfig()).toThrow(
      "NEXT_PUBLIC_HARNESS_ORIGIN must be an HTTPS origin",
    );
  });

  it("rejects a secret shorter than 32 UTF-8 bytes", async () => {
    vi.stubEnv("HARNESS_EMBED_SECRET", "短密钥短密钥短");
    const { getHarnessConfig } = await import("@/lib/harness/config");
    expect(() => getHarnessConfig()).toThrow(
      "HARNESS_EMBED_SECRET must be at least 32 bytes",
    );
  });

  it("rejects a missing harness owner", async () => {
    vi.stubEnv("HARNESS_OWNER_USER_ID", "");
    const { getHarnessConfig } = await import("@/lib/harness/config");
    expect(() => getHarnessConfig()).toThrow(
      "HARNESS_OWNER_USER_ID is required",
    );
  });
});
