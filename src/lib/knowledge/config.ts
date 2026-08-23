import { MAX_KNOWLEDGE_FILE_BYTES } from "@/lib/knowledge/contracts";

export interface KnowledgeConfig {
  storageRoot: string;
  maxFileBytes: number;
  workerPollMs: number;
  ocrLanguages: string;
}

export function getKnowledgeConfig(): KnowledgeConfig {
  const storageRoot = process.env.KNOWLEDGE_STORAGE_ROOT?.trim();
  if (!storageRoot) throw new Error("KNOWLEDGE_STORAGE_ROOT is required");

  return {
    storageRoot,
    maxFileBytes: readPositiveInteger(
      process.env.KNOWLEDGE_MAX_FILE_BYTES,
      MAX_KNOWLEDGE_FILE_BYTES,
      MAX_KNOWLEDGE_FILE_BYTES,
    ),
    workerPollMs: readPositiveInteger(
      process.env.KNOWLEDGE_WORKER_POLL_MS,
      1_500,
      60_000,
    ),
    ocrLanguages: process.env.KNOWLEDGE_OCR_LANGUAGES?.trim() || "chi_sim+eng",
  };
}

function readPositiveInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) return fallback;
  return value;
}
