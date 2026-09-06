"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_KNOWLEDGE_BATCH_FILES,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_UPLOAD_CONCURRENCY,
} from "@/lib/knowledge/contracts";
import type { WorkspacePageContextV1 } from "@/lib/intake/contracts";

export type KnowledgeUploadState =
  | "waiting"
  | "uploading"
  | "queued"
  | "extracting"
  | "analyzing"
  | "ready"
  | "needs_attention"
  | "failed";

export interface KnowledgeProposalView {
  id: string;
  kind: "archive" | "note" | "todo" | "calendar";
  title: string;
  status: "pending" | "confirmed" | "rejected";
  payload?: Record<string, unknown>;
}

export interface KnowledgeUploadDetail {
  summary: string | null;
  suggestedCollection: string | null;
  sourceUrl: string;
  proposals: KnowledgeProposalView[];
}

export interface KnowledgeUploadItem {
  localId: string;
  file: File;
  state: KnowledgeUploadState;
  progress: number;
  assetId?: string;
  documentId?: string;
  jobId?: string;
  error?: string;
  detail?: KnowledgeUploadDetail;
  selectedProposalIds: Set<string>;
  intake?: KnowledgeUploadIntake;
}

export interface KnowledgeUploadIntake {
  clientBatchId: string;
  pageContext: WorkspacePageContextV1;
}

export interface KnowledgeUploadCallbacks {
  onConfirmed?: (item: KnowledgeUploadItem) => void;
  onDurable?: (item: KnowledgeUploadItem) => void;
  onInterrupted?: (item: KnowledgeUploadItem) => void;
  onCancelIntake?: (item: KnowledgeUploadItem) => void | Promise<void>;
}

export function useKnowledgeUploads(options?: KnowledgeUploadCallbacks) {
  const [items, setItems] = useState<KnowledgeUploadItem[]>([]);
  const itemsRef = useRef<KnowledgeUploadItem[]>([]);
  const callbacks = useRef(options);
  const uploading = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const disposed = useRef(false);
  callbacks.current = options;
  itemsRef.current = items;

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      for (const item of itemsRef.current) {
        if (
          item.intake &&
          !item.assetId &&
          ["waiting", "uploading"].includes(item.state)
        ) {
          callbacks.current?.onInterrupted?.(item);
        }
      }
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  const updateItem = useCallback(
    (localId: string, update: Partial<KnowledgeUploadItem>) => {
      if (disposed.current) return;
      setItems((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, ...update } : item,
        ),
      );
    },
    [],
  );

  const pollItem = useCallback(
    (localId: string, documentId: string, delay = 400) => {
      const previous = timers.current.get(localId);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(async () => {
        timers.current.delete(localId);
        try {
          const response = await fetch(`/api/knowledge/items/${documentId}`, {
            cache: "no-store",
          });
          const body = (await response.json()) as {
            item?: Record<string, unknown>;
            error?: { message?: string };
          };
          if (!response.ok || !body.item) {
            throw new Error(body.error?.message ?? "读取分析进度失败");
          }
          const item = body.item;
          const state = stateFromItem(item);
          const proposals = readProposals(item.proposals);
          updateItem(localId, {
            state,
            progress: progressFromItem(item, state),
            error: readNullableText(item.errorCode) ?? undefined,
            detail:
              state === "ready" || state === "needs_attention"
                ? {
                    summary: readNullableText(item.summary),
                    suggestedCollection: readSuggestedCollection(proposals),
                    sourceUrl: readNullableText(item.sourceUrl) ?? "",
                    proposals,
                  }
                : undefined,
            selectedProposalIds: new Set(
              proposals
                .filter((proposal) => proposal.status === "pending")
                .map((proposal) => proposal.id),
            ),
          });
          if (["queued", "extracting", "analyzing"].includes(state)) {
            pollItem(localId, documentId, Math.min(delay * 1.7, 5_000));
          }
        } catch (error) {
          updateItem(localId, { state: "failed", error: readError(error) });
        }
      }, delay);
      timers.current.set(localId, timer);
    },
    [updateItem],
  );

  const uploadItem = useCallback(
    async (item: KnowledgeUploadItem) => {
      try {
        const form = new FormData();
        form.set("file", item.file);
        const response = await fetch("/api/knowledge/uploads", {
          method: "POST",
          headers: { "Idempotency-Key": item.localId },
          body: form,
        });
        const body = (await response.json()) as {
          assetId?: string;
          documentId?: string;
          jobId?: string;
          error?: { message?: string };
        };
        if (!response.ok || !body.assetId || !body.documentId || !body.jobId) {
          throw new Error(body.error?.message ?? "知识文件上传失败");
        }
        const durableItem: KnowledgeUploadItem = {
          ...item,
          state: "queued",
          progress: 5,
          assetId: body.assetId,
          documentId: body.documentId,
          jobId: body.jobId,
        };
        updateItem(item.localId, durableItem);
        callbacks.current?.onDurable?.(durableItem);
        pollItem(item.localId, body.documentId);
      } catch (error) {
        updateItem(item.localId, { state: "failed", error: readError(error) });
      } finally {
        uploading.current.delete(item.localId);
        if (!disposed.current) setItems((current) => [...current]);
      }
    },
    [pollItem, updateItem],
  );

  useEffect(() => {
    const slots = MAX_KNOWLEDGE_UPLOAD_CONCURRENCY - uploading.current.size;
    if (slots <= 0) return;
    const waiting = items
      .filter(
        (item) => item.state === "waiting" && !uploading.current.has(item.localId),
      )
      .slice(0, slots);
    if (waiting.length === 0) return;
    for (const item of waiting) uploading.current.add(item.localId);
    setItems((current) =>
      current.map((item) =>
        uploading.current.has(item.localId) && item.state === "waiting"
          ? { ...item, state: "uploading", progress: 2 }
          : item,
      ),
    );
    for (const item of waiting) void uploadItem(item);
  }, [items, uploadItem]);

  const addFiles = useCallback((
    files: File[] | FileList,
    intake?: KnowledgeUploadIntake,
  ) => {
    const candidates = Array.from(files).slice(0, MAX_KNOWLEDGE_BATCH_FILES);
    const next = candidates.map((file): KnowledgeUploadItem => {
      const validationError = validateFile(file);
      return {
        localId: createLocalId(),
        file,
        state: validationError ? "failed" : "waiting",
        progress: 0,
        error: validationError ?? undefined,
        selectedProposalIds: new Set(),
        ...(intake ? { intake } : {}),
      };
    });
    setItems((current) => [...current, ...next]);
  }, []);

  const toggleProposal = useCallback((localId: string, proposalId: string) => {
    setItems((current) =>
      current.map((item) => {
        if (item.localId !== localId) return item;
        const selected = new Set(item.selectedProposalIds);
        if (selected.has(proposalId)) selected.delete(proposalId);
        else selected.add(proposalId);
        return { ...item, selectedProposalIds: selected };
      }),
    );
  }, []);

  const confirm = useCallback(
    async (localId: string, proposalIds?: string[]) => {
      const item = items.find((candidate) => candidate.localId === localId);
      if (!item) return;
      const selected = proposalIds ?? [...item.selectedProposalIds];
      if (selected.length === 0) return;
      const response = await fetch("/api/knowledge/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalIds: selected }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "确认知识建议失败");
      setItems((current) =>
        current.map((candidate) =>
          candidate.localId === localId && candidate.detail
            ? {
                ...candidate,
                detail: {
                  ...candidate.detail,
                  proposals: candidate.detail.proposals.map((proposal) =>
                    selected.includes(proposal.id)
                      ? { ...proposal, status: "confirmed" as const }
                      : proposal,
                  ),
                },
                selectedProposalIds: new Set<string>(),
              }
            : candidate,
        ),
      );
      callbacks.current?.onConfirmed?.(item);
    },
    [items],
  );

  const retry = useCallback((localId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.localId === localId
          ? {
              ...item,
              state: "waiting",
              progress: 0,
              error: undefined,
              assetId: undefined,
              documentId: undefined,
              jobId: undefined,
              detail: undefined,
              selectedProposalIds: new Set<string>(),
            }
          : item,
      ),
    );
  }, []);

  const remove = useCallback(
    async (localId: string) => {
      const item = items.find((candidate) => candidate.localId === localId);
      if (!item) return;
      const timer = timers.current.get(localId);
      if (timer) clearTimeout(timer);
      timers.current.delete(localId);
      if (item.intake) {
        if (item.assetId) await callbacks.current?.onCancelIntake?.(item);
        else callbacks.current?.onInterrupted?.(item);
      } else if (item.assetId) {
        const response = await fetch(
          `/api/knowledge/assets/${item.assetId}?confirmed=true`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("删除知识文件失败");
      }
      setItems((current) => current.filter((candidate) => candidate.localId !== localId));
    },
    [items],
  );

  return { items, addFiles, toggleProposal, confirm, retry, remove };
}

