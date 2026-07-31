import { describe, expect, it } from "vitest";
import { NoopTencentDocsProvider } from "@/lib/tencent-docs/noop";
import { isTencentDocsConfigured, readTencentConfig } from "@/lib/tencent-docs/provider";

describe("Tencent Docs provider", () => {
  it("Noop 实现的 isConfigured=false", () => {
    const p = new NoopTencentDocsProvider();
    expect(p.isConfigured).toBe(false);
  });

  it("Noop createDocument 抛出未配置错误", async () => {
    const p = new NoopTencentDocsProvider();
    await expect(
      p.createDocument({ title: "x", content: "" }),
    ).rejects.toThrowError("TENCENT_DOCS_NOT_CONFIGURED");
  });

  it("未设置环境变量时 readTencentConfig 返回 null", () => {
    delete process.env.TENCENT_DOCS_BASE_URL;
    delete process.env.TENCENT_DOCS_ACCESS_TOKEN;
    delete process.env.TENCENT_DOCS_CLIENT_ID;
    delete process.env.TENCENT_DOCS_CLIENT_SECRET;
    expect(readTencentConfig()).toBeNull();
    expect(isTencentDocsConfigured()).toBe(false);
  });
});
