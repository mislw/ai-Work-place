// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceClient, collectionInsert, documentUpdate } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  collectionInsert: vi.fn(),
  documentUpdate: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { getKnowledgeConfirmationRepository } from "@/lib/knowledge/confirmation";

describe("knowledge archive confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceClient.mockReturnValue({
      from(table: string) {
        if (table === "knowledge_collections") {
          return collectionQuery();
        }
        if (table === "knowledge_documents") {
          return documentQuery();
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });
  });

  it("creates a recommended named collection before archiving the document", async () => {
    const repository = getKnowledgeConfirmationRepository();

    const result = await repository.confirmArchiveProposal("owner-1", {
      id: "proposal-1",
      documentId: "document-1",
      kind: "archive",
      title: "归档到 Cowart",
      payload: { collectionName: "Cowart", collectionKind: "project" },
      status: "pending",
      result: null,
    });

    expect(collectionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "owner-1",
        name: "Cowart",
        kind: "project",
      }),
    );
    expect(documentUpdate).toHaveBeenCalledWith({
      collection_id: "collection-1",
    });
    expect(result).toEqual({
      archived: true,
      collectionId: "collection-1",
      collectionName: "Cowart",
    });
  });
});

function collectionQuery() {
  let operation: "select" | "insert" = "select";
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    insert(value: unknown) {
      operation = "insert";
      collectionInsert(value);
      return chain;
    },
    single() {
      if (operation !== "insert") throw new Error("Expected insert");
      return Promise.resolve({
        data: { id: "collection-1", name: "Cowart" },
        error: null,
      });
    },
  };
  return chain;
}

function documentQuery() {
  const result = Promise.resolve({ error: null });
  const chain = {
    update(value: unknown) {
      documentUpdate(value);
      return chain;
    },
    eq() {
      return chain;
    },
    then(resolve: (value: { error: null }) => void) {
      return result.then(resolve);
    },
  };
  return chain;
}
