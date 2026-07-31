import { describe, expect, it } from "vitest";
import { useDataStore } from "@/lib/stores/data";

describe("data store", () => {
  it("upsertTodo 去重并替换", () => {
    useDataStore.getState().reset();
    const todo = makeTodo("a");
    useDataStore.getState().upsertTodo(todo);
    useDataStore.getState().upsertTodo({ ...todo, title: "b" });
    const list = useDataStore.getState().todos;
    expect(list.length).toBe(1);
    expect(list[0]?.title).toBe("b");
  });

  it("removeTodo 按 id 删除", () => {
    useDataStore.getState().reset();
    const t1 = makeTodo("1");
    const t2 = makeTodo("2");
    useDataStore.getState().upsertTodo(t1);
    useDataStore.getState().upsertTodo(t2);
    useDataStore.getState().removeTodo(t1.id);
    const ids = useDataStore.getState().todos.map((t) => t.id);
    expect(ids).toEqual([t2.id]);
  });

  it("Realtime payload upsert/remove 路径正确", () => {
    useDataStore.getState().reset();
    const t1 = makeTodo("x");
    // 模拟 insert
    useDataStore.getState().upsertTodo(t1);
    expect(useDataStore.getState().todos.length).toBe(1);
    // 模拟 update
    useDataStore.getState().upsertTodo({ ...t1, title: "y" });
    expect(useDataStore.getState().todos[0]?.title).toBe("y");
    // 模拟 delete
    useDataStore.getState().removeTodo(t1.id);
    expect(useDataStore.getState().todos.length).toBe(0);
  });
});

function makeTodo(seed: string) {
  return {
    id: seed,
    user_id: "u1",
    title: seed,
    description: null,
    status: "pending" as const,
    priority: "medium" as const,
    due_date: null,
    due_time: null,
    completed_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}
