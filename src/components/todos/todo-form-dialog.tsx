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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todoSchema } from "@/lib/schemas";

export interface TodoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  onSubmit: (values: {
    title: string;
    description?: string | null;
    priority: "low" | "medium" | "high";
    due_date?: string | null;
    due_time?: string | null;
  }) => void | Promise<void>;
}

export function TodoFormDialog({
  open,
  onOpenChange,
  defaultDate,
  onSubmit,
}: TodoFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [dueDate, setDueDate] = useState(defaultDate ?? "");
  const [dueTime, setDueTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueDate(defaultDate ?? "");
      setDueTime("");
      setError(null);
    }
  }, [open, defaultDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = todoSchema.safeParse({
      title,
      description: description || null,
      priority,
      due_date: dueDate || null,
      due_time: dueTime || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        priority: parsed.data.priority,
        due_date: parsed.data.due_date ?? null,
        due_time: parsed.data.due_time ?? null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>新建待办</DialogTitle>
            <DialogDescription>填写任务内容与时间</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="title">标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">描述（选填）</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="due_date">日期</Label>
              <Input
                id="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due_time">时间</Label>
              <Input
                id="due_time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>优先级</Label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as typeof priority)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">低</SelectItem>
                <SelectItem value="medium">中</SelectItem>
                <SelectItem value="high">高</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
