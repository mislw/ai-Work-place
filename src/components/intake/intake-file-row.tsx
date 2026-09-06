"use client";

import { AlertCircle, CheckCircle2, FileText, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export function IntakeFileRow(props: {
  name: string;
  state: string;
  progress?: number;
  error?: string | null;
}) {
  const failed = props.state === "failed" || Boolean(props.error);
  const complete = ["ready", "completed", "undone", "cancelled"].includes(props.state);
  const Icon = failed ? AlertCircle : complete ? CheckCircle2 : LoaderCircle;
  return (
    <div className="min-w-0 border-b border-border/70 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.name}</span>
        <Badge variant={failed ? "destructive" : complete ? "success" : "secondary"}>
          <Icon className={complete || failed ? "mr-1 h-3 w-3" : "mr-1 h-3 w-3 animate-spin"} />
          {fileStateLabel(props.state)}
        </Badge>
      </div>
      {typeof props.progress === "number" && !complete ? (
        <Progress className="mt-2" value={props.progress} />
      ) : null}
      {props.error ? <p className="mt-1 text-xs text-destructive">{props.error}</p> : null}
    </div>
  );
}

function fileStateLabel(state: string) {
  const labels: Record<string, string> = {
    waiting: "等待上传",
    uploading: "上传中",
    queued: "等待解析",
    extracting: "解析中",
    analyzing: "分析中",
    ready: "已就绪",
    needs_attention: "需确认",
    waiting_extraction: "等待解析",
    awaiting_hermes: "等待 Hermes",
    orchestrating: "Hermes 判断中",
    executing: "写入中",
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
    cancelled: "已取消",
    undone: "已撤销",
  };
  return labels[state] ?? state;
}
