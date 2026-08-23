import { createClient } from "@/lib/supabase/client";
import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import {
  createPreviewId,
  readPreviewCollection,
  updatePreviewCollection,
} from "@/lib/data/preview-store";
import type { Todo, TodoPriority, TodoStatus } from "@/types/domain";
import type { TodoInput } from "@/lib/schemas";
import { getAppNow } from "@/lib/app-now";

const TABLE = "todos";

/** 列表查询（按用户）。 */
export async function listTodos(): Promise<Todo[]> {
  if (isPreviewAuthEnabled()) {
    return [...readPreviewCollection("todos")].sort((a, b) => {
      const dateOrder = (a.due_date ?? "9999-12-31").localeCompare(
        b.due_date ?? "9999-12-31",
      );
      if (dateOrder !== 0) return dateOrder;
      const timeOrder = (a.due_time ?? "99:99").localeCompare(
        b.due_time ?? "99:99",
      );
      return timeOrder || b.created_at.localeCompare(a.created_at);
    });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("due_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Todo[];
}

/** 创建。 */
export async function createTodo(
  userId: string,
  input: TodoInput,
): Promise<Todo> {
  if (isPreviewAuthEnabled()) {
    const now = getAppNow().toISOString();
    const row: Todo = {
      id: createPreviewId("todo"),
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      status: "pending",
      priority: input.priority ?? "medium",
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    updatePreviewCollection("todos", (rows) => [...rows, row]);
    return row;
  }
  const supabase = createClient();
  const row = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    status: "pending" as TodoStatus,
    priority: (input.priority ?? "medium") as TodoPriority,
    due_date: input.due_date ?? null,
    due_time: input.due_time ?? null,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Todo;
}

/** 更新（按 id + user_id 限定）。 */
export async function updateTodo(
  id: string,
  patch: Partial<TodoInput & { status: TodoStatus }>,
): Promise<Todo> {
  if (isPreviewAuthEnabled()) {
    let updated: Todo | null = null;
    updatePreviewCollection("todos", (rows) =>
      rows.map((todo) => {
        if (todo.id !== id) return todo;
        const status = patch.status ?? todo.status;
        updated = {
          ...todo,
          ...patch,
          completed_at:
            patch.status === undefined
              ? todo.completed_at
              : status === "completed"
                ? getAppNow().toISOString()
                : null,
          updated_at: getAppNow().toISOString(),
        };
        return updated;
      }),
    );
    if (!updated) throw new Error("待办不存在");
    return updated;
  }
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.due_date !== undefined) update.due_date = patch.due_date;
  if (patch.due_time !== undefined) update.due_time = patch.due_time;
  if (patch.status !== undefined) {
    update.status = patch.status;
    update.completed_at =
      patch.status === "completed" ? new Date().toISOString() : null;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Todo;
}

/** 删除。 */
export async function deleteTodo(id: string): Promise<void> {
  if (isPreviewAuthEnabled()) {
    updatePreviewCollection("todos", (rows) =>
      rows.filter((todo) => todo.id !== id),
    );
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** 切换完成。 */
export async function toggleTodo(id: string, current: TodoStatus): Promise<Todo> {
  return updateTodo(id, {
    status: current === "completed" ? "pending" : "completed",
  });
}
