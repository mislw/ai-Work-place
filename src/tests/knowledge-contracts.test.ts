import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_KNOWLEDGE_BATCH_FILES,
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_UPLOAD_CONCURRENCY,
  SUPPORTED_KNOWLEDGE_MIME_TYPES,
  knowledgeItemSchema,
  knowledgeUploadResponseSchema,
} from "@/lib/knowledge/contracts";
import { getKnowledgeConfig } from "@/lib/knowledge/config";

describe("knowledge contracts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a ready item while keeping asset and analysis identities separate", () => {
    const item = knowledgeItemSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      assetId: "22222222-2222-4222-8222-222222222222",
      title: "Harness 方案",
      status: "ready",
      stage: "complete",
      mimeType: "application/pdf",
      originalName: "harness.pdf",
      summary: "接入方案摘要",
      proposals: [],
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:01.000Z",
    });

    expect(item.id).not.toBe(item.assetId);
    expect(item.summary).toBe("接入方案摘要");
  });

  it("validates the upload response returned to the browser", () => {
    expect(
      knowledgeUploadResponseSchema.parse({
        assetId: "22222222-2222-4222-8222-222222222222",
        documentId: "11111111-1111-4111-8111-111111111111",
        jobId: "33333333-3333-4333-8333-333333333333",
        status: "queued",
      }),
    ).toEqual(expect.objectContaining({ status: "queued" }));
  });

  it("exposes conservative phase-one upload limits", () => {
    expect(
      SUPPORTED_KNOWLEDGE_MIME_TYPES.has("application/x-msdownload"),
    ).toBe(false);
    expect(SUPPORTED_KNOWLEDGE_MIME_TYPES.has("application/pdf")).toBe(true);
    expect(MAX_KNOWLEDGE_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_KNOWLEDGE_BATCH_FILES).toBe(20);
    expect(MAX_KNOWLEDGE_UPLOAD_CONCURRENCY).toBe(2);
  });

  it("loads server-only storage and worker settings with bounded defaults", () => {
    vi.stubEnv("KNOWLEDGE_STORAGE_ROOT", "D:/knowledge-test");
    vi.stubEnv("KNOWLEDGE_MAX_FILE_BYTES", "1024");
    vi.stubEnv("KNOWLEDGE_WORKER_POLL_MS", "2500");
    vi.stubEnv("KNOWLEDGE_OCR_LANGUAGES", "chi_sim+eng");

    expect(getKnowledgeConfig()).toEqual({
      storageRoot: "D:/knowledge-test",
      maxFileBytes: 1024,
      workerPollMs: 2500,
      ocrLanguages: "chi_sim+eng",
    });
  });

  it("rejects missing storage configuration", () => {
    vi.stubEnv("KNOWLEDGE_STORAGE_ROOT", "");
    expect(() => getKnowledgeConfig()).toThrow("KNOWLEDGE_STORAGE_ROOT");
  });
});
