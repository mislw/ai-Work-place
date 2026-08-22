import { SignJWT, jwtVerify } from "jose";
import type { GatewayConfig } from "./config.js";

export interface BootstrapClaims {
  sub: string;
  jti: string;
}

export class NonceStoreCapacityError extends Error {
  readonly code = "NONCE_STORE_FULL" as const;

  constructor() {
    super("Nonce store capacity reached");
    this.name = "NonceStoreCapacityError";
  }
}

class TokenReplayError extends Error {
  readonly code = "TOKEN_REPLAYED" as const;

  constructor() {
    super("Bootstrap token has already been used");
    this.name = "TokenReplayError";
  }
}

export class NonceStore {
  readonly #entries = new Map<string, number>();
  readonly #maxEntries: number;

  constructor(maxEntries = 10_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.#maxEntries = maxEntries;
  }

  consume(
    jti: string,
    expiresAtSeconds: number,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): boolean {
    for (const [storedJti, storedExpiry] of this.#entries) {
      if (storedExpiry <= nowSeconds) this.#entries.delete(storedJti);
    }

    if (this.#entries.has(jti)) return false;
    if (this.#entries.size >= this.#maxEntries) {
      throw new NonceStoreCapacityError();
    }
    this.#entries.set(jti, expiresAtSeconds);
    return true;
  }
}

export async function verifyBootstrapToken(
  token: string,
  config: GatewayConfig,
  nonces: NonceStore,
  now = new Date(),
): Promise<BootstrapClaims> {
  const { payload } = await jwtVerify(token, config.secret, {
    algorithms: ["HS256"],
    audience: "harness-bootstrap",
    currentDate: now,
  });

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    typeof payload.jti !== "string" ||
    payload.jti.length === 0 ||
    typeof payload.exp !== "number" ||
    payload.sub !== config.ownerUserId
  ) {
    throw new Error("Invalid bootstrap token claims");
  }

  if (!nonces.consume(payload.jti, payload.exp, Math.floor(now.getTime() / 1000))) {
    throw new TokenReplayError();
  }

  return { sub: payload.sub, jti: payload.jti };
}

export async function signSessionToken(
  userId: string,
  config: GatewayConfig,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("harness-session")
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 600)
    .sign(config.secret);
}

export async function verifySessionToken(
  token: string,
  config: GatewayConfig,
  now = new Date(),
): Promise<{ sub: string; exp: number }> {
  const { payload } = await jwtVerify(token, config.secret, {
    algorithms: ["HS256"],
    audience: "harness-session",
    currentDate: now,
  });

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid session token claims");
  }

  return { sub: payload.sub, exp: payload.exp };
}
