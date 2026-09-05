import { createRouteHandlerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbenchAction } from "@/lib/assistant/actions";

export async function executeWorkbenchAction(
  userId: string,
  action: WorkbenchAction,
  client?: SupabaseClient,
): Promise<unknown> {
  const supabase = client ?? (await createRouteHandlerClient());
  const startedAt = Date.now();

  try {
    const result = await execute(supabase, userId, action);
    await safeWriteAudit(supabase, userId, action.action, true, Date.now() - startedAt);
    return result;
  } catch (error) {
    await safeWriteAudit(supabase, userId, action.action, false, Date.now() - startedAt);
    throw error;
  }
}

async function execute(
  supabase: SupabaseClient,
  userId: string,
  action: WorkbenchAction,
) {
  switch (action.action) {
    case "calendar.list": {
      let query = supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: false })
        .limit(100);
      if (action.input.date) query = query.eq("event_date", action.input.date);
      return readMany(await query);
    }
    case "calendar.create":
      return readOne(
        await supabase
          .from("calendar_events")
          .insert({ user_id: userId, ...action.input })
          .select("*")
          .single(),
      );
    case "calendar.update": {
      const { id, ...patch } = action.input;
      return readOne(
        await supabase
          .from("calendar_events")
          .update(patch)
          .eq("id", id)
          .eq("user_id", userId)
          .select("*")
          .single(),
      );
    }
    case "calendar.delete":
      await ensureSuccess(
        supabase
          .from("calendar_events")
          .delete()
          .eq("id", action.input.id)
          .eq("user_id", userId),
      );
      return { id: action.input.id, deleted: true };

    case "todo.list": {
      let query = supabase
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("due_time", { ascending: true, nullsFirst: false })
        .limit(100);
      if (action.input.date) query = query.eq("due_date", action.input.date);
      if (action.input.status) query = query.eq("status", action.input.status);
      return readMany(await query);
    }
    case "todo.create":
      return readOne(
        await supabase
          .from("todos")
          .insert({
            user_id: userId,
            status: "pending",
            priority: "medium",
            ...action.input,
          })
          .select("*")
          .single(),
      );
    case "todo.update": {
      const { id, ...patch } = action.input;
      return readOne(
        await supabase
          .from("todos")
          .update(patch)
          .eq("id", id)
          .eq("user_id", userId)
          .select("*")
          .single(),
      );
    }
    case "todo.complete":
      return readOne(
        await supabase
          .from("todos")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", action.input.id)
          .eq("user_id", userId)
          .select("*")
          .single(),
      );
    case "todo.delete":
      await ensureSuccess(
        supabase
          .from("todos")
          .delete()
          .eq("id", action.input.id)
          .eq("user_id", userId),
      );
      return { id: action.input.id, deleted: true };

    case "note.list": {
      const rows = readMany(
        await supabase
          .from("notes")
          .select("*")
          .eq("user_id", userId)
          .order("is_pinned", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(100),
      );
      return filterRows(rows, action.input.query, ["title", "content", "summary"]);
    }
    case "note.create":
      return readOne(
        await supabase
          .from("notes")
          .insert({
            user_id: userId,
            content: "",
            tags: [],
            ...action.input,
          })
          .select("*")
          .single(),
      );
    case "note.update": {
      const { id, version, ...patch } = action.input;
      const response = await supabase
        .from("notes")
        .update({
          ...patch,
          version: version + 1,
          last_edited_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("version", version)
        .select("*")
        .maybeSingle();
      if (response.error) throw new Error(response.error.message);
      if (!response.data) throw new Error("笔记已被其他设备修改，请刷新后重试");
      return response.data;
    }
    case "note.delete":
      await ensureSuccess(
        supabase
          .from("notes")
          .delete()
          .eq("id", action.input.id)
          .eq("user_id", userId),
      );
      return { id: action.input.id, deleted: true };

    case "document.list": {
      const rows = readMany(
        await supabase
          .from("document_links")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(100),
      );
      return filterRows(rows, action.input.query, ["title", "note"]);
    }
    case "document.create":
      return readOne(
        await supabase
          .from("document_links")
          .insert({ user_id: userId, ...action.input })
          .select("*")
          .single(),
      );
    case "document.update": {
      const { id, ...patch } = action.input;
      return readOne(
        await supabase
          .from("document_links")
          .update(patch)
          .eq("id", id)
          .eq("user_id", userId)
          .select("*")
          .single(),
      );
    }
    case "document.delete":
      await ensureSuccess(
        supabase
          .from("document_links")
          .delete()
          .eq("id", action.input.id)
          .eq("user_id", userId),
      );
      return { id: action.input.id, deleted: true };
  }
}

function readOne(response: { data: unknown; error: { message: string } | null }) {
  if (response.error) throw new Error(response.error.message);
  return response.data;
}

function readMany(response: {
  data: unknown[] | null;
  error: { message: string } | null;
}) {
  if (response.error) throw new Error(response.error.message);
  return response.data ?? [];
}

async function ensureSuccess(
  query: PromiseLike<{ error: { message: string } | null }>,
) {
  const response = await query;
  if (response.error) throw new Error(response.error.message);
}

function filterRows(
  rows: unknown[],
  query: string | undefined,
  keys: string[],
) {
  const needle = query?.trim().toLocaleLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    if (typeof row !== "object" || row === null) return false;
    const record = row as Record<string, unknown>;
    return keys.some((key) =>
      String(record[key] ?? "")
        .toLocaleLowerCase()
        .includes(needle),
    );
  });
}

async function writeAudit(
  supabase: SupabaseClient,
  userId: string,
  action: string,
  success: boolean,
  durationMs: number,
) {
  await supabase.from("ai_action_logs").insert({
    user_id: userId,
    action_type: action,
    model: "deepseek-harness",
    success,
    duration_ms: durationMs,
    error_code: success ? null : "ACTION_FAILED",
  });
}

async function safeWriteAudit(
  supabase: SupabaseClient,
  userId: string,
  action: string,
  success: boolean,
  durationMs: number,
) {
  try {
    await writeAudit(supabase, userId, action, success, durationMs);
  } catch {
    // Audit is best-effort and must never turn a committed business write into a retry.
  }
}
