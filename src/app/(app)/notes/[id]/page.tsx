"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pin, Trash2, Download, Sparkles, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useDataStore } from "@/lib/stores/data";
import { useDebouncedEffect } from "@/hooks/use-debounced-effect";
import { getNote, saveNote, deleteNote } from "@/lib/data/notes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCollectionRealtime } from "@/hooks/use-realtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AiSuggestionDialog } from "@/components/ai/ai-suggestion-dialog";
import type { Note, AiSuggestion } from "@/types/domain";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export default function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user } = useAuth();
  const upsertNote = useDataStore((s) => s.upsertNote);
  const removeNote = useDataStore((s) => s.removeNote);
  const upsertTodo = useDataStore((s) => s.upsertTodo);
  const notes = useDataStore((s) => s.notes);

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [remoteNote, setRemoteNote] = useState<Note | null>(null);
  const initialLoaded = useRef(false);

  // 初次加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const n = await getNote(id);
        if (cancelled) return;
        if (!n) {
          setError("笔记不存在或已被删除");
          setLoading(false);
          return;
        }
        setNote(n);
        setTitle(n.title);
        setContent(n.content);
        setTagsInput(n.tags.join(", "));
        setLoading(false);
        initialLoaded.current = true;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 同步 store 中的笔记（其它端更新后通过 Realtime 已写入 store）
  useEffect(() => {
    if (!initialLoaded.current) return;
    const fromStore = notes.find((n) => n.id === id);
    if (!fromStore) return;
    if (
      fromStore.updated_at === note?.updated_at &&
      fromStore.version === note?.version
    ) {
      return;
    }
    // 本地正在编辑时不直接覆盖；记录到 remoteNote 提供冲突选择
    if (saveState === "saving") return;
    if (
      fromStore.version > (note?.version ?? 0) &&
      (fromStore.content !== content || fromStore.title !== title)
    ) {
      setRemoteNote(fromStore);
      setSaveState("conflict");
    } else {
      setNote(fromStore);
    }
  }, [notes, id, note, content, title, saveState]);

  // 实时订阅：仅当本端没有正在编辑时接收
  useCollectionRealtime({
    table: "notes",
    onChange: (payload) => {
      if (payload.eventType === "DELETE" && (payload.old as { id?: string }).id === id) {
        router.replace("/notes");
        toast.message("该笔记已被其他端删除");
      }
    },
  });

  // 自动保存：1200ms debounce
  useDebouncedEffect(
    async () => {
      if (!note) return;
      if (saveState === "conflict") return;
      if (
        note.title === title &&
        note.content === content &&
        note.tags.join(",") === tagsInput.split(/[,，]/).map((s) => s.trim()).filter(Boolean).join(",")
      ) {
        return;
      }
      setSaveState("saving");
      try {
        const tags = tagsInput
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const updated = await saveNote(note.id, note.version, {
          title,
          content,
          tags,
        });
        setNote(updated);
        upsertNote(updated);
        setSaveState("saved");
        setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (e) {
        if (e instanceof Error && e.message === "CONFLICT") {
          // 重新拉取远端
          const remote = await getNote(note.id);
          if (remote && remote.version > note.version) {
            setRemoteNote(remote);
            setSaveState("conflict");
            return;
          }
        }
        setSaveState("error");
      }
    },
    1200,
    [title, content, tagsInput, note, saveState, upsertNote],
  );

  // 离开页面：尝试 flush
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (note && (title !== note.title || content !== note.content)) {
        navigator.sendBeacon?.(
          "/api/notes/flush",
          new Blob(
            [
              JSON.stringify({
                id: note.id,
                version: note.version,
                title,
                content,
                tags: tagsInput
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            ],
            { type: "application/json" },
          ),
        );
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [note, title, content, tagsInput]);

  async function handlePin() {
    if (!note) return;
    const next = !note.is_pinned;
    const optimistic = { ...note, is_pinned: next };
    setNote(optimistic);
    upsertNote(optimistic);
    try {
      const updated = await saveNote(note.id, note.version, {
        is_pinned: next,
      });
      setNote(updated);
      upsertNote(updated);
    } catch {
      setNote(note);
      upsertNote(note);
      toast.error("操作失败");
    }
  }

  async function handleDelete() {
    if (!note) return;
    setPendingDelete(true);
    try {
      await deleteNote(note.id);
      removeNote(note.id);
      toast.success("已删除");
      router.replace("/notes");
    } catch {
      toast.error("删除失败");
    } finally {
      setPendingDelete(false);
    }
  }

  function exportAs(format: "md" | "txt") {
    if (!note) return;
    const body = format === "md" ? contentToMarkdown(title, content) : `${title}\n\n${content}`;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "未命名笔记"}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyAs(format: "md" | "txt") {
    if (!note) return;
    const body = format === "md" ? contentToMarkdown(title, content) : `${title}\n\n${content}`;
    try {
      await navigator.clipboard.writeText(body);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  }

  // AI 功能
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ summary?: string; content?: string } | null>(null);
  const [aiTodo, setAiTodo] = useState<AiSuggestion | null>(null);

  async function callAI(action: "summarize_note" | "polish_note" | "extract_actions") {
    if (!user) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          context: { content: `${title}\n\n${content}` },
        }),
      });
      const data = (await res.json()) as { content?: string; error?: { code: string; message: string } };
      if (!res.ok) {
        toast.error(data.error?.message ?? "AI 请求失败");
        return;
      }
      const out = data.content ?? "";
      if (action === "summarize_note") {
        setAiPreview({ summary: out });
      } else if (action === "polish_note") {
        setAiPreview({ content: out });
      } else {
        try {
          const json = extractJson(out);
          const arr = JSON.parse(json) as AiSuggestion["todos"];
          if (Array.isArray(arr) && arr.length > 0) {
            setAiTodo({ todos: arr });
          } else {
            toast.message("没有识别到行动项");
          }
        } catch {
          toast.error("无法解析 AI 返回的 JSON");
        }
      }
    } catch {
      toast.error("网络异常");
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (error || !note) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "笔记不存在"}</p>
        <Button asChild variant="link">
          <Link href="/notes">返回笔记列表</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-3 flex items-center gap-2">
          <Button asChild variant="ghost" size="icon-sm" aria-label="返回">
            <Link href="/notes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <SaveBadge state={saveState} version={note?.version ?? 1} />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="置顶"
              onClick={handlePin}
            >
              <Pin
                className={
                  note.is_pinned ? "h-4 w-4 text-foreground" : "h-4 w-4"
                }
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="导出">
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAs("md")}>
                  导出为 Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("txt")}>
                  导出为 TXT
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyAs("md")}>
                  复制为 Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyAs("txt")}>
                  复制为纯文本
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="删除"
              onClick={() => setPendingDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题"
          className="border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
        />
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>AI：</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => callAI("summarize_note")}
            disabled={aiBusy}
          >
            总结
          </Button>
          <span>·</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => callAI("polish_note")}
            disabled={aiBusy}
          >
            润色
          </Button>
          <span>·</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => callAI("extract_actions")}
            disabled={aiBusy}
          >
            提取行动项
          </Button>
        </div>
        <Separator className="my-3" />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          placeholder="开始记录你的想法…"
          className="min-h-[60vh] resize-y border-none p-0 font-sans text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
        />
        <Separator className="my-4" />
        <div>
          <label className="text-xs text-muted-foreground">标签（逗号分隔）</label>
          <Input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="例如：产品, 周报"
            className="mt-1"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {tagsInput
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
          </div>
        </div>

        {aiPreview?.summary ? (
          <Card className="mt-4 border-dashed p-3 text-sm">
            <div className="text-xs font-semibold text-muted-foreground">
              AI 总结预览
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {aiPreview.summary}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setNote((n) => (n ? { ...n, summary: aiPreview.summary! } : n));
                setAiPreview(null);
                toast.success("已写入 summary 字段");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> 写入总结
            </Button>
          </Card>
        ) : null}
        {aiPreview?.content ? (
          <Card className="mt-4 border-dashed p-3 text-sm">
            <div className="text-xs font-semibold text-muted-foreground">
              AI 润色预览
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {aiPreview.content}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setContent(aiPreview.content!);
                  setAiPreview(null);
                  toast.success("已替换正文");
                }}
              >
                应用到正文
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAiPreview(null)}
              >
                取消
              </Button>
            </div>
          </Card>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="删除笔记？"
        description="此操作不可撤销。"
        confirmText="删除"
        destructive
        onConfirm={handleDelete}
      />
      <AiSuggestionDialog
        open={!!aiTodo}
        onOpenChange={(o) => !o && setAiTodo(null)}
        suggestion={aiTodo}
        loading={aiBusy}
        onConfirm={async () => {
          if (!user || !aiTodo) return;
          try {
            const { createTodo } = await import("@/lib/data/todos");
            for (const t of aiTodo.todos) {
              const created = await createTodo(user.id, {
                title: t.title,
                description: t.description ?? null,
                priority: t.priority ?? "medium",
                due_date: t.due_date ?? null,
                due_time: null,
              });
              upsertTodo(created);
            }
            setAiTodo(null);
            toast.success(`已创建 ${aiTodo.todos.length} 个待办`);
          } catch {
            toast.error("创建失败");
          }
        }}
      />

      <ConflictDialog
        open={saveState === "conflict" && !!remoteNote}
        local={{ title, content }}
        remote={remoteNote}
        onKeepLocal={async () => {
          if (!remoteNote) return;
          // 以本地覆盖远端，强制使用旧的 expected version + 1
          try {
            const updated = await saveNote(remoteNote.id, remoteNote.version, {
              title,
              content,
            });
            setNote(updated);
            upsertNote(updated);
            setRemoteNote(null);
            setSaveState("idle");
            toast.success("已覆盖远端");
          } catch (e) {
            toast.error("覆盖失败");
            setSaveState("error");
          }
        }}
        onUseRemote={() => {
          if (!remoteNote) return;
          setNote(remoteNote);
          setTitle(remoteNote.title);
          setContent(remoteNote.content);
          setTagsInput(remoteNote.tags.join(", "));
          setRemoteNote(null);
          setSaveState("saved");
        }}
      />
    </>
  );
}

