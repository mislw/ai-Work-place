"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X } from "lucide-react";
import type { AiSuggestion } from "@/types/domain";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface AiSuggestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: AiSuggestion | null;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function AiSuggestionDialog({
  open,
  onOpenChange,
  suggestion,
  loading,
  onConfirm,
}: AiSuggestionDialogProps) {
  const todos = suggestion?.todos ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI 建议创建以下待办
          </DialogTitle>
          <DialogDescription>
            这些待办不会被自动写入，只有你点击"确认添加"才会创建。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-2">
          {todos.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有可识别的待办。</p>
          ) : (
            <ul className="space-y-2">
              {todos.map((t, idx) => (
                <li
                  key={idx}
                  className="rounded-md border border-border p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-medium">{t.title}</div>
                      {t.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      ) : null}
                    </div>
                    {t.priority ? (
                      <Badge
                        variant={
                          t.priority === "high"
                            ? "destructive"
                            : t.priority === "medium"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {t.priority === "high"
                          ? "高"
                          : t.priority === "medium"
                            ? "中"
                            : "低"}
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            <X className="h-4 w-4" /> 取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading || todos.length === 0}
          >
            <Check className="h-4 w-4" /> 确认添加 {todos.length} 个
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
