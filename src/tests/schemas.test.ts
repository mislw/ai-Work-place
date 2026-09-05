import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, todoSchema, documentLinkSchema } from "@/lib/schemas";

function extractSqlDefinition(
  sql: string,
  marker: string,
  terminator: string,
): string {
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(terminator, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + terminator.length);
}

describe("auth schemas", () => {
  it("loginSchema 拒绝空密码", () => {
    const r = loginSchema.safeParse({ username: "mislw", password: "" });
    expect(r.success).toBe(false);
  });

  it("loginSchema 通过合法输入", () => {
    const r = loginSchema.safeParse({
      username: "mislw",
      password: "12345678",
    });
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

describe("workspace intake database foundation", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/init.sql"), "utf8");

  it("defines owner-scoped intake tables and browser read policies", () => {
    expect(sql).toContain(
      "create table if not exists public.workspace_intake_batches",
    );
    expect(sql).toContain(
      "create table if not exists public.workspace_intake_items",
    );
    expect(sql).toContain(
      "create table if not exists public.workspace_action_steps",
    );
    expect(sql).toMatch(
      /alter table public\.workspace_intake_batches enable row level security;/,
    );
    expect(sql).toMatch(
      /create policy "workspace_intake_batches_select_own"[\s\S]*?for select using \(auth\.uid\(\) = user_id\);/,
    );
    expect(sql).toMatch(
      /revoke insert, update, delete on table public\.workspace_intake_batches,[\s\S]*?from anon, authenticated;/,
    );
  });

  it("enforces intake owner and hierarchy consistency with composite keys", () => {
    const batchesTable = extractSqlDefinition(
      sql,
      "create table if not exists public.workspace_intake_batches",
      "\n);",
    );
    const itemsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.workspace_intake_items",
      "\n);",
    );
    const stepsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.workspace_action_steps",
      "\n);",
    );

    expect(batchesTable).toContain("unique (id, user_id)");
    expect(itemsTable).toMatch(
      /foreign key \(batch_id, user_id\)[\s\S]*?references public\.workspace_intake_batches \(id, user_id\)/,
    );
    expect(itemsTable).toContain("unique (id, user_id, batch_id)");
    expect(stepsTable).toMatch(
      /foreign key \(item_id, user_id, batch_id\)[\s\S]*?references public\.workspace_intake_items \(id, user_id, batch_id\)/,
    );
  });

  it("enforces intake resource ownership with ordered composite foreign keys", () => {
    const assetsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.file_assets",
      "\n);",
    );
    const documentsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.knowledge_documents",
      "\n);",
    );
    const jobsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.ingestion_jobs",
      "\n);",
    );
    const itemsTable = extractSqlDefinition(
      sql,
      "create table if not exists public.workspace_intake_items",
      "\n);",
    );

    expect(assetsTable).toContain("unique (id, user_id)");
    expect(documentsTable).toContain("unique (id, user_id)");
    expect(jobsTable).toContain("unique (id, user_id)");
    expect(itemsTable).toMatch(
      /foreign key \(asset_id, user_id\)[\s\S]*?references public\.file_assets \(id, user_id\)[\s\S]*?on delete restrict/,
    );
    expect(itemsTable).toMatch(
      /foreign key \(document_id, user_id\)[\s\S]*?references public\.knowledge_documents \(id, user_id\)[\s\S]*?on delete restrict/,
    );
    expect(itemsTable).toMatch(
      /foreign key \(job_id, user_id\)[\s\S]*?references public\.ingestion_jobs \(id, user_id\)[\s\S]*?on delete restrict/,
    );
  });

  it("defines idempotent registration and lease-based claiming RPCs", () => {
    expect(sql).toContain(
      "create or replace function public.register_workspace_intake_batch",
    );
    expect(sql).toContain(
      "create or replace function public.claim_workspace_intake_item",
    );
    const claimFunction = extractSqlDefinition(
      sql,
      "create or replace function public.claim_workspace_intake_item",
      "$$;",
    );

    expect(claimFunction).toMatch(/for update of i skip locked/i);
    expect(claimFunction).toMatch(
      /d\.status in \('ready', 'needs_attention'\)/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.register_workspace_intake_batch[\s\S]*?to service_role;/,
    );
  });

  it("publishes intake receipts through Realtime", () => {
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.workspace_intake_batches;",
    );
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.workspace_intake_items;",
    );
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.workspace_action_steps;",
    );
  });
});