function SaveBadge({ state, version }: { state: SaveState; version: number }) {
  if (state === "saving")
    return <span className="text-xs text-muted-foreground">正在保存…</span>;
  if (state === "saved")
    return <span className="text-xs text-success">已保存</span>;
  if (state === "error")
    return <span className="text-xs text-destructive">保存失败</span>;
  if (state === "conflict")
    return (
      <span className="flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="h-3 w-3" /> 远端版本更新
      </span>
    );
  return (
    <span className="text-xs text-muted-foreground">
      v{version} · 自动保存中
    </span>
  );
}

function extractJson(s: string): string {
  const m = s.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  return m?.[1] ?? s;
}

function contentToMarkdown(title: string, content: string): string {
  return `# ${title}\n\n${content}\n`;
}

function ConflictDialog({
  open,
  remote,
  onKeepLocal,
  onUseRemote,
}: {
  open: boolean;
  local: { title: string; content: string };
  remote: Note | null;
  onKeepLocal: () => void;
  onUseRemote: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={() => null}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> 检测到版本冲突
          </DialogTitle>
          <DialogDescription>
            {remote
              ? `云端版本 v${remote.version}（${new Date(remote.updated_at).toLocaleString("zh-CN")}）比本地更新。`
              : ""}
            请选择保留哪一版。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row">
          <Button
            variant="outline"
            onClick={onUseRemote}
            className="w-full sm:w-auto"
          >
            加载云端版本
          </Button>
          <Button onClick={onKeepLocal} className="w-full sm:w-auto">
            保留本地版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
