"use client";

import { useRef, useState } from "react";
import { Paperclip, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ACCEPTED_FILES =
  "application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,text/markdown,.txt,text/plain,image/png,image/jpeg,image/webp";

export function AssistantComposer(props: {
  draft: string;
  loading: boolean;
  running: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      data-intake-drop-owner
      className={cn(
        "flex min-w-0 items-end gap-2 rounded-md border border-input bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring",
        dragging && "border-primary bg-primary/5",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length > 0) props.onFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label="选择知识文件"
        accept={ACCEPTED_FILES}
        multiple
        onChange={(event) => {
          if (event.target.files?.length) props.onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="添加文件"
        title="添加文件"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <Textarea
        aria-label="消息"
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            props.onSend();
          }
        }}
        rows={1}
        placeholder="说点什么，或者拖入资料让我整理"
        className="max-h-40 min-h-10 min-w-0 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
      />
      {props.running ? (
        <Button size="icon" variant="outline" aria-label="停止" onClick={props.onCancel}>
          <Square className="h-3.5 w-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          size="icon"
          aria-label="发送"
          disabled={!props.draft.trim() || props.loading}
          onClick={props.onSend}
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
