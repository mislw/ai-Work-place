// @vitest-environment node
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAssistantOwner,
  getKnowledgeConfig,
  storageOpenRead,
  storageRemove,
  repositoryCountAssetRelations,
  repositoryFindAsset,
  repositoryMarkAssetDeleted,
} = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  getKnowledgeConfig: vi.fn(),
  storageOpenRead: vi.fn(),
  storageRemove: vi.fn(),
  repositoryCountAssetRelations: vi.fn(),
  repositoryFindAsset: vi.fn(),
  repositoryMarkAssetDeleted: vi.fn(),
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
    openRead = storageOpenRead;
    remove = storageRemove;
  },
}));
vi.mock("@/lib/knowledge/repository", () => ({
  getKnowledgeRepository: () => ({
    countAssetRelations: repositoryCountAssetRelations,
    findAsset: repositoryFindAsset,
    markAssetDeleted: repositoryMarkAssetDeleted,
  }),
}));

import { AssistantAuthError } from "@/lib/assistant/auth";
import {
  DELETE,
  GET,
} from "@/app/api/knowledge/assets/[id]/route";

const context = { params: { id: "asset-1" } };

describe("/api/knowledge/assets/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
    getKnowledgeConfig.mockReturnValue({ storageRoot: "D:/knowledge" });
    repositoryFindAsset.mockResolvedValue({
      id: "asset-1",
      storageKey: "users/owner-1/assets/2026/08/asset-1/file.txt",
      originalName: "私人资料.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      status: "available",
    });
    storageOpenRead.mockResolvedValue({
      sizeBytes: 10,
      stream: Readable.from(Buffer.from("0123456789")),
    });
    repositoryCountAssetRelations.mockResolvedValue(0);
  });

  it("requires the authenticated owner before looking up an asset", async () => {
    getAssistantOwner.mockRejectedValue(
      new AssistantAuthError(401, "UNAUTHENTICATED", "未登录"),
    );

    const response = await GET(
      new Request("http://localhost/api/knowledge/assets/asset-1"),
      context,
    );

    expect(response.status).toBe(401);
    expect(repositoryFindAsset).not.toHaveBeenCalled();
  });

  it("streams an owner-scoped byte range with private cache headers", async () => {
    storageOpenRead.mockResolvedValue({
      sizeBytes: 10,
      stream: Readable.from(Buffer.from("2345")),
    });

    const response = await GET(
      new Request("http://localhost/api/knowledge/assets/asset-1", {
        headers: { range: "bytes=2-5" },
      }),
      context,
    );

    expect(repositoryFindAsset).toHaveBeenCalledWith("owner-1", "asset-1");
    expect(storageOpenRead).toHaveBeenCalledWith(
      "users/owner-1/assets/2026/08/asset-1/file.txt",
      { start: 2, end: 5 },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''",
    );
    expect(await response.text()).toBe("2345");
  });

  it("returns 404 when the owner cannot resolve the asset", async () => {
    repositoryFindAsset.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/knowledge/assets/asset-other"),
      { params: { id: "asset-other" } },
    );

    expect(response.status).toBe(404);
  });

  it("requires explicit confirmation before deleting a related asset", async () => {
    repositoryCountAssetRelations.mockResolvedValue(3);

    const response = await DELETE(
      new Request("http://localhost/api/knowledge/assets/asset-1", {
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      requiresConfirmation: true,
      relationCount: 3,
    });
    expect(repositoryMarkAssetDeleted).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("soft-deletes and removes a related asset after confirmation", async () => {
    repositoryCountAssetRelations.mockResolvedValue(2);

    const response = await DELETE(
      new Request(
        "http://localhost/api/knowledge/assets/asset-1?confirmed=true",
        { method: "DELETE" },
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(repositoryMarkAssetDeleted).toHaveBeenCalledWith(
      "owner-1",
      "asset-1",
    );
    expect(storageRemove).toHaveBeenCalledWith(
      "users/owner-1/assets/2026/08/asset-1/file.txt",
    );
  });
});
