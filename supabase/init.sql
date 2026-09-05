-- =========================================================
-- Personal AI Workspace · Supabase PostgreSQL Init
-- =========================================================
-- 运行方式：Supabase SQL Editor → 粘贴执行。
-- 设计原则：
--   * 全表启用 RLS，所有策略强制 user_id = auth.uid()
--   * 使用 UUID 主键，updated_at 自动维护
--   * 不在前端使用 service_role；service_role 仅在服务端日志写入等场景使用
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- updated_at 自动维护 ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- 1. profiles：用户资料（与 auth.users 一对一）
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_updated_at_idx on public.profiles (updated_at desc);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

-- =========================================================
-- 2. user_settings：偏好（主题等）
-- =========================================================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

create policy "user_settings_all_own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- 3. todos
-- =========================================================
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  due_time time,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_user_idx on public.todos (user_id);
create index if not exists todos_due_idx on public.todos (user_id, due_date);
create index if not exists todos_status_idx on public.todos (user_id, status);
create index if not exists todos_updated_idx on public.todos (user_id, updated_at desc);

drop trigger if exists trg_todos_updated_at on public.todos;
create trigger trg_todos_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

alter table public.todos enable row level security;

create policy "todos_select_own" on public.todos
  for select using (auth.uid() = user_id);
create policy "todos_insert_own" on public.todos
  for insert with check (auth.uid() = user_id);
create policy "todos_update_own" on public.todos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "todos_delete_own" on public.todos
  for delete using (auth.uid() = user_id);

-- =========================================================
-- 4. calendar_events
-- =========================================================
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  event_date date not null,
  start_time time,
  end_time time,
  is_all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_time_order
    check (start_time is null or end_time is null or start_time <= end_time)
);

create index if not exists events_user_idx on public.calendar_events (user_id);
create index if not exists events_date_idx on public.calendar_events (user_id, event_date);
create index if not exists events_updated_idx on public.calendar_events (user_id, updated_at desc);

drop trigger if exists trg_events_updated_at on public.calendar_events;
create trigger trg_events_updated_at
before update on public.calendar_events
for each row execute function public.set_updated_at();

alter table public.calendar_events enable row level security;

create policy "events_select_own" on public.calendar_events
  for select using (auth.uid() = user_id);
create policy "events_insert_own" on public.calendar_events
  for insert with check (auth.uid() = user_id);
create policy "events_update_own" on public.calendar_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "events_delete_own" on public.calendar_events
  for delete using (auth.uid() = user_id);

-- =========================================================
-- 5. notes（含冲突检测用 version 字段）
-- =========================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content text not null default '',
  summary text,
  tags text[] not null default '{}',
  is_pinned boolean not null default false,
  version integer not null default 1,
  last_edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_idx on public.notes (user_id);
create index if not exists notes_pinned_idx on public.notes (user_id, is_pinned);
create index if not exists notes_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_tags_idx on public.notes using gin (tags);
create index if not exists notes_search_idx on public.notes using gin (
  to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
);

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

create policy "notes_select_own" on public.notes
  for select using (auth.uid() = user_id);
create policy "notes_insert_own" on public.notes
  for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_delete_own" on public.notes
  for delete using (auth.uid() = user_id);

-- =========================================================
-- 6. document_links
-- =========================================================
create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  document_url text not null,
  note text,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists docs_user_idx on public.document_links (user_id);
create index if not exists docs_recent_idx on public.document_links (user_id, last_opened_at desc nulls last);
create index if not exists docs_updated_idx on public.document_links (user_id, updated_at desc);

drop trigger if exists trg_docs_updated_at on public.document_links;
create trigger trg_docs_updated_at
before update on public.document_links
for each row execute function public.set_updated_at();

alter table public.document_links enable row level security;

create policy "docs_select_own" on public.document_links
  for select using (auth.uid() = user_id);
create policy "docs_insert_own" on public.document_links
  for insert with check (auth.uid() = user_id);
create policy "docs_update_own" on public.document_links
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "docs_delete_own" on public.document_links
  for delete using (auth.uid() = user_id);

-- =========================================================
-- 7. ai_action_logs：只保存元数据，不保存 AI 对话全文
-- =========================================================
create table if not exists public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null,
  model text not null,
  success boolean not null,
  prompt_tokens integer,
  completion_tokens integer,
  duration_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists ai_logs_user_idx on public.ai_action_logs (user_id);
create index if not exists ai_logs_created_idx on public.ai_action_logs (user_id, created_at desc);

alter table public.ai_action_logs enable row level security;

create policy "ai_logs_select_own" on public.ai_action_logs
  for select using (auth.uid() = user_id);
create policy "ai_logs_insert_own" on public.ai_action_logs
  for insert with check (auth.uid() = user_id);
-- 不允许前端 update/delete，避免污染审计日志

