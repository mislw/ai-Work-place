import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";
import type { GatewayConfig } from "../src/config.js";
import {
  NonceStore,
  NonceStoreCapacityError,
  signSessionToken,
  verifyBootstrapToken,
  verifySessionToken,
} from "../src/tokens.js";

const secret = new TextEncoder().encode(
  "0123456789abcdef0123456789abcdef",
);

const config: GatewayConfig = {
  harnessUpstream: "http://127.0.0.1:3000",
  ownerUserId: "owner-1",
  port: 8787,
  secret,
};

async function signBootstrapToken({
  audience = "harness-bootstrap",
  expiresAt = 1_800,
  jti = "nonce-1",
  subject = "owner-1",
}: {
  audience?: string;
  expiresAt?: number;
  jti?: string;
  subject?: string;
} = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience(audience)
    .setSubject(subject)
    .setJti(jti)
    .setIssuedAt(1_700)
    .setExpirationTime(expiresAt)
    .sign(secret);
}

describe("bootstrap token verification", () => {
  it("accepts an owner bootstrap token once and rejects replay", async () => {
    const nonces = new NonceStore();
    const token = await signBootstrapToken();
    const now = new Date(1_750_000);

    assert.deepEqual(
      await verifyBootstrapToken(token, config, nonces, now),
      { sub: "owner-1", jti: "nonce-1" },
    );
    await assert.rejects(
      verifyBootstrapToken(token, config, nonces, now),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "TOKEN_REPLAYED",
    );
  });

  it("rejects wrong audience, wrong owner, and expired tokens", async () => {
    const now = new Date(1_750_000);

    await assert.rejects(
      verifyBootstrapToken(
        await signBootstrapToken({ audience: "wrong-audience" }),
        config,
        new NonceStore(),
        now,
      ),
    );
    await assert.rejects(
      verifyBootstrapToken(
        await signBootstrapToken({ subject: "other-user" }),
        config,
        new NonceStore(),
        now,
      ),
    );
    await assert.rejects(
      verifyBootstrapToken(
        await signBootstrapToken({ expiresAt: 1_749 }),
        config,
        new NonceStore(),
        now,
      ),
    );
  });
});

describe("session tokens", () => {
  it("signs a harness-session token that expires after 600 seconds", async () => {
    const issuedAt = new Date("2026-08-22T00:00:00.000Z");
    const token = await signSessionToken("owner-1", config, issuedAt);
    const session = await verifySessionToken(
      token,
      config,
      new Date("2026-08-22T00:09:59.000Z"),
    );

    assert.equal(session.sub, "owner-1");
    assert.equal(session.exp, Math.floor(issuedAt.getTime() / 1000) + 600);
    await assert.rejects(
      verifySessionToken(
        token,
        config,
        new Date("2026-08-22T00:10:00.000Z"),
      ),
    );
  });
});

describe("NonceStore", () => {
  it("lazily removes expired entries before checking capacity", () => {
    const nonces = new NonceStore(2);
    assert.equal(nonces.consume("expired", 100, 50), true);
    assert.equal(nonces.consume("live", 300, 50), true);

    assert.equal(nonces.consume("replacement", 400, 100), true);
    assert.equal(nonces.consume("live", 500, 100), false);
  });

  it("rejects a new nonce at 10,000 live entries without growing", () => {
    const nonces = new NonceStore();
    for (let index = 0; index < 10_000; index += 1) {
      assert.equal(nonces.consume(`nonce-${index}`, 2_000, 1_000), true);
    }

    assert.throws(
      () => nonces.consume("overflow", 2_000, 1_000),
      (error: unknown) =>
        error instanceof NonceStoreCapacityError &&
        error.code === "NONCE_STORE_FULL",
    );
    assert.equal(nonces.consume("nonce-9999", 2_000, 1_000), false);
  });
});
