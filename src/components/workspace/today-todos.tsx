"use client";

import { useMemo, useState } from "react";
import { Plus, MoreHorizontal, Star } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useDataStore } from "@/lib/stores/data";
import { dateKey } from "@/lib/date";
import { createTodo, toggleTodo, deleteTodo } from "@/lib/data/todos";
import { useAuth } from "@/hooks/use-auth";
import { TodoFormDialog } from "@/components/todos/todo-form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import Link from "next/link";
import type { Todo } from "@/types/domain";
import { useClientNow } from "@/hooks/use-client-now";
import { CrayonDecoration } from "@/components/common/crayon-decoration";

const PRIORITY_DOT: Record<Todo["priority"], string> = {
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
};
const PRIORITY_LABEL: Record<Todo["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export function TodayTodosCard() {
  const { user } = useAuth();
  const todos = useDataStore((s) => s.todos);
  const upsertTodo = useDataStore((s) => s.upsertTodo);
  const removeTodo = useDataStore((s) => s.removeTodo);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null);
  const now = useClientNow();

  const today = useMemo(() => (now ? dateKey(now) : ""), [now]);
  const todayTodos = useMemo(
    () =>
      todos
        .filter((t) => t.due_date === today)
        .sort((a, b) => {
          // pending 优先，然后按优先级与时间
          if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
          const order = { high: 0, medium: 1, low: 2 } as const;
          if (order[a.priority] !== order[b.priority])
            return order[a.priority] - order[b.priority];
          return (a.due_time ?? "").localeCompare(b.due_time ?? "");
        })
        .slice(0, 5),
    [todos, today],
  );
  const completed = todayTodos.filter((t) => t.status === "completed").length;
  const progress = todayTodos.length
    ? Math.round((completed / todayTodos.length) * 100)
    : 0;

  async function handleToggle(t: Todo) {
    // 乐观更新
    const next: Todo = {
      ...t,
      status: t.status === "completed" ? "pending" : "completed",
      completed_at: t.status === "completed" ? null : new Date().toISOString(),
    };
    upsertTodo(next);
    try {
      const updated = await toggleTodo(t.id, t.status);
      upsertTodo(updated);
    } catch {
      // 回滚
      upsertTodo(t);
      toast.error("操作失败，请重试");
    }
  }

  async function handleDelete(t: Todo) {
    setPendingDelete(t);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const snapshot = pendingDelete;
    removeTodo(id);
    setPendingDelete(null);
    try {
      await deleteTodo(id);
      toast.success("已删除");
    } catch {
      upsertTodo(snapshot);
      toast.error("删除失败");
    }
  }

  async function handleCreate(values: {
    title: string;
    description?: string | null;
    priority: "low" | "medium" | "high";
    due_date?: string | null;
    due_time?: string | null;
  }) {
    if (!user) return;
    const created = await createTodo(user.id, {
      title: values.title,
      description: values.description ?? null,
      priority: values.priority,
      due_date: values.due_date ?? today,
      due_time: values.due_time ?? null,
    });
    upsertTodo(created);
    setFormOpen(false);
    toast.success("已添加待办");
  }

  return (
    <Card className="workspace-feature-card workspace-todos-card relative h-full min-h-[388px] overflow-hidden">
      <CardHeader className="workspace-card-header flex flex-row items-center justify-between">
        <div>
          <div className="workspace-title-ribbon workspace-title-red">
            <CardTitle className="text-lg text-white">今日待办</CardTitle>
            <Star className="h-4 w-4 fill-[#f5d447] text-[#f5d447]" aria-hidden />
          </div>
          {todayTodos.length > 0 ? (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {completed}/{todayTodos.length} · 已完成 {progress}%
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">添加任务</span>
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label="查看全部">
            <Link href="/todos">
              <MoreHorizontal className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="relative min-h-[286px] space-y-2">
        {todayTodos.length > 0 ? (
          <>
            <Progress value={progress} />
            <ul className="divide-y divide-border xl:pr-28">
              {todayTodos.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 py-2.5 text-sm"
                >
                  <Checkbox
                    checked={t.status === "completed"}
                    onCheckedChange={() => handleToggle(t)}
                    aria-label={t.status === "completed" ? "标记未完成" : "标记完成"}
                  />
                  <span
                    className={
                      t.status === "completed"
                        ? "line-through text-muted-foreground"
                        : "text-foreground"
                    }
                  >
                    {t.title}
                  </span>
                  <span
                    className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`}
                    aria-label={`优先级 ${PRIORITY_LABEL[t.priority]}`}
                  />
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    {t.due_time ? <span>{t.due_time}</span> : null}
                    {t.status === "completed" ? (
                      <Badge variant="success">已完成</Badge>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="更多"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDelete(t)}>
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </li>
              ))}
            </ul>
            <CrayonDecoration
              scene="friends"
              className="absolute bottom-3 right-4 hidden w-[112px] opacity-95 xl:block"
            />
          </>
        ) : (
          <EmptyState
            icon={
              <CrayonDecoration
                scene="friends"
                className="h-auto w-[156px]"
              />
            }
            title="今天还没有待办"
            description="添加第一项待办，开始管理你的今天。"
            className="!border-0 !bg-transparent !py-5 !shadow-none"
            action={
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                添加任务
              </Button>
            }
          />
        )}
      </CardContent>
      <TodoFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultDate={today}
        onSubmit={handleCreate}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="删除待办？"
        description={`确定删除「${pendingDelete?.title}」吗？此操作不可撤销。`}
        confirmText="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
