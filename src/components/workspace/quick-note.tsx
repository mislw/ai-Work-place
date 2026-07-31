"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDataStore } from "@/lib/stores/data";
import { createNote } from "@/lib/data/notes";
import { useDebouncedEffect } from "@/hooks/use-debounced-effect";
import { useRouter } from "next/navigation";
import Link from "next/link";

type SaveState = "idle" | "saving" | "saved" | "error";

export function QuickNoteCard() {
  const { user } = useAuth();
  const router = useRouter();
  const upsertNote = useDataStore((s) => s.upsertNote);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);

  // 自动保存草稿：停笔 1.2s 后保存
  useDebouncedEffect(
    async () => {
      if (!user) return;
      if (!title.trim() && !content.trim()) return;
      if (draftId) return; // 草稿已存在不重复保存
      setSaveState("saving");
      try {
        const note = await createNote(user.id, {
          title: title.trim() || "无标题",
          content,
          tags: ["快速笔记"],
        });
        upsertNote(note);
        setDraftId(note.id);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    1200,
    [title, content, draftId, user],
  );

  async function handleSubmit() {
    if (!user) return;
    if (!title.trim() && !content.trim()) {
      toast.error("请输入标题或正文");
      return;
    }
    setBusy(true);
    try {
      const note = await createNote(user.id, {
        title: title.trim() || "无标题",
        content,
        tags: ["快速笔记"],
      });
      upsertNote(note);
      setTitle("");
      setContent("");
      setDraftId(null);
      setSaveState("idle");
      toast.success("已保存到笔记");
      router.push(`/notes/${note.id}`);
    } catch {
      toast.error("保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>快速笔记</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SaveIndicator state={saveState} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（选填）"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="记下你刚才想到的、看到的、决定的……"
          rows={5}
        />
        <div className="flex items-center justify-between">
          <SaveBadge state={saveState} draftId={draftId} />
          <Button onClick={handleSubmit} disabled={busy} size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存并打开
          </Button>
        </div>
        <div className="pt-2 text-right">
          <Link
            href="/notes"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            查看全部笔记 →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> 正在保存
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1 text-success">
        <Check className="h-3 w-3" /> 已保存
      </span>
    );
  if (state === "error") return <span className="text-destructive">保存失败</span>;
  return null;
}

function SaveBadge({ state, draftId }: { state: SaveState; draftId: string | null }) {
  if (!draftId && state === "idle")
    return <span className="text-xs text-muted-foreground">停笔会自动保存草稿</span>;
  return null;
}