function validateFile(file: File) {
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) return "单个文件不能超过 50 MB";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "docx", "md", "markdown", "txt", "png", "jpg", "jpeg", "webp"].includes(extension)) {
    return "仅支持 PDF、DOCX、Markdown、文本和常见图片";
  }
  return null;
}

function stateFromItem(item: Record<string, unknown>): KnowledgeUploadState {
  const status = String(item.status ?? "");
  const stage = String(item.stage ?? "");
  if (status === "ready") return "ready";
  if (status === "needs_attention") return "needs_attention";
  if (status === "failed" || stage === "failed") return "failed";
  if (stage === "analyzing") return "analyzing";
  if (stage === "extracting" || stage === "chunking") return "extracting";
  return "queued";
}

function progressFromItem(item: Record<string, unknown>, state: KnowledgeUploadState) {
  if (typeof item.progress === "number") return item.progress;
  const progress: Record<KnowledgeUploadState, number> = {
    waiting: 0,
    uploading: 2,
    queued: 5,
    extracting: 45,
    analyzing: 75,
    ready: 100,
    needs_attention: 100,
    failed: 0,
  };
  return progress[state];
}

function readProposals(value: unknown): KnowledgeProposalView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((proposal) => {
    if (!isRecord(proposal) || typeof proposal.id !== "string") return [];
    const kind = String(proposal.kind) as KnowledgeProposalView["kind"];
    if (!["archive", "note", "todo", "calendar"].includes(kind)) return [];
    return [{
      id: proposal.id,
      kind,
      title: readNullableText(proposal.title) ?? "未命名建议",
      status: String(proposal.status) as KnowledgeProposalView["status"],
      payload: isRecord(proposal.payload) ? proposal.payload : {},
    }];
  });
}

function readSuggestedCollection(proposals: KnowledgeProposalView[]) {
  const archive = proposals.find((proposal) => proposal.kind === "archive");
  if (!archive) return null;
  const name = archive.payload?.collectionName;
  return typeof name === "string" && name.trim() ? name.trim() : archive.title;
}

function createLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? `upload-${Date.now()}-${Math.random()}`;
}

function readNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "知识文件处理失败";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
