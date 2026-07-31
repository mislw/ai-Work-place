import { describe, expect, it } from "vitest";
import { logger } from "@/lib/logger";

describe("logger redaction", () => {
  it("不抛出异常并脱敏字段", () => {
    const capture: unknown[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => capture.push(args);
    try {
      logger.info("test", {
        password: "secret",
        ai_api_key: "sk-xxx",
        note: "a".repeat(500),
        user: { id: 1, email: "a@b.com" },
      });
    } finally {
      console.info = original;
    }
    expect(capture.length).toBe(1);
    const first = capture[0] as unknown[];
    const payload = first[1] as Record<string, unknown>;
    expect(payload.password).toBe("[redacted]");
    expect(payload.ai_api_key).toBe("[redacted]");
    expect(typeof payload.note).toBe("string");
    expect((payload.note as string).endsWith("…(truncated)")).toBe(true);
  });
});
