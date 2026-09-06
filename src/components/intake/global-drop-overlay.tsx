"use client";

import { useEffect, useRef, useState } from "react";
import { FileInput } from "lucide-react";
import { useGlobalFileIntake } from "@/components/intake/global-file-intake-provider";

export function GlobalDropOverlay() {
  const { enqueueFiles } = useGlobalFileIntake();
  const [visible, setVisible] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!isExternalFileDrag(event) || hasLocalOwner(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setVisible(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!isExternalFileDrag(event) || hasLocalOwner(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isExternalFileDrag(event) || hasLocalOwner(event)) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setVisible(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isExternalFileDrag(event) || hasLocalOwner(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setVisible(false);
      if (event.dataTransfer?.files.length) {
        enqueueFiles(event.dataTransfer.files, "file_drop");
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [enqueueFiles]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-2 z-[70] grid place-items-center rounded-md border-2 border-dashed border-[#3c8dce] bg-background/90 backdrop-blur-sm">
      <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
        <FileInput className="h-9 w-9 text-[#3c8dce]" aria-hidden />
        <p className="text-lg font-semibold">交给 Hermes 整理</p>
        <p className="text-sm text-muted-foreground">PDF、DOCX、XLSX、Markdown、文本和常见图片</p>
      </div>
    </div>
  );
}

function isExternalFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function hasLocalOwner(event: DragEvent) {
  return event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement && target.hasAttribute("data-intake-drop-owner"),
    );
}