-- =========================================================
-- 7.1 assistant_action_receipts：创建类 Tool 的幂等收据
-- =========================================================
create table if not exists public.assistant_action_receipts (
  request_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action_name text not null,
  status text not null check (status in ('processing', 'completed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_action_receipts_user_idx
  on public.assistant_action_receipts (user_id, created_at desc);

drop trigger if exists trg_assistant_action_receipts_updated_at
  on public.assistant_action_receipts;
create trigger trg_assistant_action_receipts_updated_at
before update on public.assistant_action_receipts
for each row execute function public.set_updated_at();

alter table public.assistant_action_receipts enable row level security;

create policy "assistant_receipts_select_own" on public.assistant_action_receipts
  for select using (auth.uid() = user_id);
create policy "assistant_receipts_insert_own" on public.assistant_action_receipts
  for insert with check (auth.uid() = user_id);
create policy "assistant_receipts_update_own" on public.assistant_action_receipts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "assistant_receipts_delete_own" on public.assistant_action_receipts
  for delete using (auth.uid() = user_id);

-- =========================================================
-- 7.2 knowledge base：文件、版本、分块、建议、关系与异步任务
-- =========================================================
create table if not exists public.knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  kind text not null check (kind in ('project', 'area', 'resource', 'archive')),
  obsidian_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.file_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_key text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('quarantine', 'available', 'rejected', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

create unique index if not exists file_assets_active_hash_idx
  on public.file_assets (user_id, sha256)
  where status <> 'deleted';
create index if not exists file_assets_user_created_idx
  on public.file_assets (user_id, created_at desc);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  collection_id uuid references public.knowledge_collections (id) on delete set null,
  asset_id uuid references public.file_assets (id) on delete set null,
  title text not null,
  document_type text not null default 'unknown',
  language text,
  status text not null check (
    status in ('extracting', 'analyzing', 'ready', 'needs_attention', 'failed')
  ),
  stage text not null check (
    stage in ('queued', 'extracting', 'chunking', 'analyzing', 'complete', 'failed')
  ),
  canonical_kind text not null default 'extracted'
    check (canonical_kind in ('extracted', 'markdown', 'external')),
  obsidian_path text,
  summary text,
  tags text[] not null default '{}',
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists knowledge_documents_user_updated_idx
  on public.knowledge_documents (user_id, updated_at desc);
create index if not exists knowledge_documents_collection_idx
  on public.knowledge_documents (user_id, collection_id, updated_at desc);
create index if not exists knowledge_documents_status_idx
  on public.knowledge_documents (user_id, status, updated_at desc);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  normalized_text text not null,
  parser text not null,
  parser_version text not null,
  extraction_metadata jsonb not null default '{}',
  source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (document_id, content_hash, parser, parser_version)
);

alter table public.knowledge_documents
  add column if not exists current_version_id uuid
  references public.document_versions (id) on delete set null;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  version_id uuid not null references public.document_versions (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  token_count integer check (token_count is null or token_count >= 0),
  heading_path text[] not null default '{}',
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  char_start integer check (char_start is null or char_start >= 0),
  char_end integer check (char_end is null or char_end >= 0),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (version_id, chunk_index)
);

create index if not exists document_chunks_search_idx
  on public.document_chunks using gin (search_vector);
create index if not exists document_chunks_document_idx
  on public.document_chunks (user_id, document_id, chunk_index);

create table if not exists public.knowledge_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  kind text not null check (kind in ('archive', 'note', 'todo', 'calendar')),
  title text not null,
  payload jsonb not null default '{}',
  confidence double precision not null default 0
    check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_proposals_document_idx
  on public.knowledge_proposals (user_id, document_id, status);

create table if not exists public.knowledge_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation_type text not null
    check (relation_type in ('source_of', 'derived_from', 'related_to', 'mentions', 'supersedes')),
  evidence_chunk_id uuid references public.document_chunks (id) on delete set null,
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  creator text not null check (creator in ('user', 'assistant', 'importer')),
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, target_type, target_id, relation_type)
);

create index if not exists knowledge_relations_source_idx
  on public.knowledge_relations (user_id, source_type, source_id);
create index if not exists knowledge_relations_target_idx
  on public.knowledge_relations (user_id, target_type, target_id);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.file_assets (id) on delete cascade,
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  job_type text not null default 'ingest' check (job_type in ('ingest', 'analyze')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  stage text not null default 'queued'
    check (stage in ('queued', 'extracting', 'chunking', 'analyzing', 'complete', 'failed')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (id, user_id)
);

create index if not exists ingestion_jobs_claim_idx
  on public.ingestion_jobs (status, available_at, created_at)
  where status in ('queued', 'processing');
create index if not exists ingestion_jobs_user_idx
  on public.ingestion_jobs (user_id, created_at desc);

-- =========================================================
-- 7.3 workspace intake：全局文件接管批次、条目与可撤销动作
-- =========================================================
create table if not exists public.workspace_intake_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_batch_id text not null,
  source_type text not null check (source_type in ('file_drop', 'file_picker')),
  page_context jsonb not null,
  status text not null check (
    status in (
      'uploading', 'processing', 'orchestrating', 'executing', 'completed',
      'partial', 'failed', 'cancelled', 'undoing', 'undone'
    )
  ),
  summary text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  undone_at timestamptz,
  unique (user_id, client_batch_id),
  unique (id, user_id)
);

create table if not exists public.workspace_intake_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null,
  asset_id uuid not null,
  document_id uuid not null,
  job_id uuid not null,
  hermes_run_id text,
  status text not null check (
    status in (
      'waiting_extraction', 'awaiting_hermes', 'orchestrating', 'executing',
      'completed', 'partial', 'failed', 'cancelled'
    )
  ),
  confidence double precision check (confidence is null or confidence between 0 and 1),
  decision_summary text,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  invalid_plan_count integer not null default 0 check (invalid_plan_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (batch_id, document_id),
  unique (id, user_id, batch_id),
  constraint workspace_intake_items_batch_owner_fk
    foreign key (batch_id, user_id)
    references public.workspace_intake_batches (id, user_id)
    on delete cascade,
  constraint workspace_intake_items_asset_owner_fk
    foreign key (asset_id, user_id)
    references public.file_assets (id, user_id)
    on delete restrict,
  constraint workspace_intake_items_document_owner_fk
    foreign key (document_id, user_id)
    references public.knowledge_documents (id, user_id)
    on delete restrict,
  constraint workspace_intake_items_job_owner_fk
    foreign key (job_id, user_id)
    references public.ingestion_jobs (id, user_id)
    on delete restrict
);

create table if not exists public.workspace_action_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null,
  item_id uuid not null,
  sequence integer not null check (sequence >= 0),
  action_name text not null,
  forward_input jsonb not null,
  forward_result jsonb,
  inverse_action text,
  inverse_input jsonb,
  conflict_fingerprint text,
  status text not null check (
    status in ('pending', 'completed', 'failed', 'undone', 'undo_conflict')
  ),
  confidence double precision not null check (confidence between 0 and 1),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  undone_at timestamptz,
  unique (item_id, sequence),
  constraint workspace_action_steps_item_owner_batch_fk
    foreign key (item_id, user_id, batch_id)
    references public.workspace_intake_items (id, user_id, batch_id)
    on delete cascade
);

create index if not exists workspace_intake_batches_user_recent_idx
  on public.workspace_intake_batches (user_id, created_at desc);
create index if not exists workspace_intake_batches_user_status_idx
  on public.workspace_intake_batches (user_id, status, updated_at desc);
create index if not exists workspace_intake_items_batch_idx
  on public.workspace_intake_items (user_id, batch_id, created_at);
create index if not exists workspace_intake_items_claim_idx
  on public.workspace_intake_items (status, available_at, created_at)
  where status in ('waiting_extraction', 'awaiting_hermes', 'orchestrating');
create index if not exists workspace_action_steps_batch_idx
  on public.workspace_action_steps (user_id, batch_id, item_id, sequence);

