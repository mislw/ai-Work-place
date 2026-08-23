// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAssistantOwner,
  executeIdempotentWorkbenchAction,
  getProposal,
  createRelation,
  markProposalConfirmed,
  confirmArchiveProposal,
} = vi.hoisted(() => ({
  getAssistantOwner: vi.fn(),
  executeIdempotentWorkbenchAction: vi.fn(),
  getProposal: vi.fn(),
  createRelation: vi.fn(),
  markProposalConfirmed: vi.fn(),
  confirmArchiveProposal: vi.fn(),
}));

vi.mock("@/lib/assistant/auth", () => ({
  AssistantAuthError: class AssistantAuthError extends Error {},
  getAssistantOwner,
}));
vi.mock("@/lib/assistant/action-service", () => ({
  executeIdempotentWorkbenchAction,
}));
vi.mock("@/lib/knowledge/confirmation", () => ({
  getKnowledgeConfirmationRepository: () => ({
    getProposal,
    createRelation,
    markProposalConfirmed,
    confirmArchiveProposal,
  }),
}));

import { POST } from "@/app/api/knowledge/confirm/route";

function request(proposalIds: string[]) {
  return new Request("http://localhost/api/knowledge/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalIds }),
  });
}

describe("POST /api/knowledge/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssistantOwner.mockResolvedValue({ id: "owner-1" });
    getProposal.mockResolvedValue({
      id: "proposal-1",
      documentId: "document-1",
      kind: "todo",
      title: "整理 Cowart UI",
      payload: { title: "整理 Cowart UI", priority: "high" },
      status: "pending",
      result: null,
    });
    executeIdempotentWorkbenchAction.mockResolvedValue({
      result: { id: "todo-1", title: "整理 Cowart UI" },
      replayed: false,
    });
  });

  it("executes selected proposals and records their source relation", async () => {
    const response = await POST(request(["proposal-1"]));

    expect(response.status).toBe(200);
    expect(executeIdempotentWorkbenchAction).toHaveBeenCalledWith(
      "owner-1",
      {
        action: "todo.create",
        input: { title: "整理 Cowart UI", priority: "high" },
      },
      "knowledge:proposal-1",
    );
    expect(createRelation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        sourceId: "document-1",
        targetId: "todo-1",
        relationType: "source_of",
      }),
    );
    expect(markProposalConfirmed).toHaveBeenCalled();
  });

  it("returns the previous result without duplicate workbench rows", async () => {
    getProposal.mockResolvedValue({
      id: "proposal-1",
      documentId: "document-1",
      kind: "todo",
      title: "整理 Cowart UI",
      payload: {},
      status: "confirmed",
      result: { id: "todo-1" },
    });

    const response = await POST(request(["proposal-1"]));

    expect(response.status).toBe(200);
    expect(executeIdempotentWorkbenchAction).not.toHaveBeenCalled();
    expect(createRelation).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      results: [expect.objectContaining({ proposalId: "proposal-1", replayed: true })],
    });
  });

  it("does not report a committed action as failed when relation repair is needed", async () => {
    createRelation.mockRejectedValue(new Error("relation offline"));

    const response = await POST(request(["proposal-1"]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        expect.objectContaining({
          proposalId: "proposal-1",
          ok: true,
          relationRepairNeeded: true,
        }),
      ],
    });
    expect(markProposalConfirmed).toHaveBeenCalledWith(
      "owner-1",
      "proposal-1",
      expect.objectContaining({ relationRepairNeeded: true }),
    );
  });

  it("confirms a recommended archive destination without creating a workbench row", async () => {
    getProposal.mockResolvedValue({
      id: "proposal-archive",
      documentId: "document-1",
      kind: "archive",
      title: "归档到 Cowart",
      payload: { collectionName: "Cowart", collectionKind: "project" },
      status: "pending",
      result: null,
    });
    confirmArchiveProposal.mockResolvedValue({
      archived: true,
      collectionId: "collection-1",
      collectionName: "Cowart",
    });

    const response = await POST(request(["proposal-archive"]));

    expect(response.status).toBe(200);
    expect(confirmArchiveProposal).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ id: "proposal-archive" }),
    );
    expect(executeIdempotentWorkbenchAction).not.toHaveBeenCalled();
    expect(markProposalConfirmed).toHaveBeenCalledWith(
      "owner-1",
      "proposal-archive",
      expect.objectContaining({ collectionId: "collection-1" }),
    );
  });
});
