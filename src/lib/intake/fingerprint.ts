import { createHash } from "node:crypto";

const VOLATILE_FIELDS = new Set([
  "updated_at",
  "last_edited_at",
  "completed_at",
]);

export function fingerprintRecord(value: unknown): string {
  const canonical = JSON.stringify(normalizeFingerprintValue(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function normalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !VOLATILE_FIELDS.has(key))
      .sort()
      .map((key) => [key, normalizeFingerprintValue(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