drop trigger if exists trg_knowledge_collections_updated_at on public.knowledge_collections;
create trigger trg_knowledge_collections_updated_at before update on public.knowledge_collections
for each row execute function public.set_updated_at();
drop trigger if exists trg_file_assets_updated_at on public.file_assets;
create trigger trg_file_assets_updated_at before update on public.file_assets
for each row execute function public.set_updated_at();
drop trigger if exists trg_knowledge_documents_updated_at on public.knowledge_documents;
create trigger trg_knowledge_documents_updated_at before update on public.knowledge_documents
for each row execute function public.set_updated_at();
drop trigger if exists trg_knowledge_proposals_updated_at on public.knowledge_proposals;
create trigger trg_knowledge_proposals_updated_at before update on public.knowledge_proposals
for each row execute function public.set_updated_at();
drop trigger if exists trg_ingestion_jobs_updated_at on public.ingestion_jobs;
create trigger trg_ingestion_jobs_updated_at before update on public.ingestion_jobs
for each row execute function public.set_updated_at();
drop trigger if exists trg_workspace_intake_batches_updated_at on public.workspace_intake_batches;
create trigger trg_workspace_intake_batches_updated_at before update on public.workspace_intake_batches
for each row execute function public.set_updated_at();
drop trigger if exists trg_workspace_intake_items_updated_at on public.workspace_intake_items;
create trigger trg_workspace_intake_items_updated_at before update on public.workspace_intake_items
for each row execute function public.set_updated_at();
drop trigger if exists trg_workspace_action_steps_updated_at on public.workspace_action_steps;
create trigger trg_workspace_action_steps_updated_at before update on public.workspace_action_steps
for each row execute function public.set_updated_at();

alter table public.knowledge_collections enable row level security;
alter table public.file_assets enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.knowledge_proposals enable row level security;
alter table public.knowledge_relations enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.workspace_intake_batches enable row level security;
alter table public.workspace_intake_items enable row level security;
alter table public.workspace_action_steps enable row level security;

create policy "knowledge_collections_all_own" on public.knowledge_collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "file_assets_select_own" on public.file_assets
  for select using (auth.uid() = user_id);
create policy "knowledge_documents_select_own" on public.knowledge_documents
  for select using (auth.uid() = user_id);
create policy "document_versions_select_own" on public.document_versions
  for select using (auth.uid() = user_id);
create policy "document_chunks_select_own" on public.document_chunks
  for select using (auth.uid() = user_id);
create policy "knowledge_proposals_select_own" on public.knowledge_proposals
  for select using (auth.uid() = user_id);
create policy "knowledge_relations_select_own" on public.knowledge_relations
  for select using (auth.uid() = user_id);
create policy "ingestion_jobs_select_own" on public.ingestion_jobs
  for select using (auth.uid() = user_id);
create policy "workspace_intake_batches_select_own" on public.workspace_intake_batches
  for select using (auth.uid() = user_id);
create policy "workspace_intake_items_select_own" on public.workspace_intake_items
  for select using (auth.uid() = user_id);
create policy "workspace_action_steps_select_own" on public.workspace_action_steps
  for select using (auth.uid() = user_id);

grant select on table public.workspace_intake_batches to authenticated;
grant select on table public.workspace_intake_items to authenticated;
grant select on table public.workspace_action_steps to authenticated;
revoke insert, update, delete on table public.workspace_intake_batches,
  public.workspace_intake_items,
  public.workspace_action_steps
  from anon, authenticated;

