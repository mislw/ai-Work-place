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

  it("atomically derives terminal batch status from item decisions", () => {
    const decisionFunction = extractSqlDefinition(
      sql,
      "create or replace function public.set_workspace_intake_item_decision",
      "$$;",
    );

    expect(decisionFunction).toMatch(
      /from public\.workspace_intake_items[\s\S]*?id = p_item_id[\s\S]*?user_id = p_user_id[\s\S]*?lease_owner = p_worker_id[\s\S]*?status in \('orchestrating', 'executing'\)[\s\S]*?for update/,
    );
    expect(decisionFunction).toMatch(
      /update public\.workspace_intake_items[\s\S]*?status = p_status[\s\S]*?where id = p_item_id[\s\S]*?user_id = p_user_id/,
    );
    expect(decisionFunction).toMatch(
      /status in \(\s*'waiting_extraction',\s*'awaiting_hermes',\s*'orchestrating',\s*'executing'\s*\)/,
    );
    expect(decisionFunction).toMatch(
      /when v_completed_count = v_item_count then 'completed'/,
    );
    expect(decisionFunction).toMatch(
      /when v_failed_count = v_item_count then 'failed'/,
    );
    expect(decisionFunction).toMatch(/else 'partial'/);
    expect(decisionFunction).toMatch(
      /update public\.workspace_intake_batches[\s\S]*?status = v_batch_status[\s\S]*?completed_at = now\(\)[\s\S]*?id = v_batch_id[\s\S]*?user_id = p_user_id[\s\S]*?status in \('processing', 'orchestrating', 'executing'\)/,
    );
    expect(decisionFunction).not.toMatch(
      /status in \('cancelled', 'undoing', 'undone'\)/,
    );
  });

  it("locks the active batch before the leased item when applying a decision", () => {
    const decisionFunction = extractSqlDefinition(
      sql,
      "create or replace function public.set_workspace_intake_item_decision",
      "$$;",
    );
    const batchIdLookup = decisionFunction.indexOf(
      "select batch_id into v_batch_id",
    );
    const batchLock = decisionFunction.indexOf(
      "from public.workspace_intake_batches",
      batchIdLookup,
    );
    const itemLock = decisionFunction.indexOf(
      "from public.workspace_intake_items",
      batchLock,
    );
    const itemUpdate = decisionFunction.indexOf(
      "update public.workspace_intake_items",
      itemLock,
    );

    expect(batchIdLookup).toBeGreaterThanOrEqual(0);
    expect(batchLock).toBeGreaterThan(batchIdLookup);
    expect(itemLock).toBeGreaterThan(batchLock);
    expect(itemUpdate).toBeGreaterThan(itemLock);
    expect(decisionFunction).toMatch(
      /perform 1[\s\S]*?from public\.workspace_intake_batches[\s\S]*?id = v_batch_id[\s\S]*?user_id = p_user_id[\s\S]*?status in \('processing', 'orchestrating', 'executing'\)[\s\S]*?for update/,
    );
    expect(decisionFunction).toMatch(
      /perform 1[\s\S]*?from public\.workspace_intake_items[\s\S]*?id = p_item_id[\s\S]*?user_id = p_user_id[\s\S]*?batch_id = v_batch_id[\s\S]*?lease_owner = p_worker_id[\s\S]*?status in \('orchestrating', 'executing'\)[\s\S]*?for update/,
    );
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
      /delete from public\.workspace_action_steps[\s\S]*?user_id = p_user_id[\s\S]*?item_id = p_item_id[\s\S]*?status in \('pending', 'failed'\)/,
    );
    expect(replaceFunction).not.toMatch(
      /delete from public\.workspace_action_steps[\s\S]*?status(?:\s*=|\s+in)[^;]*completed/,
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

  it("atomically compares and undoes owner-scoped record, archive, and relation steps", () => {
    const recordUndo = extractSqlDefinition(
      sql,
      "create or replace function public.undo_workspace_intake_record_step",
      "$$;",
    );
    const archiveUndo = extractSqlDefinition(
      sql,
      "create or replace function public.undo_workspace_intake_archive_step",
      "$$;",
    );
    const relationUndo = extractSqlDefinition(
      sql,
      "create or replace function public.undo_workspace_intake_relation_step",
      "$$;",
    );
    const replayedRelationUndo = extractSqlDefinition(
      sql,
      "create or replace function public.undo_workspace_intake_replayed_relation_step",
      "$$;",
    );

    for (const definition of [recordUndo, archiveUndo, relationUndo]) {
      expect(definition).toMatch(
        /from public\.workspace_action_steps[\s\S]*?id = p_step_id[\s\S]*?user_id = p_user_id[\s\S]*?batch_id = p_batch_id[\s\S]*?item_id = p_item_id[\s\S]*?for update/,
      );
      expect(definition).toContain("p_expected_snapshot");
      expect(definition).toContain("p_expected_fingerprint");
      expect(definition).toMatch(
        /v_step\.conflict_fingerprint\s+is distinct from p_expected_fingerprint/,
      );
      expect(definition).toContain("status = 'undo_conflict'");
      expect(definition).toContain("error_code = 'UNDO_RECORD_CHANGED'");
      expect(definition).toContain("status = 'undone'");
      expect(definition).toContain("return 'already_missing'");
      expect(definition).toContain("return 'conflict'");
      expect(definition).toContain("return 'undone'");
      expect(definition).toContain(
        "jsonb_typeof(p_expected_snapshot) is distinct from 'object'",
      );
    }

    expect(recordUndo).toContain(
      "v_step.action_name is distinct from v_expected_action",
    );
    expect(recordUndo).toContain(
      "v_step.inverse_action is distinct from 'record.delete'",
    );
    expect(recordUndo).toContain(
      "v_step.inverse_input ->> 'table' is distinct from p_table_name",
    );
    expect(recordUndo).toContain(
      "v_step.inverse_input ->> 'id' is distinct from p_record_id::text",
    );
    expect(recordUndo).toContain(
      "v_step.forward_result ->> 'id' is distinct from p_record_id::text",
    );
    expect(recordUndo).toMatch(
      /p_table_name not in \('notes', 'todos', 'calendar_events'\)/,
    );
    expect(recordUndo).toMatch(
      /where id = p_record_id[\s\S]*?user_id = p_user_id[\s\S]*?for update/,
    );
    expect(recordUndo).toContain("p_expected_snapshot");
    expect(recordUndo).toMatch(
      /delete from public\.(notes|todos|calendar_events)/,
    );
    expect(recordUndo).toContain(
      "public.normalize_intake_conflict_snapshot(to_jsonb(",
    );

    expect(archiveUndo).toContain(
      "v_step.action_name is distinct from 'archive'",
    );
    expect(archiveUndo).toContain(
      "v_step.inverse_action is distinct from 'archive.restore'",
    );
    expect(archiveUndo).toContain(
      "not (v_step.inverse_input ? 'previousCollectionId')",
    );
    expect(archiveUndo).toContain(
      "v_step.forward_result -> 'postActionSnapshot' ->> 'id'",
    );
    expect(archiveUndo).toMatch(
      /jsonb_typeof\(\s*v_step\.forward_result -> 'postActionSnapshot' -> 'id'\s*\)\s+is distinct from 'string'/,
    );
    expect(archiveUndo).toMatch(
      /jsonb_typeof\(\s*v_step\.forward_result -> 'postActionSnapshot' -> 'collection_id'\s*\)\s+is distinct from 'string'/,
    );
    expect(archiveUndo).toMatch(
      /v_step\.forward_result -> 'postActionSnapshot' ->> 'collection_id'\s+is distinct from v_step\.forward_result ->> 'collectionId'/,
    );
    expect(archiveUndo).toMatch(
      /from public\.knowledge_documents[\s\S]*?id = p_document_id[\s\S]*?user_id = p_user_id[\s\S]*?for update/,
    );
    expect(archiveUndo).toMatch(
      /update public\.knowledge_documents[\s\S]*?collection_id = p_previous_collection_id[\s\S]*?id = p_document_id[\s\S]*?user_id = p_user_id/,
    );

    expect(relationUndo).toContain(
      "v_step.inverse_action is distinct from 'relation.delete'",
    );
    expect(relationUndo).toMatch(
      /v_step\.action_name not in \(\s*'relation\.create:note',\s*'relation\.create:todo',\s*'relation\.create:calendar'\s*\)/,
    );
    expect(relationUndo).toMatch(
      /v_step\.inverse_input ->> 'id'\s+is distinct from p_relation_id::text/,
    );
    expect(relationUndo).toContain(
      "v_step.forward_result ->> 'replayed' is distinct from 'false'",
    );
    expect(relationUndo).toMatch(
      /from public\.knowledge_relations[\s\S]*?id = p_relation_id[\s\S]*?user_id = p_user_id[\s\S]*?for update/,
    );
    expect(relationUndo).toMatch(
      /delete from public\.knowledge_relations[\s\S]*?id = p_relation_id[\s\S]*?user_id = p_user_id/,
    );
    for (const definition of [relationUndo, replayedRelationUndo]) {
      expect(definition).toContain(
        "jsonb_typeof(v_step.forward_result -> 'postActionSnapshot')",
      );
      for (const field of [
        "id",
        "source_type",
        "source_id",
        "target_type",
        "target_id",
        "relation_type",
        "creator",
      ]) {
        expect(definition).toMatch(
          new RegExp(
            `jsonb_typeof\\(\\s*v_step\\.forward_result -> 'postActionSnapshot' -> '${field}'\\s*\\)\\s+is distinct from 'string'`,
          ),
        );
      }
      expect(definition).toMatch(
        /v_step\.forward_result -> 'postActionSnapshot' ->> 'source_type'\s+is distinct from 'knowledge_document'/,
      );
      expect(definition).toMatch(
        /v_step\.forward_result -> 'postActionSnapshot' ->> 'relation_type'\s+is distinct from 'source_of'/,
      );
      expect(definition).toMatch(
        /from public\.workspace_intake_items[\s\S]*?id = p_item_id[\s\S]*?user_id = p_user_id[\s\S]*?batch_id = p_batch_id[\s\S]*?document_id::text\s*=\s*v_step\.forward_result -> 'postActionSnapshot' ->> 'source_id'[\s\S]*?for update/,
      );
    }
    expect(relationUndo).toMatch(
      /jsonb_typeof\(\s*v_step\.forward_result -> 'postActionSnapshot' -> 'confidence'\s*\)\s+is distinct from 'number'/,
    );
    expect(relationUndo).toMatch(
      /v_step\.forward_result -> 'postActionSnapshot' ->> 'creator'\s+is distinct from 'assistant'/,
    );
    expect(relationUndo).toMatch(
      /v_step\.forward_result -> 'postActionSnapshot' -> 'confidence'\s+is distinct from to_jsonb\(v_step\.confidence\)/,
    );
    expect(replayedRelationUndo).toMatch(
      /v_step\.forward_result -> 'postActionSnapshot' ->> 'creator'\s+not in \('user', 'assistant', 'importer'\)/,
    );
    expect(replayedRelationUndo).toMatch(
      /not \(v_step\.forward_result -> 'postActionSnapshot' \? 'confidence'\)/,
    );
    expect(replayedRelationUndo).toMatch(
      /jsonb_typeof\(\s*v_step\.forward_result -> 'postActionSnapshot' -> 'confidence'\s*\)\s+not in \('number', 'null'\)/,
    );
    expect(replayedRelationUndo).toMatch(
      /jsonb_typeof\(\s*v_step\.forward_result -> 'postActionSnapshot' -> 'confidence'\s*\) = 'number'[\s\S]*?postActionSnapshot' -> 'confidence'[\s\S]*?< '0'::jsonb[\s\S]*?postActionSnapshot' -> 'confidence'[\s\S]*?> '1'::jsonb/,
    );
    expect(replayedRelationUndo).not.toContain("to_jsonb(v_step.confidence)");
    expect(replayedRelationUndo).toMatch(
      /from public\.workspace_action_steps[\s\S]*?id = p_step_id[\s\S]*?user_id = p_user_id[\s\S]*?batch_id = p_batch_id[\s\S]*?item_id = p_item_id[\s\S]*?for update/,
    );
    expect(replayedRelationUndo).toMatch(
      /action_name not in \(\s*'relation\.create:note',\s*'relation\.create:todo',\s*'relation\.create:calendar'\s*\)[\s\S]*?inverse_action is not null[\s\S]*?inverse_input is not null[\s\S]*?forward_result ->> 'replayed' is distinct from 'true'/,
    );
    expect(replayedRelationUndo).toMatch(
      /v_step\.forward_result ->> 'id'\s+is distinct from p_relation_id::text/,
    );
    expect(replayedRelationUndo).toContain("p_relation_id");
    expect(replayedRelationUndo).toContain("p_expected_snapshot");
    expect(replayedRelationUndo).toContain("p_expected_fingerprint");
    expect(replayedRelationUndo).toMatch(
      /v_step\.conflict_fingerprint\s+is distinct from p_expected_fingerprint/,
    );
    expect(replayedRelationUndo).toContain(
      "v_step.forward_result -> 'postActionSnapshot' ->> 'id'",
    );
    expect(replayedRelationUndo).toContain("status = 'undone'");
  });

  it("recursively removes volatile fields from atomic undo snapshots", () => {
    const normalizeSnapshot = extractSqlDefinition(
      sql,
      "create or replace function public.normalize_intake_conflict_snapshot",
      "$$;",
    );

    expect(normalizeSnapshot).toContain("jsonb_each(p_value)");
    expect(normalizeSnapshot).toContain("jsonb_array_elements(p_value)");
    expect(normalizeSnapshot).toContain(
      "key not in ('updated_at', 'last_edited_at', 'completed_at')",
    );
    expect(normalizeSnapshot).toContain(
      "public.normalize_intake_conflict_snapshot(value)",
    );
  });

  it("restricts all intake mutation RPCs to service role", () => {
    for (const signature of [
      "attach_workspace_intake_correction_run(uuid, uuid, text, text, integer)",
      "set_workspace_intake_item_decision(uuid, uuid, text, text, double precision, text, integer, text)",
      "retry_workspace_intake_batch(uuid, uuid)",
      "cancel_workspace_intake_batch(uuid, uuid)",
      "replace_workspace_intake_pending_steps(uuid, uuid, uuid, text, jsonb)",
      "complete_workspace_intake_step(uuid, uuid, uuid, text, jsonb, text, jsonb, text)",
      "fail_workspace_intake_step(uuid, uuid, uuid, text, text)",
      "undo_workspace_intake_record_step(uuid, uuid, uuid, uuid, text, uuid, jsonb, text)",
      "undo_workspace_intake_archive_step(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text)",
      "undo_workspace_intake_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text)",
      "undo_workspace_intake_replayed_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text)",
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
