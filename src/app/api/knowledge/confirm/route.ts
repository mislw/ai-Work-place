import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { executeIdempotentWorkbenchAction } from "@/lib/assistant/action-service";
import { workbenchActionSchema } from "@/lib/assistant/actions";
import {
  getKnowledgeConfirmationRepository,
  type KnowledgeProposalRecord,
} from "@/lib/knowledge/confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  proposalIds: z.array(z.string().min(1).max(200)).min(1).max(30),
});

export async function POST(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const body = requestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json(
        { error: { code: "BAD_CONFIRMATION", message: "请选择要确认的建议" } },
        { status: 400 },
      );
    }
    const repository = getKnowledgeConfirmationRepository();
    const results = [];

    for (const proposalId of [...new Set(body.data.proposalIds)]) {
      const proposal = await repository.getProposal(owner.id, proposalId);
      if (!proposal) {
        results.push({ proposalId, ok: false, code: "PROPOSAL_NOT_FOUND" });
        continue;
      }
      if (proposal.status === "confirmed") {
        results.push({
          proposalId,
          ok: true,
          replayed: true,
          result: proposal.result,
        });
        continue;
      }
      if (proposal.status !== "pending") {
        results.push({ proposalId, ok: false, code: "PROPOSAL_NOT_PENDING" });
        continue;
      }

      if (proposal.kind === "archive") {
        const result = await repository.confirmArchiveProposal(owner.id, proposal);
        await repository.markProposalConfirmed(owner.id, proposal.id, result);
        results.push({ proposalId, ok: true, replayed: false, result });
        continue;
      }

      const action = proposalToAction(proposal);
      const execution = await executeIdempotentWorkbenchAction(
        owner.id,
        action,
        `knowledge:${proposal.id}`,
      );
      const targetId = extractResultId(execution.result);
      let relationRepairNeeded = !targetId;
      if (targetId) {
        try {
          await repository.createRelation({
            ownerId: owner.id,
            sourceId: proposal.documentId,
            targetType: targetTypeForProposal(proposal.kind),
            targetId,
            relationType: "source_of",
          });
        } catch {
          relationRepairNeeded = true;
        }
      }
      const storedResult = {
        result: execution.result,
        replayed: execution.replayed,
        relationRepairNeeded,
      };
      await repository.markProposalConfirmed(owner.id, proposal.id, storedResult);
      results.push({ proposalId, ok: true, ...storedResult });
    }

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof AssistantAuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "CONFIRMATION_FAILED",
          message: error instanceof Error ? error.message : "知识建议确认失败",
        },
      },
      { status: 500 },
    );
  }
}

function proposalToAction(proposal: KnowledgeProposalRecord) {
  const input = { title: proposal.title, ...proposal.payload };
  const actionName =
    proposal.kind === "calendar"
      ? "calendar.create"
      : proposal.kind === "todo"
        ? "todo.create"
        : "note.create";
  return workbenchActionSchema.parse({ action: actionName, input });
}

function targetTypeForProposal(kind: KnowledgeProposalRecord["kind"]) {
  if (kind === "calendar") return "calendar_event";
  if (kind === "todo") return "todo";
  return "note";
}

function extractResultId(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "id" in result &&
    typeof result.id === "string"
  ) {
    return result.id;
  }
  return null;
}
