/**
 * 轻量脱敏日志。
 * - 禁止打印 password、token、apikey、笔记全文。
 * - 服务端 / 客户端均可调用。
 */

const REDACT_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "apikey",
  "api_key",
  "ai_api_key",
  "tencent",
  "authorization",
  "cookie",
  "set-cookie",
] as const;

const MAX_LENGTH = 200;

function redactString(input: string): string {
  if (input.length > MAX_LENGTH) {
    return input.slice(0, MAX_LENGTH) + "…(truncated)";
  }
  return input;
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (REDACT_KEYS.some((r) => lower.includes(r))) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export const logger = {
  info(scope: string, data: Record<string, unknown> = {}): void {
    if (typeof console !== "undefined") {
      console.info(`[${scope}]`, redactValue(data));
    }
  },
  warn(scope: string, data: Record<string, unknown> = {}): void {
    if (typeof console !== "undefined") {
      console.warn(`[${scope}]`, redactValue(data));
    }
  },
  error(scope: string, data: Record<string, unknown> = {}): void {
    if (typeof console !== "undefined") {
      console.error(`[${scope}]`, redactValue(data));
    }
  },
};

export type Logger = typeof logger;
