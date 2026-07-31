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
import { Switch } from "@/components/ui/switch";
import { eventSchema } from "@/lib/schemas";

export interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  onSubmit: (values: {
    title: string;
    description?: string | null;
    event_date: string;
    start_time?: string | null;
    end_time?: string | null;
    is_all_day: boolean;
  }) => void | Promise<void>;
}

export function EventFormDialog({
  open,
  onOpenChange,
  defaultDate,
  onSubmit,
}: EventFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(defaultDate ?? "");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setDate(defaultDate ?? "");
      setStartTime("");
      setEndTime("");
      setAllDay(false);
      setError(null);
    }
  }, [open, defaultDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = eventSchema.safeParse({
      title,
      description: description || null,
      event_date: date,
      start_time: allDay ? null : startTime || null,
      end_time: allDay ? null : endTime || null,
      is_all_day: allDay,
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
        event_date: parsed.data.event_date,
        start_time: parsed.data.start_time ?? null,
        end_time: parsed.data.end_time ?? null,
        is_all_day: parsed.data.is_all_day ?? false,
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
            <DialogTitle>新建日程</DialogTitle>
            <DialogDescription>填写日程信息</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="event-title">标题</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="event-desc">描述（选填）</Label>
            <Textarea
              id="event-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-date">日期</Label>
              <Input
                id="event-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            {!allDay ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="event-start">开始</Label>
                  <Input
                    id="event-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-end">结束</Label>
                  <Input
                    id="event-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="event-allday" className="text-sm">全天</Label>
            <Switch
              id="event-allday"
              checked={allDay}
              onCheckedChange={setAllDay}
            />
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
