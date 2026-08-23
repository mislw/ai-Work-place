// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssistantOwner, listKnowledgeInbox, getKnowledgeItem } = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  listKnowledgeInbox: vi.fn(),
  getKnowledgeItem: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  },
  getAssistantOwner,
}));
vi.mock("@/lib/knowledge/search", () => ({
  listKnowledgeInbox,
  getKnowledgeItem,
}));

import { GET as getInbox } from "@/app/api/knowledge/inbox/route";
import { GET as getItem } from "@/app/api/knowledge/items/[id]/route";

describe("knowledge inbox routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
  });

  it("returns owner-scoped stage progress without cache", async () => {
    listKnowledgeInbox.mockResolvedValue([
      {
        id: "document-1",
        assetId: "asset-1",
        title: "Harness",
        status: "extracting",
        stage: "chunking",
        progress: 45,
        mimeType: "text/markdown",
        originalName: "Harness.md",
        summary: null,
        errorCode: null,
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ]);

    const response = await getInbox(
      new Request("http://localhost/api/knowledge/inbox?limit=10"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(listKnowledgeInbox).toHaveBeenCalledWith("owner-1", 10);
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ stage: "chunking", progress: 45 })],
    });
  });

  it("returns item analysis and proposals without full extracted text", async () => {
    getKnowledgeItem.mockResolvedValue({
      id: "document-1",
      assetId: "asset-1",
      title: "Harness",
      status: "ready",
      stage: "complete",
      summary: "Harness summary",
      proposals: [{ id: "proposal-1", kind: "todo", status: "pending" }],
      sourceUrl: "/api/knowledge/assets/asset-1",
    });

    const response = await getItem(
      new Request("http://localhost/api/knowledge/items/document-1"),
      { params: { id: "document-1" } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getKnowledgeItem).toHaveBeenCalledWith("owner-1", "document-1");
    expect(body.item.summary).toBe("Harness summary");
    expect(body.item.normalizedText).toBeUndefined();
  });
});