create or replace function public.register_knowledge_upload(
  p_user_id uuid,
  p_storage_key text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_idempotency_key text
)
returns table (
  asset_id uuid,
  document_id uuid,
  job_id uuid,
  reused_asset boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_user_id;
  v_asset_id uuid;
  v_document_id uuid;
  v_job_id uuid;
  v_reused boolean := false;
begin
  if v_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  select j.asset_id, j.document_id, j.id
    into v_asset_id, v_document_id, v_job_id
  from public.ingestion_jobs j
  where j.user_id = v_user_id and j.idempotency_key = p_idempotency_key;

  if found then
    return query select v_asset_id, v_document_id, v_job_id, true;
    return;
  end if;

  select a.id into v_asset_id
  from public.file_assets a
  where a.user_id = v_user_id
    and a.sha256 = p_sha256
    and a.status <> 'deleted'
  limit 1;

  if found then
    v_reused := true;
  else
    insert into public.file_assets (
      user_id, storage_key, original_name, mime_type, size_bytes, sha256, status
    ) values (
      v_user_id, p_storage_key, p_original_name, p_mime_type,
      p_size_bytes, p_sha256, 'quarantine'
    )
    returning id into v_asset_id;
  end if;

  insert into public.knowledge_documents (
    user_id, asset_id, title, status, stage
  ) values (
    v_user_id, v_asset_id, p_original_name, 'extracting', 'queued'
  ) returning id into v_document_id;

  insert into public.ingestion_jobs (
    user_id, asset_id, document_id, idempotency_key
  ) values (
    v_user_id, v_asset_id, v_document_id, p_idempotency_key
  ) returning id into v_job_id;

  return query select v_asset_id, v_document_id, v_job_id, v_reused;
end;
$$;

create or replace function public.register_workspace_intake_batch(
  p_user_id uuid,
  p_client_batch_id text,
  p_source_type text,
  p_page_context jsonb,
  p_items jsonb
)
returns table (
  batch_id uuid,
  item_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_item jsonb;
  v_asset_id uuid;
  v_document_id uuid;
  v_job_id uuid;
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;
  if nullif(btrim(p_client_batch_id), '') is null then
    raise exception 'CLIENT_BATCH_ID_REQUIRED';
  end if;
  if p_source_type is null
    or p_source_type not in ('file_drop', 'file_picker') then
    raise exception 'INVALID_INTAKE_SOURCE_TYPE';
  end if;
  if jsonb_typeof(p_page_context) is distinct from 'object' then
    raise exception 'INVALID_PAGE_CONTEXT';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'INVALID_INTAKE_ITEMS';
  end if;
  if jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 20 then
    raise exception 'INVALID_INTAKE_ITEMS';
  end if;

  insert into public.workspace_intake_batches (
    user_id, client_batch_id, source_type, page_context, status
  ) values (
    p_user_id, p_client_batch_id, p_source_type, p_page_context, 'processing'
  )
  on conflict (user_id, client_batch_id) do update
  set source_type = excluded.source_type,
      page_context = excluded.page_context
  returning id into v_batch_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_asset_id := (v_item ->> 'assetId')::uuid;
      v_document_id := (v_item ->> 'documentId')::uuid;
      v_job_id := (v_item ->> 'jobId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'INVALID_INTAKE_ITEM_IDS';
    end;

    if v_asset_id is null or v_document_id is null or v_job_id is null then
      raise exception 'INVALID_INTAKE_ITEM_IDS';
    end if;
    if not exists (
      select 1
      from public.file_assets a
      where a.id = v_asset_id and a.user_id = p_user_id
    ) then
      raise exception 'INTAKE_ASSET_NOT_OWNED';
    end if;
    if not exists (
      select 1
      from public.knowledge_documents d
      where d.id = v_document_id
        and d.user_id = p_user_id
        and d.asset_id = v_asset_id
    ) then
      raise exception 'INTAKE_DOCUMENT_NOT_OWNED';
    end if;
    if not exists (
      select 1
      from public.ingestion_jobs j
      where j.id = v_job_id
        and j.user_id = p_user_id
        and j.asset_id = v_asset_id
        and j.document_id = v_document_id
    ) then
      raise exception 'INTAKE_JOB_NOT_OWNED';
    end if;

    insert into public.workspace_intake_items (
      user_id, batch_id, asset_id, document_id, job_id, status
    ) values (
      p_user_id, v_batch_id, v_asset_id, v_document_id, v_job_id,
      'waiting_extraction'
    )
    on conflict (batch_id, document_id) do nothing;
  end loop;

  return query
  select
    v_batch_id,
    coalesce(
      array_agg(i.id order by i.created_at, i.id),
      array[]::uuid[]
    )
  from public.workspace_intake_items i
  where i.batch_id = v_batch_id
    and i.user_id = p_user_id;
end;
$$;

create or replace function public.claim_ingestion_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.ingestion_jobs
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select id
    from public.ingestion_jobs
    where (
      status = 'queued' and available_at <= now()
    ) or (
      status = 'processing' and lease_expires_at < now()
    )
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.ingestion_jobs j
  set status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      attempt_count = j.attempt_count + 1
  from candidate
  where j.id = candidate.id
  returning j.*;
$$;

create or replace function public.claim_workspace_intake_item(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  user_id uuid,
  batch_id uuid,
  asset_id uuid,
  document_id uuid,
  job_id uuid,
  hermes_run_id text,
  status text,
  confidence double precision,
  decision_summary text,
  error_code text,
  attempt_count integer,
  invalid_plan_count integer,
  available_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  page_context jsonb
)
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select i.id
    from public.workspace_intake_items i
    join public.knowledge_documents d
      on d.id = i.document_id
     and d.user_id = i.user_id
    join public.workspace_intake_batches b
      on b.id = i.batch_id
     and b.user_id = i.user_id
    where b.status in ('processing', 'orchestrating', 'executing')
      and d.status in ('ready', 'needs_attention')
      and i.available_at <= now()
      and (
        i.status in ('waiting_extraction', 'awaiting_hermes')
        or (
          i.status = 'orchestrating'
          and i.lease_expires_at < now()
        )
      )
    order by i.available_at, i.created_at
    for update of i skip locked
    limit 1
  ),
  claimed as (
    update public.workspace_intake_items i
    set status = 'orchestrating',
        lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(
          secs => greatest(30, p_lease_seconds)
        ),
        attempt_count = i.attempt_count + 1
    from candidate
    where i.id = candidate.id
    returning i.*
  )
  select
    c.id,
    c.user_id,
    c.batch_id,
    c.asset_id,
    c.document_id,
    c.job_id,
    c.hermes_run_id,
    c.status,
    c.confidence,
    c.decision_summary,
    c.error_code,
    c.attempt_count,
    c.invalid_plan_count,
    c.available_at,
    c.lease_owner,
    c.lease_expires_at,
    c.created_at,
    c.updated_at,
    c.completed_at,
    b.page_context
  from claimed c
  join public.workspace_intake_batches b
    on b.id = c.batch_id
   and b.user_id = c.user_id;
$$;

create or replace function public.attach_workspace_intake_correction_run(
  p_user_id uuid,
  p_item_id uuid,
  p_worker_id text,
  p_run_id text,
  p_invalid_plan_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_intake_items
  set hermes_run_id = p_run_id,
      invalid_plan_count = p_invalid_plan_count,
      status = 'orchestrating',
      error_code = null
  where id = p_item_id
    and user_id = p_user_id
    and lease_owner = p_worker_id
    and status in ('orchestrating', 'executing');

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;
  return true;
end;
$$;

create or replace function public.set_workspace_intake_item_decision(
  p_user_id uuid,
  p_item_id uuid,
  p_worker_id text,
  p_status text,
  p_confidence double precision,
  p_decision_summary text,
  p_invalid_plan_count integer,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_item_count integer;
  v_active_count integer;
  v_completed_count integer;
  v_failed_count integer;
  v_partial_count integer;
  v_batch_status text;
  v_batch_error_code text;
begin
  select batch_id into v_batch_id
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;
  if p_status not in ('executing', 'completed', 'partial', 'failed') then
    raise exception 'INVALID_INTAKE_ITEM_STATUS';
  end if;

  perform 1
  from public.workspace_intake_batches
  where id = v_batch_id
    and user_id = p_user_id
    and status in ('processing', 'orchestrating', 'executing')
  for update;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;

  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and batch_id = v_batch_id
    and lease_owner = p_worker_id
    and status in ('orchestrating', 'executing')
  for update;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;

  update public.workspace_intake_items
  set status = p_status,
      confidence = p_confidence,
      decision_summary = p_decision_summary,
      invalid_plan_count = p_invalid_plan_count,
      error_code = p_error_code,
      completed_at = case
        when p_status in ('completed', 'partial', 'failed') then now()
        else null
      end
  where id = p_item_id
    and user_id = p_user_id;

  if p_status not in ('completed', 'partial', 'failed') then
    return true;
  end if;

  select
    count(*),
    count(*) filter (
      where status in (
        'waiting_extraction',
        'awaiting_hermes',
        'orchestrating',
        'executing'
      )
    ),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'partial'),
    max(error_code) filter (where status in ('failed', 'partial'))
  into
    v_item_count,
    v_active_count,
    v_completed_count,
    v_failed_count,
    v_partial_count,
    v_batch_error_code
  from public.workspace_intake_items
  where batch_id = v_batch_id
    and user_id = p_user_id;

  if v_active_count > 0
    or v_completed_count + v_failed_count + v_partial_count <> v_item_count then
    return true;
  end if;

  v_batch_status := case
    when v_completed_count = v_item_count then 'completed'
    when v_failed_count = v_item_count then 'failed'
    else 'partial'
  end;

  update public.workspace_intake_batches
  set status = v_batch_status,
      error_code = case
        when v_batch_status = 'completed' then null
        else coalesce(v_batch_error_code, 'PROCESSING_FAILED')
      end,
      completed_at = now()
  where id = v_batch_id
    and user_id = p_user_id
    and status in ('processing', 'orchestrating', 'executing');

  return true;
end;
$$;

create or replace function public.retry_workspace_intake_batch(
  p_user_id uuid,
  p_batch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  select id into v_batch_id
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status in ('failed', 'partial')
  for update;

  if not found then
    return false;
  end if;

  update public.workspace_action_steps
  set status = 'pending',
      error_code = null,
      completed_at = null,
      undone_at = null
  where user_id = p_user_id
    and batch_id = p_batch_id
    and status = 'failed';

  update public.workspace_intake_items
  set status = 'awaiting_hermes',
      error_code = null,
      available_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      completed_at = null
  where user_id = p_user_id
    and batch_id = p_batch_id
    and status in ('failed', 'partial');

  update public.workspace_intake_batches
  set status = 'processing',
      error_code = null,
      completed_at = null
  where id = v_batch_id
    and user_id = p_user_id;

  return true;
end;
$$;

create or replace function public.cancel_workspace_intake_batch(
  p_user_id uuid,
  p_batch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  select id into v_batch_id
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status in ('uploading', 'processing', 'orchestrating', 'executing')
  for update;

  if not found then
    return false;
  end if;

  update public.workspace_intake_items
  set status = 'cancelled',
      error_code = 'INTAKE_CANCELLED',
      lease_owner = null,
      lease_expires_at = null,
      completed_at = now()
  where user_id = p_user_id
    and batch_id = p_batch_id
    and status in ('waiting_extraction', 'awaiting_hermes', 'orchestrating', 'executing');

  update public.workspace_intake_batches
  set status = 'cancelled',
      error_code = 'INTAKE_CANCELLED',
      completed_at = now()
  where id = v_batch_id
    and user_id = p_user_id;

  return true;
end;
$$;

create or replace function public.replace_workspace_intake_pending_steps(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_worker_id text,
  p_steps jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step jsonb;
begin
  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and lease_owner = p_worker_id
    and status in ('orchestrating', 'executing')
  for update;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array'
    or jsonb_array_length(p_steps) > 60 then
    raise exception 'INVALID_INTAKE_STEPS';
  end if;

  delete from public.workspace_action_steps
  where user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id
    and status in ('pending', 'failed');

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(v_step -> 'forwardInput') is distinct from 'object' then
      raise exception 'INVALID_INTAKE_STEP_INPUT';
    end if;
    if v_step ? 'inverseInput'
      and jsonb_typeof(v_step -> 'inverseInput') not in ('object', 'null') then
      raise exception 'INVALID_INTAKE_STEP_INPUT';
    end if;

    insert into public.workspace_action_steps (
      id,
      user_id,
      batch_id,
      item_id,
      sequence,
      action_name,
      forward_input,
      forward_result,
      inverse_action,
      inverse_input,
      conflict_fingerprint,
      status,
      confidence,
      error_code
    ) values (
      coalesce(nullif(v_step ->> 'id', '')::uuid, gen_random_uuid()),
      p_user_id,
      p_batch_id,
      p_item_id,
      (v_step ->> 'sequence')::integer,
      v_step ->> 'actionName',
      v_step -> 'forwardInput',
      null,
      nullif(v_step ->> 'inverseAction', ''),
      case
        when jsonb_typeof(v_step -> 'inverseInput') = 'object'
          then v_step -> 'inverseInput'
        else null
      end,
      nullif(v_step ->> 'conflictFingerprint', ''),
      'pending',
      (v_step ->> 'confidence')::double precision,
      null
    );
  end loop;

  return true;
end;
$$;

create or replace function public.complete_workspace_intake_step(
  p_user_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_worker_id text,
  p_forward_result jsonb,
  p_inverse_action text,
  p_inverse_input jsonb,
  p_conflict_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and lease_owner = p_worker_id
    and status in ('orchestrating', 'executing')
  for update;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;

  update public.workspace_action_steps
  set status = 'completed',
      forward_result = p_forward_result,
      inverse_action = p_inverse_action,
      inverse_input = p_inverse_input,
      conflict_fingerprint = p_conflict_fingerprint,
      error_code = null,
      completed_at = now()
  where id = p_step_id
    and user_id = p_user_id
    and item_id = p_item_id
    and status = 'pending';

  if not found then
    raise exception 'INTAKE_STEP_NOT_PENDING';
  end if;
  return true;
end;
$$;

create or replace function public.fail_workspace_intake_step(
  p_user_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_worker_id text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and lease_owner = p_worker_id
    and status in ('orchestrating', 'executing')
  for update;

  if not found then
    raise exception 'INTAKE_LEASE_LOST';
  end if;

  update public.workspace_action_steps
  set status = 'failed',
      error_code = case
        when p_error_code in (
          'HERMES_UNAVAILABLE',
          'INVALID_HERMES_PLAN',
          'PLAN_DOCUMENT_MISMATCH',
          'HERMES_APPROVAL_REQUIRED',
          'HERMES_RUN_TIMEOUT',
          'INTAKE_PROMPT_TOO_LARGE',
          'UNSAFE_INTAKE_ACTION',
          'EXECUTION_FAILED',
          'UNDO_RECORD_CHANGED',
          'UNDO_WINDOW_EXPIRED',
          'INTAKE_CANCELLED',
          'PROCESSING_FAILED'
        ) then p_error_code
        else 'PROCESSING_FAILED'
      end,
      completed_at = null
  where id = p_step_id
    and user_id = p_user_id
    and item_id = p_item_id
    and status = 'pending';

  if not found then
    raise exception 'INTAKE_STEP_NOT_PENDING';
  end if;
  return true;
end;
$$;

create or replace function public.normalize_intake_conflict_snapshot(
  p_value jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = public
as $$
  select case jsonb_typeof(p_value)
    when 'object' then coalesce(
      (
        select jsonb_object_agg(
          key,
          public.normalize_intake_conflict_snapshot(value)
          order by key
        )
        from jsonb_each(p_value)
        where key not in ('updated_at', 'last_edited_at', 'completed_at')
      ),
      '{}'::jsonb
    )
    when 'array' then coalesce(
      (
        select jsonb_agg(
          public.normalize_intake_conflict_snapshot(value)
          order by ordinal
        )
        from jsonb_array_elements(p_value)
          with ordinality as entries(value, ordinal)
      ),
      '[]'::jsonb
    )
    else p_value
  end;
$$;

create or replace function public.undo_workspace_intake_record_step(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_table_name text,
  p_record_id uuid,
  p_expected_snapshot jsonb,
  p_expected_fingerprint text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workspace_action_steps%rowtype;
  v_expected_action text;
  v_current jsonb;
begin
  if p_table_name not in ('notes', 'todos', 'calendar_events') then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;
  if jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or public.normalize_intake_conflict_snapshot(p_expected_snapshot)
      is distinct from p_expected_snapshot
    or p_expected_fingerprint is null
    or p_expected_fingerprint = '' then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;
  v_expected_action := case p_table_name
    when 'notes' then 'note.create'
    when 'todos' then 'todo.create'
    when 'calendar_events' then 'calendar.create'
  end;

  perform 1
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status = 'undoing'
  for update;
  if not found then
    raise exception 'INTAKE_BATCH_NOT_UNDOING';
  end if;

  select * into v_step
  from public.workspace_action_steps
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id
    and status in ('completed', 'undo_conflict')
  for update;
  if not found then
    raise exception 'INTAKE_STEP_NOT_UNDOABLE';
  end if;
  if jsonb_typeof(v_step.inverse_input) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result) is distinct from 'object'
    or v_step.conflict_fingerprint
      is distinct from p_expected_fingerprint
    or v_step.action_name is distinct from v_expected_action
    or v_step.inverse_action is distinct from 'record.delete'
    or v_step.inverse_input ->> 'table' is distinct from p_table_name
    or v_step.inverse_input ->> 'id' is distinct from p_record_id::text
    or v_step.forward_result ->> 'id' is distinct from p_record_id::text
    or v_step.forward_result -> 'postActionSnapshot' ->> 'id'
      is distinct from p_record_id::text
    or v_step.forward_result -> 'postActionSnapshot'
      is distinct from p_expected_snapshot then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  if p_table_name = 'notes' then
    select public.normalize_intake_conflict_snapshot(to_jsonb(n))
      into v_current
    from public.notes n
    where id = p_record_id
      and user_id = p_user_id
    for update;
  elsif p_table_name = 'todos' then
    select public.normalize_intake_conflict_snapshot(to_jsonb(t))
      into v_current
    from public.todos t
    where id = p_record_id
      and user_id = p_user_id
    for update;
  else
    select public.normalize_intake_conflict_snapshot(to_jsonb(e))
      into v_current
    from public.calendar_events e
    where id = p_record_id
      and user_id = p_user_id
    for update;
  end if;

  if not found then
    update public.workspace_action_steps
    set status = 'undone',
        error_code = null,
        undone_at = now()
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'already_missing';
  end if;

  if v_current is distinct from p_expected_snapshot then
    update public.workspace_action_steps
    set status = 'undo_conflict',
        error_code = 'UNDO_RECORD_CHANGED',
        undone_at = null
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'conflict';
  end if;

  if p_table_name = 'notes' then
    delete from public.notes
    where id = p_record_id and user_id = p_user_id;
  elsif p_table_name = 'todos' then
    delete from public.todos
    where id = p_record_id and user_id = p_user_id;
  else
    delete from public.calendar_events
    where id = p_record_id and user_id = p_user_id;
  end if;

  update public.workspace_action_steps
  set status = 'undone',
      error_code = null,
      undone_at = now()
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id;
  return 'undone';
end;
$$;

create or replace function public.undo_workspace_intake_archive_step(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_document_id uuid,
  p_previous_collection_id uuid,
  p_expected_snapshot jsonb,
  p_expected_fingerprint text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workspace_action_steps%rowtype;
  v_current jsonb;
begin
  if jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or public.normalize_intake_conflict_snapshot(p_expected_snapshot)
      is distinct from p_expected_snapshot
    or p_expected_fingerprint is null
    or p_expected_fingerprint = '' then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  perform 1
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status = 'undoing'
  for update;
  if not found then
    raise exception 'INTAKE_BATCH_NOT_UNDOING';
  end if;

  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and document_id = p_document_id
  for update;
  if not found then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  select * into v_step
  from public.workspace_action_steps
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id
    and status in ('completed', 'undo_conflict')
  for update;
  if not found then
    raise exception 'INTAKE_STEP_NOT_UNDOABLE';
  end if;
  if jsonb_typeof(v_step.inverse_input) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result -> 'postActionSnapshot')
      is distinct from 'object'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'collection_id'
    ) is distinct from 'string'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'collection_id' = ''
    or jsonb_typeof(v_step.forward_result -> 'collectionId')
      is distinct from 'string'
    or v_step.forward_result ->> 'collectionId' = ''
    or v_step.forward_result -> 'postActionSnapshot' ->> 'collection_id'
      is distinct from v_step.forward_result ->> 'collectionId'
    or v_step.conflict_fingerprint
      is distinct from p_expected_fingerprint
    or v_step.action_name is distinct from 'archive'
    or v_step.inverse_action is distinct from 'archive.restore'
    or v_step.inverse_input ->> 'documentId'
      is distinct from p_document_id::text
    or not (v_step.inverse_input ? 'previousCollectionId')
    or v_step.inverse_input ->> 'previousCollectionId'
      is distinct from p_previous_collection_id::text
    or v_step.forward_result -> 'postActionSnapshot' ->> 'id'
      is distinct from p_document_id::text
    or v_step.forward_result -> 'postActionSnapshot'
      is distinct from p_expected_snapshot then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  select jsonb_build_object(
      'id', d.id,
      'collection_id', d.collection_id
    ) into v_current
  from public.knowledge_documents d
  where id = p_document_id
    and user_id = p_user_id
  for update;

  if not found then
    update public.workspace_action_steps
    set status = 'undone',
        error_code = null,
        undone_at = now()
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'already_missing';
  end if;

  if v_current is distinct from p_expected_snapshot then
    update public.workspace_action_steps
    set status = 'undo_conflict',
        error_code = 'UNDO_RECORD_CHANGED',
        undone_at = null
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'conflict';
  end if;

  update public.knowledge_documents
  set collection_id = p_previous_collection_id
  where id = p_document_id
    and user_id = p_user_id;

  update public.workspace_action_steps
  set status = 'undone',
      error_code = null,
      undone_at = now()
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id;
  return 'undone';
end;
$$;

create or replace function public.undo_workspace_intake_relation_step(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_relation_id uuid,
  p_expected_snapshot jsonb,
  p_expected_fingerprint text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workspace_action_steps%rowtype;
  v_current jsonb;
begin
  if jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or public.normalize_intake_conflict_snapshot(p_expected_snapshot)
      is distinct from p_expected_snapshot
    or p_expected_fingerprint is null
    or p_expected_fingerprint = '' then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  perform 1
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status = 'undoing'
  for update;
  if not found then
    raise exception 'INTAKE_BATCH_NOT_UNDOING';
  end if;

  select * into v_step
  from public.workspace_action_steps
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id
    and status in ('completed', 'undo_conflict')
  for update;
  if not found then
    raise exception 'INTAKE_STEP_NOT_UNDOABLE';
  end if;
  if jsonb_typeof(v_step.inverse_input) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result -> 'postActionSnapshot')
      is distinct from 'object'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'source_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'source_id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'target_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'target_id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'relation_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'creator'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
    ) is distinct from 'number'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'source_type'
      is distinct from 'knowledge_document'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'source_id' = ''
    or v_step.forward_result -> 'postActionSnapshot' ->> 'target_type'
      is distinct from case v_step.action_name
        when 'relation.create:note' then 'note'
        when 'relation.create:todo' then 'todo'
        when 'relation.create:calendar' then 'calendar_event'
        else null
      end
    or v_step.forward_result -> 'postActionSnapshot' ->> 'target_id' = ''
    or v_step.forward_result -> 'postActionSnapshot' ->> 'relation_type'
      is distinct from 'source_of'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'creator'
      is distinct from 'assistant'
    or v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
      < '0'::jsonb
    or v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
      > '1'::jsonb
    or v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
      is distinct from to_jsonb(v_step.confidence)
    or v_step.conflict_fingerprint
      is distinct from p_expected_fingerprint
    or v_step.action_name is null
    or v_step.action_name not in (
      'relation.create:note',
      'relation.create:todo',
      'relation.create:calendar'
    )
    or v_step.inverse_action is distinct from 'relation.delete'
    or v_step.inverse_input ->> 'id'
      is distinct from p_relation_id::text
    or v_step.forward_result ->> 'id'
      is distinct from p_relation_id::text
    or v_step.forward_result ->> 'replayed' is distinct from 'false'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'id'
      is distinct from p_relation_id::text
    or v_step.forward_result -> 'postActionSnapshot'
      is distinct from p_expected_snapshot then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and document_id::text =
      v_step.forward_result -> 'postActionSnapshot' ->> 'source_id'
  for update;
  if not found then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  select to_jsonb(r) into v_current
  from public.knowledge_relations r
  where id = p_relation_id
    and user_id = p_user_id
  for update;

  if not found then
    update public.workspace_action_steps
    set status = 'undone',
        error_code = null,
        undone_at = now()
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'already_missing';
  end if;

  if v_current is distinct from p_expected_snapshot then
    update public.workspace_action_steps
    set status = 'undo_conflict',
        error_code = 'UNDO_RECORD_CHANGED',
        undone_at = null
    where id = p_step_id
      and user_id = p_user_id
      and batch_id = p_batch_id
      and item_id = p_item_id;
    return 'conflict';
  end if;

  delete from public.knowledge_relations
  where id = p_relation_id
    and user_id = p_user_id;

  update public.workspace_action_steps
  set status = 'undone',
      error_code = null,
      undone_at = now()
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id;
  return 'undone';
end;
$$;

create or replace function public.undo_workspace_intake_replayed_relation_step(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_step_id uuid,
  p_relation_id uuid,
  p_expected_snapshot jsonb,
  p_expected_fingerprint text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workspace_action_steps%rowtype;
begin
  if jsonb_typeof(p_expected_snapshot) is distinct from 'object'
    or public.normalize_intake_conflict_snapshot(p_expected_snapshot)
      is distinct from p_expected_snapshot
    or p_expected_fingerprint is null
    or p_expected_fingerprint = '' then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  perform 1
  from public.workspace_intake_batches
  where id = p_batch_id
    and user_id = p_user_id
    and status = 'undoing'
  for update;
  if not found then
    raise exception 'INTAKE_BATCH_NOT_UNDOING';
  end if;

  select * into v_step
  from public.workspace_action_steps
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id
    and status in ('completed', 'undo_conflict')
  for update;
  if not found then
    raise exception 'INTAKE_STEP_NOT_UNDOABLE';
  end if;
  if jsonb_typeof(v_step.forward_result) is distinct from 'object'
    or jsonb_typeof(v_step.forward_result -> 'postActionSnapshot')
      is distinct from 'object'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'source_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'source_id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'target_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'target_id'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'relation_type'
    ) is distinct from 'string'
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'creator'
    ) is distinct from 'string'
    or not (v_step.forward_result -> 'postActionSnapshot' ? 'confidence')
    or jsonb_typeof(
      v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
    ) not in ('number', 'null')
    or v_step.forward_result -> 'postActionSnapshot' ->> 'source_type'
      is distinct from 'knowledge_document'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'source_id' = ''
    or v_step.forward_result -> 'postActionSnapshot' ->> 'target_type'
      is distinct from case v_step.action_name
        when 'relation.create:note' then 'note'
        when 'relation.create:todo' then 'todo'
        when 'relation.create:calendar' then 'calendar_event'
        else null
      end
    or v_step.forward_result -> 'postActionSnapshot' ->> 'target_id' = ''
    or v_step.forward_result -> 'postActionSnapshot' ->> 'relation_type'
      is distinct from 'source_of'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'creator'
      not in ('user', 'assistant', 'importer')
    or (
      jsonb_typeof(
        v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
      ) = 'number'
      and (
        v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
          < '0'::jsonb
        or v_step.forward_result -> 'postActionSnapshot' -> 'confidence'
          > '1'::jsonb
      )
    )
    or v_step.conflict_fingerprint
      is distinct from p_expected_fingerprint
    or v_step.action_name is null
    or v_step.action_name not in (
      'relation.create:note',
      'relation.create:todo',
      'relation.create:calendar'
    )
    or v_step.inverse_action is not null
    or v_step.inverse_input is not null
    or v_step.forward_result ->> 'id'
      is distinct from p_relation_id::text
    or v_step.forward_result ->> 'replayed' is distinct from 'true'
    or jsonb_typeof(v_step.forward_result -> 'postActionSnapshot')
      is distinct from 'object'
    or v_step.forward_result -> 'postActionSnapshot' ->> 'id'
      is distinct from p_relation_id::text
    or v_step.forward_result -> 'postActionSnapshot'
      is distinct from p_expected_snapshot then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  perform 1
  from public.workspace_intake_items
  where id = p_item_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and document_id::text =
      v_step.forward_result -> 'postActionSnapshot' ->> 'source_id'
  for update;
  if not found then
    raise exception 'INVALID_INTAKE_INVERSE';
  end if;

  update public.workspace_action_steps
  set status = 'undone',
      error_code = null,
      undone_at = now()
  where id = p_step_id
    and user_id = p_user_id
    and batch_id = p_batch_id
    and item_id = p_item_id;
  return 'undone';
end;
$$;

create or replace function public.complete_ingestion_job(p_job_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ingestion_jobs
  set status = 'completed', stage = 'complete', progress = 100,
      lease_owner = null, lease_expires_at = null, error_code = null
  where id = p_job_id;
$$;

create or replace function public.fail_ingestion_job(
  p_job_id uuid,
  p_error_code text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ingestion_jobs
  set status = 'failed', stage = 'failed',
      lease_owner = null, lease_expires_at = null,
      error_code = left(p_error_code, 100)
  where id = p_job_id;
$$;

create or replace function public.search_knowledge_chunks(
  p_query text,
  p_collection_id uuid default null,
  p_limit integer default 20
)
returns table (
  document_id uuid,
  chunk_id uuid,
  title text,
  snippet text,
  rank double precision,
  page_start integer,
  page_end integer,
  heading_path text[],
  asset_id uuid
)
language sql
stable
set search_path = public
as $$
  select
    d.id,
    c.id,
    d.title,
    ts_headline(
      'simple',
      c.content,
      websearch_to_tsquery('simple', p_query),
      'MaxWords=35, MinWords=10, StartSel=<mark>, StopSel=</mark>'
    ),
    ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', p_query))::double precision,
    c.page_start,
    c.page_end,
    c.heading_path,
    d.asset_id
  from public.document_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  where c.user_id = auth.uid()
    and d.user_id = auth.uid()
    and (p_collection_id is null or d.collection_id = p_collection_id)
    and c.search_vector @@ websearch_to_tsquery('simple', p_query)
  order by ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', p_query)) desc,
           d.updated_at desc
  limit least(greatest(p_limit, 1), 20);
$$;

grant execute on function public.search_knowledge_chunks(text, uuid, integer)
  to authenticated;
revoke all on function public.register_knowledge_upload(uuid, text, text, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.register_workspace_intake_batch(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_ingestion_job(text, integer) from public, anon, authenticated;
revoke all on function public.claim_workspace_intake_item(text, integer)
  from public, anon, authenticated;
revoke all on function public.attach_workspace_intake_correction_run(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.set_workspace_intake_item_decision(uuid, uuid, text, text, double precision, text, integer, text) from public, anon, authenticated;
revoke all on function public.retry_workspace_intake_batch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_workspace_intake_batch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_workspace_intake_pending_steps(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_workspace_intake_step(uuid, uuid, uuid, text, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.fail_workspace_intake_step(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.undo_workspace_intake_record_step(uuid, uuid, uuid, uuid, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.undo_workspace_intake_archive_step(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.undo_workspace_intake_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.undo_workspace_intake_replayed_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.complete_ingestion_job(uuid) from public, anon, authenticated;
revoke all on function public.fail_ingestion_job(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_ingestion_job(text, integer) to service_role;
grant execute on function public.claim_workspace_intake_item(text, integer)
  to service_role;
grant execute on function public.attach_workspace_intake_correction_run(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.set_workspace_intake_item_decision(uuid, uuid, text, text, double precision, text, integer, text) to service_role;
grant execute on function public.retry_workspace_intake_batch(uuid, uuid) to service_role;
grant execute on function public.cancel_workspace_intake_batch(uuid, uuid) to service_role;
grant execute on function public.replace_workspace_intake_pending_steps(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.complete_workspace_intake_step(uuid, uuid, uuid, text, jsonb, text, jsonb, text) to service_role;
grant execute on function public.fail_workspace_intake_step(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.undo_workspace_intake_record_step(uuid, uuid, uuid, uuid, text, uuid, jsonb, text) to service_role;
grant execute on function public.undo_workspace_intake_archive_step(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.undo_workspace_intake_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.undo_workspace_intake_replayed_relation_step(uuid, uuid, uuid, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.complete_ingestion_job(uuid) to service_role;
grant execute on function public.fail_ingestion_job(uuid, text) to service_role;
grant execute on function public.register_knowledge_upload(uuid, text, text, text, bigint, text, text)
  to service_role;
grant execute on function public.register_workspace_intake_batch(uuid, text, text, jsonb, jsonb)
  to service_role;

-- =========================================================
-- 8. Realtime 订阅发布
-- =========================================================
-- Supabase Realtime 通过 publication 暴露表的变更。
-- 默认 publication 是 supabase_realtime，需要把业务表加入。
alter publication supabase_realtime add table public.todos;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.document_links;
alter publication supabase_realtime add table public.knowledge_documents;
alter publication supabase_realtime add table public.knowledge_proposals;
alter publication supabase_realtime add table public.ingestion_jobs;
alter publication supabase_realtime add table public.workspace_intake_batches;
alter publication supabase_realtime add table public.workspace_intake_items;
alter publication supabase_realtime add table public.workspace_action_steps;

-- =========================================================
-- 9. 注册时自动创建 profiles / user_settings
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, theme)
  values (new.id, 'system')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================================================
-- 10. 笔记版本号自动 +1
-- =========================================================
create or replace function public.bump_note_version()
returns trigger
language plpgsql
as $$
begin
  if new.content is distinct from old.content or new.title is distinct from old.title then
    new.version = old.version + 1;
    new.last_edited_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notes_bump_version on public.notes;
create trigger trg_notes_bump_version
before update on public.notes
for each row execute function public.bump_note_version();

-- =========================================================
-- 完成
-- =========================================================
-- 验证：
--   select tablename, rowsecurity from pg_tables where schemaname='public';
--   应全部为 true。
--   select * from pg_policies where schemaname='public';
--   应看到每张业务表至少 4 条策略 (select/insert/update/delete)。
