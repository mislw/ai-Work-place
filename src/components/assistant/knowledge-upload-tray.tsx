"use client";

import { KnowledgeFileCard } from "@/components/assistant/knowledge-file-card";
import type { KnowledgeUploadItem } from "@/hooks/use-knowledge-uploads";

export function KnowledgeUploadTray(props: {
  items: KnowledgeUploadItem[];
  onToggleProposal: (localId: string, proposalId: string) => void;
  onConfirm: (localId: string, proposalIds: string[]) => void;
  onRetry: (localId: string) => void;
  onDelete: (localId: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="mb-2 max-h-[42svh] space-y-2 overflow-y-auto pr-1">
      {props.items.map((item) => (
        <KnowledgeFileCard
          key={item.localId}
          item={item}
          onToggleProposal={props.onToggleProposal}
          onConfirm={props.onConfirm}
          onRetry={props.onRetry}
          onDelete={props.onDelete}
        />
      ))}
    </div>
  );
}
