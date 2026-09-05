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
    expect(claimFunction).toMatch(
      /join public\.workspace_intake_batches b[\s\S]*?b\.id = i\.batch_id[\s\S]*?b\.user_id = i\.user_id/,
    );
    expect(claimFunction).toMatch(
      /b\.status in \('processing', 'orchestrating', 'executing'\)/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.register_workspace_intake_batch[\s\S]*?to service_role;/,
    );
  });

  it("defines atomic owner-scoped retry and cancellation RPCs", () => {
    const retryFunction = extractSqlDefinition(
      sql,
      "create or replace function public.retry_workspace_intake_batch",
      "$$;",
    );
    const cancelFunction = extractSqlDefinition(
      sql,
      "create or replace function public.cancel_workspace_intake_batch",
      "$$;",
    );

    expect(retryFunction).toMatch(
      /from public\.workspace_intake_batches[\s\S]*?id = p_batch_id[\s\S]*?user_id = p_user_id[\s\S]*?status in \('failed', 'partial'\)[\s\S]*?for update/,
    );
    expect(retryFunction).toMatch(
      /update public\.workspace_action_steps[\s\S]*?status = 'pending'[\s\S]*?status = 'failed'/,
    );
    expect(retryFunction).toMatch(
      /update public\.workspace_intake_items[\s\S]*?status = 'awaiting_hermes'[\s\S]*?status in \('failed', 'partial'\)/,
    );
    expect(retryFunction).toMatch(
      /update public\.workspace_intake_batches[\s\S]*?status = 'processing'/,
    );
    expect(retryFunction).not.toMatch(
      /workspace_action_steps[\s\S]*?status = 'completed'[\s\S]*?status = 'pending'/,
    );

    expect(cancelFunction).toMatch(
      /from public\.workspace_intake_batches[\s\S]*?id = p_batch_id[\s\S]*?user_id = p_user_id[\s\S]*?status in \('uploading', 'processing', 'orchestrating', 'executing'\)[\s\S]*?for update/,
    );
    expect(cancelFunction).toMatch(
      /update public\.workspace_intake_items[\s\S]*?status = 'cancelled'[\s\S]*?status in \('waiting_extraction', 'awaiting_hermes', 'orchestrating', 'executing'\)/,
    );
    expect(cancelFunction).toMatch(
      /update public\.workspace_intake_batches[\s\S]*?status = 'cancelled'/,
    );
    expect(cancelFunction).not.toMatch(/file_assets|knowledge_documents/);
  });

  it("defines transaction-scoped lease guards for every step mutation", () => {
    const replaceFunction = extractSqlDefinition(
      sql,
      "create or replace function public.replace_workspace_intake_pending_steps",
      "$$;",
    );
    const completeFunction = extractSqlDefinition(
      sql,
      "create or replace function public.complete_workspace_intake_step",
      "$$;",
    );
    const failFunction = extractSqlDefinition(
      sql,
      "create or replace function public.fail_workspace_intake_step",
      "$$;",
    );

    for (const definition of [
      replaceFunction,
      completeFunction,
      failFunction,
    ]) {
      expect(definition).toMatch(
        /from public\.workspace_intake_items[\s\S]*?id = p_item_id[\s\S]*?user_id = p_user_id[\s\S]*?lease_owner = p_worker_id[\s\S]*?status in \('orchestrating', 'executing'\)[\s\S]*?for update/,
      );
      expect(definition).toContain("raise exception 'INTAKE_LEASE_LOST'");
    }

    const deletePosition = replaceFunction.indexOf(
      "delete from public.workspace_action_steps",
    );
    const insertPosition = replaceFunction.indexOf(
      "insert into public.workspace_action_steps",
    );
    expect(deletePosition).toBeGreaterThanOrEqual(0);
    expect(insertPosition).toBeGreaterThan(deletePosition);
    expect(replaceFunction).toMatch(
      /delete from public\.workspace_action_steps[\s\S]*?user_id = p_user_id[\s\S]*?item_id = p_item_id[\s\S]*?status = 'pending'/,
    );
    expect(replaceFunction).not.toMatch(/exception\s+when/i);

    expect(completeFunction).toMatch(
      /update public\.workspace_action_steps[\s\S]*?id = p_step_id[\s\S]*?user_id = p_user_id[\s\S]*?item_id = p_item_id[\s\S]*?status = 'pending'/,
    );
    expect(failFunction).toMatch(
      /update public\.workspace_action_steps[\s\S]*?id = p_step_id[\s\S]*?user_id = p_user_id[\s\S]*?item_id = p_item_id[\s\S]*?status = 'pending'/,
    );
  });

  it("atomically attaches correction run id and invalid count under owner and lease", () => {
    const correctionFunction = extractSqlDefinition(
      sql,
      "create or replace function public.attach_workspace_intake_correction_run",
      "$$;",
    );

    expect(correctionFunction).toMatch(
      /update public\.workspace_intake_items[\s\S]*?hermes_run_id = p_run_id[\s\S]*?invalid_plan_count = p_invalid_plan_count/,
    );
    expect(correctionFunction).toMatch(
      /where id = p_item_id[\s\S]*?user_id = p_user_id[\s\S]*?lease_owner = p_worker_id[\s\S]*?status in \('orchestrating', 'executing'\)/,
    );
    expect(correctionFunction).toContain(
      "raise exception 'INTAKE_LEASE_LOST'",
    );
    expect(correctionFunction).not.toMatch(/exception\s+when/i);
  });

  it("restricts all intake mutation RPCs to service role", () => {
    for (const signature of [
      "attach_workspace_intake_correction_run(uuid, uuid, text, text, integer)",
      "retry_workspace_intake_batch(uuid, uuid)",
      "cancel_workspace_intake_batch(uuid, uuid)",
      "replace_workspace_intake_pending_steps(uuid, uuid, uuid, text, jsonb)",
      "complete_workspace_intake_step(uuid, uuid, uuid, text, jsonb, text, jsonb, text)",
      "fail_workspace_intake_step(uuid, uuid, uuid, text, text)",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${signature} from public, anon, authenticated`,
      );
      expect(sql).toContain(
        `grant execute on function public.${signature} to service_role`,
      );
    }
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
