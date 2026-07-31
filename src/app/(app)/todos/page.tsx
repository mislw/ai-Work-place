"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Filter } from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useDataStore } from "@/lib/stores/data";
import { useBootstrapData } from "@/hooks/use-bootstrap-data";
import { useAuth } from "@/hooks/use-auth";
import { TodoFormDialog } from "@/components/todos/todo-form-dialog";
import {
  createTodo,
  updateTodo,
  deleteTodo,
  toggleTodo,
} from "@/lib/data/todos";
import { dateKey } from "@/lib/date";
import type { Todo, TodoPriority, TodoStatus } from "@/types/domain";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIORITY_DOT: Record<TodoPriority, string> = {
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
};
const PRIORITY_LABEL: Record<TodoPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

type FilterStatus = "all" | "pending" | "completed";
type FilterPriority = "all" | TodoPriority;
type FilterRange = "all" | "today" | "week" | "overdue";

export default function TodosPage() {
  useBootstrapData();
  const { user } = useAuth();
  const todos = useDataStore((s) => s.todos);
  const upsertTodo = useDataStore((s) => s.upsertTodo);
  const removeTodo = useDataStore((s) => s.removeTodo);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FilterStatus>("all");
  const [priority, setPriority] = useState<FilterPriority>("all");
  const [range, setRange] = useState<FilterRange>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [todos.length]);

  const today = useMemo(() => dateKey(new Date()), []);
  const filtered = useMemo(() => {
    return todos
      .filter((t) => {
        if (search && !`${t.title} ${t.description ?? ""}`.toLowerCase().includes(search.toLowerCase()))
          return false;
        if (status !== "all" && t.status !== status) return false;
        if (priority !== "all" && t.priority !== priority) return false;
        if (range === "today" && t.due_date !== today) return false;
        if (range === "week") {
          if (!t.due_date) return false;
          const d = new Date(t.due_date);
          const now = new Date();
          const diff = (d.getTime() - now.getTime()) / 86_400_000;
          if (diff < 0 || diff > 7) return false;
        }
        if (range === "overdue") {
          if (!t.due_date) return false;
          if (t.due_date >= today) return false;
          if (t.status === "completed") return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        const order = { high: 0, medium: 1, low: 2 } as const;
        if (order[a.priority] !== order[b.priority])
          return order[a.priority] - order[b.priority];
        const da = a.due_date ?? "9999";
        const db = b.due_date ?? "9999";
        if (da !== db) return da.localeCompare(db);
        return (a.due_time ?? "").localeCompare(b.due_time ?? "");
      });
  }, [todos, search, status, priority, range, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const t of filtered) {
      const key = t.due_date ?? "未排期";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [filtered]);

  async function handleToggle(t: Todo) {
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
      upsertTodo(t);
      toast.error("操作失败");
    }
  }

  async function handleSubmit(values: {
    title: string;
    description?: string | null;
    priority: "low" | "medium" | "high";
    due_date?: string | null;
    due_time?: string | null;
  }) {
    if (!user) return;
    if (editing) {
      const optimistic = {
        ...editing,
        ...values,
        description: values.description ?? null,
        due_date: values.due_date ?? null,
        due_time: values.due_time ?? null,
      } as Todo;
      upsertTodo(optimistic);
      try {
        const updated = await updateTodo(editing.id, values);
        upsertTodo(updated);
        toast.success("已更新");
      } catch {
        upsertTodo(editing);
        toast.error("更新失败");
      }
    } else {
      const created = await createTodo(user.id, {
        title: values.title,
        description: values.description ?? null,
        priority: values.priority,
        due_date: values.due_date ?? today,
        due_time: values.due_time ?? null,
      });
      upsertTodo(created);
      toast.success("已添加");
    }
    setOpen(false);
    setEditing(null);
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

  if (error) {
    return <ErrorState message={error} onRetry={() => setError(null)} />;
  }

  return (
    <>
      <PageHeader
        title="今日待办"
        description="管理所有任务、安排、提醒。手机电脑自动同步。"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> 新建
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 sm:px-6">
        <Card>
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索待办"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={status} onValueChange={(v) => setStatus(v as FilterStatus)}>
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">未完成</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={(v) => setPriority(v as FilterPriority)}>
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部优先级</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
              <Select value={range} onValueChange={(v) => setRange(v as FilterRange)}>
                <SelectTrigger className="h-8 w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部时间</SelectItem>
                  <SelectItem value="today">今天</SelectItem>
                  <SelectItem value="week">本周</SelectItem>
                  <SelectItem value="overdue">已逾期</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {grouped.length === 0 ? (
          <EmptyState
            icon={<Plus className="h-5 w-5" />}
            title="暂无待办"
            description="点击右上角新建，开始你的今天。"
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> 新建
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {grouped.map(([key, list]) => (
              <Card key={key}>
                <CardContent className="p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{key === "未排期" ? key : formatDayHeader(key)}</span>
                    <span>
                      {list.filter((t) => t.status === "completed").length}/{list.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {list.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 py-2.5 text-sm"
                      >
                        <Checkbox
                          checked={t.status === "completed"}
                          onCheckedChange={() => handleToggle(t)}
                        />
                        <button
                          onClick={() => {
                            setEditing(t);
                            setOpen(true);
                          }}
                          className="flex-1 text-left"
                        >
                          <span
                            className={
                              t.status === "completed"
                                ? "line-through text-muted-foreground"
                                : "text-foreground"
                            }
                          >
                            {t.title}
                          </span>
                          {t.description ? (
                            <p className="line-clamp-1 text-xs text-muted-foreground">
                              {t.description}
                            </p>
                          ) : null}
                        </button>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`}
                          aria-label={`优先级 ${PRIORITY_LABEL[t.priority]}`}
                        />
                        {t.due_time ? (
                          <span className="text-xs text-muted-foreground">
                            {t.due_time}
                          </span>
                        ) : null}
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
                            <DropdownMenuItem
                              onClick={() => handleToggle(t)}
                            >
                              标记为
                              {t.status === "completed" ? "未完成" : "已完成"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditing(t);
                                setOpen(true);
                              }}
                            >
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(t)}
                            >
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <TodoFormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
        defaultDate={editing?.due_date ?? today}
        onSubmit={handleSubmit}
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
    </>
  );
}

function formatDayHeader(key: string): string {
  if (key === dateKey(new Date())) return "今天";
  const d = new Date(key);
  const today = new Date();
  const diff = Math.round(
    (d.getTime() - today.getTime()) / 86_400_000,
  );
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  return d.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
