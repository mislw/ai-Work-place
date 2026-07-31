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
-- 8. Realtime 订阅发布
-- =========================================================
-- Supabase Realtime 通过 publication 暴露表的变更。
-- 默认 publication 是 supabase_realtime，需要把业务表加入。
alter publication supabase_realtime add table public.todos;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.document_links;

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
