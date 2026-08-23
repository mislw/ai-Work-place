import { createServiceClient } from "@/lib/supabase/server";

export interface KnowledgeProposalRecord {
  id: string;
  documentId: string;
  kind: "archive" | "note" | "todo" | "calendar";
  title: string;
  payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "rejected";
  result: unknown;
}

export function getKnowledgeConfirmationRepository() {
  const client = createServiceClient();
  return {
    async getProposal(ownerId: string, proposalId: string) {
      const { data, error } = await client
        .from("knowledge_proposals")
        .select("id, document_id, kind, title, payload, status, result")
        .eq("user_id", ownerId)
        .eq("id", proposalId)
        .maybeSingle();
      if (error) throw new Error(`知识建议查询失败: ${error.message}`);
      if (!data) return null;
      return {
        id: String(data.id),
        documentId: String(data.document_id),
        kind: String(data.kind) as KnowledgeProposalRecord["kind"],
        title: String(data.title),
        payload: isRecord(data.payload) ? data.payload : {},
        status: String(data.status) as KnowledgeProposalRecord["status"],
        result: data.result ?? null,
      } satisfies KnowledgeProposalRecord;
    },

    async confirmArchiveProposal(ownerId: string, proposal: KnowledgeProposalRecord) {
      let collectionId =
        typeof proposal.payload.collectionId === "string"
          ? proposal.payload.collectionId
          : null;
      if (!collectionId) {
        const collectionName = readCollectionName(proposal);
        const { data: existing, error: existingError } = await client
          .from("knowledge_collections")
          .select("id, name")
          .eq("user_id", ownerId)
          .eq("name", collectionName)
          .maybeSingle();
        if (existingError) {
          throw new Error(`知识集合查询失败: ${existingError.message}`);
        }
        if (existing) {
          collectionId = String(existing.id);
        } else {
          const kind = readCollectionKind(proposal.payload.collectionKind);
          const { data: created, error: createError } = await client
            .from("knowledge_collections")
            .insert({
              user_id: ownerId,
              name: collectionName,
              slug: slugifyCollectionName(collectionName),
              kind,
            })
            .select("id, name")
            .single();
          if (createError || !created) {
            throw new Error(
              `知识集合创建失败: ${createError?.message ?? "EMPTY_RESULT"}`,
            );
          }
          collectionId = String(created.id);
        }
      }
      const { error } = await client
        .from("knowledge_documents")
        .update({ collection_id: collectionId })
        .eq("user_id", ownerId)
        .eq("id", proposal.documentId);
      if (error) throw new Error(`知识归档失败: ${error.message}`);
      return {
        archived: true,
        collectionId,
        collectionName: readCollectionName(proposal),
      };
    },

    async createRelation(input: {
      ownerId: string;
      sourceId: string;
      targetType: string;
      targetId: string;
      relationType: "source_of";
    }) {
      const { error } = await client.from("knowledge_relations").upsert(
        {
          user_id: input.ownerId,
          source_type: "knowledge_document",
          source_id: input.sourceId,
          target_type: input.targetType,
          target_id: input.targetId,
          relation_type: input.relationType,
          creator: "user",
          confidence: 1,
        },
        {
          onConflict:
            "user_id,source_type,source_id,target_type,target_id,relation_type",
        },
      );
      if (error) throw new Error(`知识来源关系写入失败: ${error.message}`);
    },

    async markProposalConfirmed(
      ownerId: string,
      proposalId: string,
      result: unknown,
    ) {
      const { error } = await client
        .from("knowledge_proposals")
        .update({ status: "confirmed", result })
        .eq("user_id", ownerId)
        .eq("id", proposalId);
      if (error) throw new Error(`知识建议确认状态写入失败: ${error.message}`);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCollectionName(proposal: KnowledgeProposalRecord) {
  const named = proposal.payload.collectionName;
  if (typeof named === "string" && named.trim()) return named.trim().slice(0, 200);
  return proposal.title.replace(/^归档到\s*/, "").trim().slice(0, 200) || "知识收件箱";
}

function readCollectionKind(value: unknown) {
  return ["project", "area", "resource", "archive"].includes(String(value))
    ? (String(value) as "project" | "area" | "resource" | "archive")
    : "project";
}

function slugifyCollectionName(value: string) {
  const slug = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "knowledge";
}
