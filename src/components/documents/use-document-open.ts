"use client";

import { useCallback } from "react";
import { markOpened } from "@/lib/data/documents";
import { useDataStore } from "@/lib/stores/data";

/** 点击打开文档时同时上报 last_opened_at（用于"最近使用"排序）。 */
export function useDocumentOpen() {
  const documents = useDataStore((s) => s.documents);
  const upsertDocument = useDataStore((s) => s.upsertDocument);

  const openDocument = useCallback(
    async (id: string) => {
      const existing = documents.find((d) => d.id === id);
      const now = new Date().toISOString();
      if (existing) {
        upsertDocument({ ...existing, last_opened_at: now, updated_at: now });
      }
      try {
        await markOpened(id);
      } catch {
        // 最近使用时间是辅助信息，失败不阻断打开文档
      }
    },
    [documents, upsertDocument],
  );

  return { openDocument };
}
