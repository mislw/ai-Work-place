import { createClient } from "@/lib/supabase/client";
import type { Todo, TodoPriority, TodoStatus } from "@/types/domain";
import type { TodoInput } from "@/lib/schemas";

const TABLE = "todos";

/** 列表查询（按用户）。 */
export async function listTodos(): Promise<Todo[]> {
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
