import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getHarnessConfig } from "./config";

export async function signHarnessBootstrapToken(
  userId: string,
  now = new Date(),
): Promise<string> {
  const config = getHarnessConfig();
  if (userId !== config.ownerUserId) throw new Error("Harness owner mismatch");
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("harness-bootstrap")
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 60)
    .sign(config.secret);
}
