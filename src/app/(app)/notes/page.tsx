"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pin, Plus, Search, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { useDataStore } from "@/lib/stores/data";
import { useAuth } from "@/hooks/use-auth";
import { createNote, deleteNote, togglePin } from "@/lib/data/notes";
import { NewNoteDialog } from "@/components/notes/new-note-dialog";

export default function NotesPage() {
  const { user } = useAuth();
  const notes = useDataStore((s) => s.notes);
  const upsertNote = useDataStore((s) => s.upsertNote);
  const removeNote = useDataStore((s) => s.removeNote);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        return b.updated_at.localeCompare(a.updated_at);
      });
  }, [notes, search]);

  async function handleCreate(values: { title: string; tags: string[] }) {
    if (!user) return;
    const note = await createNote(user.id, {
      title: values.title,
      content: "",
      tags: values.tags,
    });
    upsertNote(note);
    setOpen(false);
    toast.success("已创建");
  }

  async function handlePin(id: string, pinned: boolean) {
    const original = notes.find((n) => n.id === id);
    if (!original) return;
    const optimistic = { ...original, is_pinned: pinned };
    upsertNote(optimistic);
    try {
      const updated = await togglePin(id, pinned);
      upsertNote(updated);
    } catch {
      upsertNote(original);
      toast.error("操作失败");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete;
    const snap = notes.find((n) => n.id === id);
    removeNote(id);
    setPendingDelete(null);
    try {
      await deleteNote(id);
      toast.success("已删除");
    } catch {
      if (snap) upsertNote(snap);
      toast.error("删除失败");
    }
  }

  return (
    <div data-crayon-page="notes" className="crayon-page">
      <PageHeader
        title="笔记"
        description="记录想法、想法、想法。手机电脑自动同步。"
        actions={
          <Button
            onClick={() => setOpen(true)}
          >
            <Plus className="h-4 w-4" /> 新建笔记
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索标题 / 正文 / 标签"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={search ? "没有匹配的笔记" : "还没有笔记"}
            description={
              search ? "换个关键词试试。" : "点击右上角新建第一篇笔记。"
            }
            action={
              !search ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" /> 新建笔记
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((n) => (
              <Card key={n.id} className="hover:bg-muted/40">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <Link
                      href={`/notes/${n.id}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        {n.is_pinned ? (
                          <Pin className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : null}
                        <h3 className="truncate text-sm font-medium">
                          {n.title || "无标题"}
                        </h3>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {n.content.slice(0, 160) || "（无正文）"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {n.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary" className="px-1.5 py-0">
                            {t}
                          </Badge>
                        ))}
                        <span className="ml-1">
                          更新于 {new Date(n.updated_at).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={n.is_pinned ? "取消置顶" : "置顶"}
                        onClick={() => handlePin(n.id, !n.is_pinned)}
                      >
                        <Pin
                          className={
                            n.is_pinned
                              ? "h-3.5 w-3.5 text-foreground"
                              : "h-3.5 w-3.5"
                          }
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="删除"
                        onClick={() => setPendingDelete(n.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <NewNoteDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={handleCreate}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="删除笔记？"
        description="删除后无法恢复。"
        confirmText="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
