import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, todoSchema, documentLinkSchema } from "@/lib/schemas";

describe("auth schemas", () => {
  it("loginSchema 拒绝空密码", () => {
    const r = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(r.success).toBe(false);
  });

  it("loginSchema 通过合法输入", () => {
    const r = loginSchema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(r.success).toBe(true);
  });

  it("registerSchema 拒绝两次密码不一致", () => {
    const r = registerSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      confirmPassword: "11111111",
      displayName: "YUAN",
    });
    expect(r.success).toBe(false);
  });

  it("registerSchema 通过合法输入", () => {
    const r = registerSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      confirmPassword: "12345678",
      displayName: "YUAN",
    });
    expect(r.success).toBe(true);
  });
});

describe("todoSchema", () => {
  it("拒绝空标题", () => {
    const r = todoSchema.safeParse({ title: "", priority: "medium" });
    expect(r.success).toBe(false);
  });

  it("默认 priority=medium", () => {
    const r = todoSchema.safeParse({ title: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.priority).toBe("medium");
  });

  it("拒绝非法日期", () => {
    const r = todoSchema.safeParse({
      title: "x",
      due_date: "2026/07/31",
    });
    expect(r.success).toBe(false);
  });
});

describe("documentLinkSchema", () => {
  it("允许 docs.qq.com", () => {
    const r = documentLinkSchema.safeParse({
      title: "PRD",
      document_url: "https://docs.qq.com/doc/D123",
    });
    expect(r.success).toBe(true);
  });

  it("拒绝非腾讯域名", () => {
    const r = documentLinkSchema.safeParse({
      title: "x",
      document_url: "https://example.com/doc",
    });
    expect(r.success).toBe(false);
  });
});
