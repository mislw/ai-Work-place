"use client";

import { useState } from "react";
import { ArrowUp, Sparkles, BookOpen, ListChecks, FileText, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDataStore, useUIStore } from "@/lib/stores/data";
import { dateKey } from "@/lib/date";
import { Skeleton } from "@/components/ui/skeleton";
import { AiSuggestionDialog } from "@/components/ai/ai-suggestion-dialog";
import type { AiSuggestion, Todo } from "@/types/domain";
import { useAuth } from "@/hooks/use-auth";

const QUICK = [
  { key: "summarize_notes", label: "总结今日笔记", icon: BookOpen },
  { key: "extract_todos", label: "提取待办", icon: ListChecks },
  { key: "daily_digest", label: "生成工作总结", icon: FileText },
  { key: "plan_day", label: "安排今天", icon: Calendar },
] as const;

export function AiAssistantCard() {
  const { user } = useAuth();
  const aiConfigured = useUIStore((s) => s.aiConfigured);
  const todos = useDataStore((s) => s.todos);
  const notes = useDataStore((s) => s.notes);
  const upsertTodo = useDataStore((s) => s.upsertTodo);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(action: string, context: Record<string, unknown> = {}) {
    setLoading(action);
    setOutput("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, prompt, context }),
      });
      const data = (await res.json()) as {
        content?: string;
        error?: { code: string; message: string };
      };
      if (!res.ok) {
        if (data.error?.code === "AI_NOT_CONFIGURED") {
          toast.error("AI 尚未配置：基础功能仍可使用");
        } else {
          toast.error(data.error?.message ?? "AI 请求失败");
        }
        return;
      }
      const content = data.content ?? "";
      setOutput(content);
      // 待办提取走确认弹窗
      if (action === "extract_todos" || action === "extract_actions") {
        try {
          const json = extractJson(content);
          const arr = parseTodoJson(json);
          if (arr.length > 0) {
            setSuggestion({ todos: arr, raw: content });
          } else {
            toast.message("未在内容中识别到待办");
          }
        } catch {
          toast.error("无法解析 AI 返回的 JSON");
        }
      }
    } catch {
      toast.error("网络异常，请稍后重试");
    } finally {
      setLoading(null);
    }
  }

  async function handleSubmit() {
    if (!prompt.trim()) return;
    await call("free_chat", {});
  }

  async function handleQuick(key: string) {
    const today = dateKey(new Date());
    const todayTodos = todos.filter((t) => t.due_date === today);
    const todayNotes = notes.filter(
      (n) => n.created_at.slice(0, 10) === today,
    );
    if (key === "summarize_notes") {
      await call("summarize_notes", {
        notes: todayNotes.length > 0 ? todayNotes : notes.slice(0, 10),
      });
    } else if (key === "extract_todos") {
      const text = prompt || todayNotes.map((n) => n.content).join("\n\n");
      await call("extract_todos", { text });
    } else if (key === "daily_digest") {
      await call("daily_digest", {
        todos: todayTodos.map((t) => t.title),
        notes: todayNotes.map((n) => n.content.slice(0, 240)),
      });
    } else if (key === "plan_day") {
      await call("plan_day", {
        todos: todayTodos.map((t) => t.title),
        events: useDataStore.getState().events.map((e) => e.title),
      });
    }
  }

  async function confirmSuggestions() {
    if (!user || !suggestion) return;
    setBusy(true);
    try {
      const created: Todo[] = [];
      for (const t of suggestion.todos) {
        const row = {
          user_id: user.id,
          title: t.title,
          description: t.description ?? null,
          priority: t.priority ?? "medium",
          due_date: t.due_date ?? null,
          status: "pending" as const,
        };
        // 复用 createTodo
        const { createTodo } = await import("@/lib/data/todos");
        const todo = await createTodo(user.id, row);
        created.push(todo);
        upsertTodo(todo);
      }
      setSuggestion(null);
      toast.success(`已创建 ${created.length} 个待办`);
    } catch {
      toast.error("部分待办创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <CardTitle>AI 助手</CardTitle>
        </div>
        {!aiConfigured ? (
          <span className="text-xs text-muted-foreground">未配置 AI（基础功能仍可用）</span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">有什么可以帮你？</p>
        <div className="relative">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入问题或任务，按 Enter 发送，Shift+Enter 换行"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={!aiConfigured}
          />
          <Button
            size="icon"
            className="absolute right-2 bottom-2 h-8 w-8"
            onClick={handleSubmit}
            disabled={!aiConfigured || !prompt.trim() || !!loading}
            aria-label="发送"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <Button
              key={q.key}
              variant="outline"
              size="sm"
              onClick={() => handleQuick(q.key)}
              disabled={!aiConfigured || !!loading}
            >
              <q.icon className="h-3.5 w-3.5" />
              {q.label}
            </Button>
          ))}
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : output ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed">
            <pre className="whitespace-pre-wrap font-sans">{output}</pre>
          </div>
        ) : null}
      </CardContent>
      <AiSuggestionDialog
        open={!!suggestion}
        onOpenChange={(o) => !o && setSuggestion(null)}
        suggestion={suggestion}
        loading={busy}
        onConfirm={confirmSuggestions}
      />
    </Card>
  );
}

function extractJson(s: string): string {
  // 取第一个 [ ... ] 或 { ... }
  const m = s.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  return m?.[1] ?? s;
}

function parseTodoJson(raw: string): AiSuggestion["todos"] {
  const data = JSON.parse(raw) as unknown;
  if (Array.isArray(data)) {
    return data.filter((x): x is { title: string } => typeof x === "object" && x !== null && "title" in x);
  }
  if (
    data &&
    typeof data === "object" &&
    "todos" in (data as Record<string, unknown>) &&
    Array.isArray((data as { todos: unknown }).todos)
  ) {
    return ((data as { todos: unknown[] }).todos).filter(
      (x): x is { title: string } => typeof x === "object" && x !== null && "title" in x,
    );
  }
  return [];
}
