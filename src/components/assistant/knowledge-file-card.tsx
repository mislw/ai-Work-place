"use client";

import {
  CalendarDays,
  CheckSquare,
  FileText,
  FolderInput,
  Image,
  Loader2,
  RefreshCw,
  StickyNote,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import type { KnowledgeUploadItem } from "@/hooks/use-knowledge-uploads";

export function KnowledgeFileCard(props: {
  item: KnowledgeUploadItem;
  onToggleProposal: (localId: string, proposalId: string) => void;
  onConfirm: (localId: string, proposalIds: string[]) => void;
  onRetry: (localId: string) => void;
  onDelete: (localId: string) => void;
}) {
  const { item } = props;
  const FileIcon = item.file.type.startsWith("image/") ? Image : FileText;
  const active = ["waiting", "uploading", "queued", "extracting", "analyzing"].includes(
    item.state,
  );
  return (
    <div
      data-testid="knowledge-file-card"
      className="min-h-[168px] min-w-0 overflow-hidden rounded-md border border-border bg-card p-3"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.file.name}>
            {item.file.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{stateLabel(item.state)}</p>
        </div>
        {active ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" /> : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`删除 ${item.file.name}`}
          title="删除"
          onClick={() => props.onDelete(item.localId)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {active ? <Progress className="mt-3" value={item.progress} /> : null}
      {item.error ? <p className="mt-3 text-xs text-destructive">{item.error}</p> : null}

      {item.detail ? (
        <div className="mt-3 border-t border-border pt-3">
          {item.detail.summary ? (
            <p className="text-sm leading-6 text-foreground">{item.detail.summary}</p>
          ) : null}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <FolderInput className="h-3.5 w-3.5" />
            建议归档：{item.detail.suggestedCollection ?? "稍后选择"}
          </p>
          {item.detail.proposals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {item.detail.proposals.map((proposal) => {
                const Icon = proposalIcon(proposal.kind);
                return (
                  <label
                    key={proposal.id}
                    className="flex min-w-0 items-center gap-2 text-xs"
                  >
                    <Checkbox
                      aria-label={proposal.title}
                      checked={item.selectedProposalIds.has(proposal.id)}
                      disabled={proposal.status !== "pending"}
                      onCheckedChange={() =>
                        props.onToggleProposal(item.localId, proposal.id)
                      }
                    />
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`重试 ${item.file.name}`}
              onClick={() => props.onRetry(item.localId)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
            <Button
              size="sm"
              aria-label="确认归档和操作"
              disabled={item.selectedProposalIds.size === 0}
              onClick={() =>
                props.onConfirm(item.localId, [...item.selectedProposalIds])
              }
            >
              确认
            </Button>
          </div>
        </div>
      ) : item.state === "failed" ? (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            aria-label={`重试 ${item.file.name}`}
            onClick={() => props.onRetry(item.localId)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function stateLabel(state: KnowledgeUploadItem["state"]) {
  return {
    waiting: "等待上传",
    uploading: "正在上传",
    queued: "已进入整理队列",
    extracting: "正在识别和提取",
    analyzing: "正在分析归档建议",
    ready: "分析完成",
    needs_attention: "已提取，需要确认",
    failed: "处理失败",
  }[state];
}

function proposalIcon(kind: "archive" | "note" | "todo" | "calendar") {
  if (kind === "todo") return CheckSquare;
  if (kind === "calendar") return CalendarDays;
  if (kind === "note") return StickyNote;
  return FolderInput;
}
