"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface NewNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { title: string; tags: string[] }) => void | Promise<void>;
}

export function NewNoteDialog({
  open,
  onOpenChange,
  onSubmit,
}: NewNoteDialogProps) {
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setTagsInput("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const tags = tagsInput
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      await onSubmit({ title: title.trim(), tags });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>新建笔记</DialogTitle>
            <DialogDescription>先填标题和标签，进入编辑器后再写正文。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="note-title">标题</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-tags">标签（逗号分隔，最多 10 个）</Label>
            <Input
              id="note-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如：产品, 周报, 2026Q3"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
