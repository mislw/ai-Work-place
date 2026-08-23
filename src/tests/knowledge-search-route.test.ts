// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssistantOwner, searchKnowledge } = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  searchKnowledge: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {},
  getAssistantOwner,
}));
vi.mock("@/lib/knowledge/search", () => ({ searchKnowledge }));

import { GET } from "@/app/api/knowledge/search/route";

describe("GET /api/knowledge/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
  });

  it("returns ranked owner and collection scoped snippets with anchors", async () => {
    searchKnowledge.mockResolvedValue([
      {
        documentId: "document-1",
        chunkId: "chunk-1",
        title: "Harness",
        snippet: "<mark>Harness</mark> 接入",
        rank: 0.8,
        pageStart: 2,
        pageEnd: 2,
        headingPath: ["接入"],
        assetId: "asset-1",
      },
    ]);

    const response = await GET(
      new Request(
        "http://localhost/api/knowledge/search?q=Harness&collectionId=collection-1&limit=99",
      ),
    );

    expect(response.status).toBe(200);
    expect(searchKnowledge).toHaveBeenCalledWith({
      ownerId: "owner-1",
      query: "Harness",
      collectionId: "collection-1",
      limit: 20,
    });
    expect(await response.json()).toEqual({
      results: [
        expect.objectContaining({
          pageStart: 2,
          headingPath: ["接入"],
          assetUrl: "/api/knowledge/assets/asset-1",
        }),
      ],
    });
  });

  it("rejects an empty search query", async () => {
    const response = await GET(
      new Request("http://localhost/api/knowledge/search?q=%20"),
    );

    expect(response.status).toBe(400);
    expect(searchKnowledge).not.toHaveBeenCalled();
  });
});
