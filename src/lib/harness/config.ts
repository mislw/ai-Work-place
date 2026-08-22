const MIN_SECRET_BYTES = 32;

export function getHarnessConfig() {
  const publicOrigin = process.env.NEXT_PUBLIC_HARNESS_ORIGIN;
  const rawSecret = process.env.HARNESS_EMBED_SECRET;
  const ownerUserId = process.env.HARNESS_OWNER_USER_ID;
  if (!publicOrigin || new URL(publicOrigin).protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_HARNESS_ORIGIN must be an HTTPS origin");
  }
  if (!rawSecret || new TextEncoder().encode(rawSecret).length < MIN_SECRET_BYTES) {
    throw new Error("HARNESS_EMBED_SECRET must be at least 32 bytes");
  }
  if (!ownerUserId) throw new Error("HARNESS_OWNER_USER_ID is required");
  return {
    publicOrigin: new URL(publicOrigin).origin,
    secret: new TextEncoder().encode(rawSecret),
    ownerUserId,
  };
}
