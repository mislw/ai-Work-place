import { createHash } from "node:crypto";

export function fingerprintRecord(value: unknown): string {
  const canonical = JSON.stringify(sortJsonValue(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
