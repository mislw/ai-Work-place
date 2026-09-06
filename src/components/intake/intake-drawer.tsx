"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  Check,
  ExternalLink,
  FileText,
  ListTodo,
  RotateCcw,
  StickyNote,
  X,
} from "lucide-react";
import { useGlobalFileIntake } from "@/components/intake/global-file-intake-provider";
import { IntakeFileRow } from "@/components/intake/intake-file-row";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { IntakeActionStep, IntakeBatch } from "@/lib/intake/contracts";

export function IntakeDrawer() {
  const intake = useGlobalFileIntake();
  const batch = intake.batches[0];
  const [undoOpen, setUndoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confidence = useMemo(() => averageConfidence(batch), [batch]);

  if (!intake.drawerOpen) return null;
  return (
    <aside
      data-testid="intake-drawer"
      className="fixed bottom-2 right-2 top-2 z-[60] flex w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border bg-card shadow-2xl max-md:bottom-20 max-md:left-2 max-md:right-2 max-md:top-auto max-md:h-[min(78svh,680px)] max-md:w-auto"
      aria-label="Hermes 整理面板"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Hermes 整理</h2>
          <p className="text-xs text-muted-foreground">
            {batch ? `来源：${sourceLabel(batch.pageContext.pageType)}` : "等待文件"}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭整理面板" onClick={() => intake.setDrawerOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pb-5">
          {batch ? (
            <section className="border-b py-3 text-xs text-muted-foreground">
              <p>{formatCapturedAt(batch.pageContext.capturedAt)}</p>
              <p className="mt-1 truncate">{batch.pageContext.route}</p>
            </section>
          ) : null}

          {intake.localUploads.length > 0 ? (
            <section className="border-b py-2">
              {intake.localUploads.map((item) => (
                <IntakeFileRow key={item.localId} name={item.file.name} state={item.state} progress={item.progress} error={item.error} />
              ))}
            </section>
          ) : null}

          {batch ? (
            <>
              <section className="border-b py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{hermesStateLabel(batch)}</p>
                  <Badge variant={statusVariant(batch.status)}>{batchStatusLabel(batch.status)}</Badge>
                </div>
                {batch.items.map((item) => (
                  <IntakeFileRow key={item.id} name={`知识文件 ${item.documentId.slice(0, 8)}`} state={item.status} error={item.errorCode} />
                ))}
              </section>

              <section className="border-b py-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">整理结果</h3>
                  {confidence !== null ? <span className="text-xs">置信度 {Math.round(confidence * 100)}%</span> : null}
                </div>
                <p className="mt-2 text-sm leading-6">{batch.summary ?? batch.items[0]?.decisionSummary ?? "等待 Hermes 生成整理结果"}</p>
                {hasUndoConflict(batch) ? (
                  <p className="mt-2 text-sm font-medium text-warning">记录已被你修改，未删除</p>
                ) : null}
              </section>

              <section className="border-b py-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">操作回执</h3>
                <div className="space-y-2">
                  {batch.items.flatMap((item) => item.steps).map((step) => (
                    <ReceiptRow key={step.id} step={step} />
                  ))}
                  {batch.items.every((item) => item.steps.length === 0) ? (
                    <p className="text-sm text-muted-foreground">尚未执行工作台操作</p>
                  ) : null}
                </div>
              </section>

              <section className="flex flex-wrap gap-2 py-4">
                {["failed", "partial"].includes(batch.status) ? (
                  <Button size="sm" variant="outline" onClick={() => void intake.retry(batch.id)} aria-label="重试失败项">
                    <RotateCcw className="h-4 w-4" />重试失败项
                  </Button>
                ) : null}
                {["uploading", "processing", "orchestrating", "executing"].includes(batch.status) ? (
                  <Button size="sm" variant="outline" onClick={() => void intake.cancel(batch.id)} aria-label="取消整理">
                    <X className="h-4 w-4" />取消整理
                  </Button>
                ) : null}
                {batch.items[0]?.documentId ? (
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/documents?selected=${encodeURIComponent(batch.items[0].documentId)}`}>
                      <ExternalLink className="h-4 w-4" />查看原文件
                    </a>
                  </Button>
                ) : null}
                {["completed", "partial"].includes(batch.status) ? (
                  <Button size="sm" variant="outline" onClick={() => setUndoOpen(true)} aria-label="撤销本批操作">
                    <RotateCcw className="h-4 w-4" />撤销本批操作
                  </Button>
                ) : null}
              </section>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">拖入文件后会在这里显示进度</div>
          )}
        </div>
      </ScrollArea>

      {batch ? (
        <ConfirmDialog
          open={undoOpen}
          onOpenChange={setUndoOpen}
          title="撤销本批操作？"
          description="已被你修改的记录会保留，不会强行删除。"
          confirmText="确认撤销"
          loading={busy}
          onConfirm={() => {
            setBusy(true);
            void intake.undo(batch.id).finally(() => {
              setBusy(false);
              setUndoOpen(false);
            });
          }}
        />
      ) : null}
    </aside>
  );
}

function ReceiptRow({ step }: { step: IntakeActionStep }) {
  const Icon = actionIcon(step.actionName);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{actionLabel(step.actionName)}</span>
      <Check className="h-4 w-4 text-success" aria-hidden />
    </div>
  );
}

function sourceLabel(pageType: IntakeBatch["pageContext"]["pageType"]) {
  return { workspace: "工作台", assistant: "助手", calendar: "日历", todos: "待办", notes: "笔记", documents: "文档", settings: "设置" }[pageType];
}

function hermesStateLabel(batch: IntakeBatch) {
  if (batch.status === "orchestrating") return "Hermes 正在判断放在哪里";
  if (batch.status === "executing") return "正在写入工作台";
  if (batch.status === "processing") return "正在等待文件解析";
  if (batch.status === "undoing") return "正在撤销操作";
  if (batch.status === "completed") return "整理已完成";
  if (batch.status === "failed") return "整理失败";
  if (batch.status === "partial") return "部分操作需要处理";
  if (batch.status === "cancelled") return "整理已取消";
  if (batch.status === "undone") return "本批操作已撤销";
  return "准备整理";
}

function batchStatusLabel(status: IntakeBatch["status"]) {
  const labels: Record<IntakeBatch["status"], string> = { uploading: "上传中", processing: "处理中", orchestrating: "判断中", executing: "写入中", completed: "已完成", partial: "部分完成", failed: "失败", cancelled: "已取消", undoing: "撤销中", undone: "已撤销" };
  return labels[status];
}

function statusVariant(status: IntakeBatch["status"]): "secondary" | "success" | "warning" | "destructive" {
  if (["completed", "undone"].includes(status)) return "success";
  if (["partial", "undoing"].includes(status)) return "warning";
  if (status === "failed") return "destructive";
  return "secondary";
}

function actionLabel(actionName: string) {
  return { archive: "归档文件", "note.create": "创建笔记", "todo.create": "创建待办", "calendar.create": "创建日程", "relation.create": "关联来源" }[actionName] ?? actionName;
}

function actionIcon(actionName: string) {
  if (actionName === "archive") return Archive;
  if (actionName === "note.create") return StickyNote;
  if (actionName === "todo.create") return ListTodo;
  if (actionName === "calendar.create") return CalendarDays;
  return FileText;
}

function averageConfidence(batch: IntakeBatch | undefined) {
  const values = batch?.items.map((item) => item.confidence).filter((value): value is number => value !== null) ?? [];
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function hasUndoConflict(batch: IntakeBatch) {
  return batch.errorCode === "UNDO_RECORD_CHANGED" || batch.items.some((item) => item.steps.some((step) => step.status === "undo_conflict"));
}

function formatCapturedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
