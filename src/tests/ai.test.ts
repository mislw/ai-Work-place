import { describe, expect, it, beforeEach } from "vitest";
import { isAIConfigured, readAIConfig } from "@/lib/ai/provider";

describe("AI provider config", () => {
  beforeEach(() => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.AI_TIMEOUT_MS;
  });

  it("未配置时 isAIConfigured=false", () => {
    expect(isAIConfigured()).toBe(false);
    expect(readAIConfig()).toBeNull();
  });

  it("配置三项后 isAIConfigured=true", () => {
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-4o-mini";
    expect(isAIConfigured()).toBe(true);
    const cfg = readAIConfig();
    expect(cfg?.timeoutMs).toBe(20000); // 默认
  });
});
