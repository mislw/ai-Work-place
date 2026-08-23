// @vitest-environment node
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAssistantOwner,
  getKnowledgeConfig,
  parseKnowledgeUpload,
  storageRemove,
  storagePromote,
  repositoryActivateAsset,
  repositoryMarkAssetRejected,
  repositoryRegisterUpload,
} = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  getKnowledgeConfig: vi.fn(),
  parseKnowledgeUpload: vi.fn(),
  storageRemove: vi.fn(),
  storagePromote: vi.fn(),
  repositoryActivateAsset: vi.fn(),
  repositoryMarkAssetRejected: vi.fn(),
  repositoryRegisterUpload: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  getAssistantOwner,
}));
vi.mock("@/lib/knowledge/config", () => ({ getKnowledgeConfig }));
vi.mock("@/lib/knowledge/storage", () => ({
  KnowledgeStorage: class KnowledgeStorage {
    remove = storageRemove;
    promote = storagePromote;
  },
}));
vi.mock("@/lib/knowledge/upload", () => ({
  KnowledgeUploadError: class KnowledgeUploadError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  parseKnowledgeUpload,
}));
vi.mock("@/lib/knowledge/repository", () => ({
  getKnowledgeRepository: () => ({
    activateAsset: repositoryActivateAsset,
    markAssetRejected: repositoryMarkAssetRejected,
    registerUpload: repositoryRegisterUpload,
  }),
}));

import { AssistantAuthError } from "@/lib/assistant/auth";
import { KnowledgeUploadError } from "@/lib/knowledge/upload";
import { POST } from "@/app/api/knowledge/uploads/route";

function uploadRequest() {
  return new Request("http://localhost/api/knowledge/uploads", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=test",
      "idempotency-key": "upload-request-1",
    },
    body: "--test--\r\n",
  });
}

describe("POST /api/knowledge/uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
    getKnowledgeConfig.mockReturnValue({
      storageRoot: "D:/knowledge",
      maxFileBytes: 50 * 1024 * 1024,
    });
    parseKnowledgeUpload.mockResolvedValue({
      storageKey: "users/owner-1/quarantine/upload-1/upload.md",
      absolutePath: "D:/knowledge/quarantine/upload.md",
      originalName: "Harness.md",
      mimeType: "text/markdown",
      sizeBytes: 128,
      sha256: "a".repeat(64),
      stream: Readable.from("unused"),
    });
    repositoryRegisterUpload.mockResolvedValue({
      assetId: "asset-1",
      documentId: "document-1",
      jobId: "job-1",
      reusedAsset: false,
    });
    storagePromote.mockResolvedValue({
      storageKey: "users/owner-1/assets/2026/08/asset-1/file.md",
      absolutePath: "D:/knowledge/assets/file.md",
    });
  });

  it("rejects unauthenticated uploads", async () => {
    getAssistantOwner.mockRejectedValue(
      new AssistantAuthError(401, "UNAUTHENTICATED", "未登录"),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(401);
    expect(parseKnowledgeUpload).not.toHaveBeenCalled();
  });

  it.each([
    [415 as const, "UNSUPPORTED_FILE" as const],
    [413 as const, "FILE_TOO_LARGE" as const],
  ])("maps upload errors to HTTP %s", async (status, code) => {
    parseKnowledgeUpload.mockRejectedValue(
      new KnowledgeUploadError(status, code, "上传失败"),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "上传失败" },
    });
  });

  it("registers, promotes, and activates a new private asset", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    expect(repositoryRegisterUpload).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ originalName: "Harness.md" }),
      "upload-request-1",
    );
    expect(storagePromote).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner-1", assetId: "asset-1" }),
    );
    expect(repositoryActivateAsset).toHaveBeenCalledWith(
      "owner-1",
      "asset-1",
      "users/owner-1/assets/2026/08/asset-1/file.md",
    );
    expect(await response.json()).toEqual({
      assetId: "asset-1",
      documentId: "document-1",
      jobId: "job-1",
      status: "queued",
    });
  });

  it("removes quarantine data when database registration fails", async () => {
    repositoryRegisterUpload.mockRejectedValue(new Error("database offline"));

    const response = await POST(uploadRequest());

    expect(response.status).toBe(500);
    expect(storageRemove).toHaveBeenCalledWith(
      "users/owner-1/quarantine/upload-1/upload.md",
    );
    expect(storagePromote).not.toHaveBeenCalled();
  });

  it("removes the duplicate upload instead of replacing the existing asset", async () => {
    repositoryRegisterUpload.mockResolvedValue({
      assetId: "asset-existing",
      documentId: "document-2",
      jobId: "job-2",
      reusedAsset: true,
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    expect(storageRemove).toHaveBeenCalledWith(
      "users/owner-1/quarantine/upload-1/upload.md",
    );
    expect(storagePromote).not.toHaveBeenCalled();
    expect(repositoryActivateAsset).not.toHaveBeenCalled();
  });
});
