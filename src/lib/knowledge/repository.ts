import { createServiceClient } from "@/lib/supabase/server";
import type { ParsedKnowledgeUpload } from "@/lib/knowledge/upload";

export interface RegisteredKnowledgeUpload {
  assetId: string;
  documentId: string;
  jobId: string;
  reusedAsset: boolean;
}

export interface KnowledgeAssetRecord {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: "quarantine" | "available" | "rejected" | "deleted";
}

export interface KnowledgeRepository {
  registerUpload(
    ownerId: string,
    upload: ParsedKnowledgeUpload,
    idempotencyKey: string,
  ): Promise<RegisteredKnowledgeUpload>;
  activateAsset(ownerId: string, assetId: string, storageKey: string): Promise<void>;
  markAssetRejected(ownerId: string, assetId: string): Promise<void>;
  findAsset(ownerId: string, assetId: string): Promise<KnowledgeAssetRecord | null>;
  countAssetRelations(ownerId: string, assetId: string): Promise<number>;
  markAssetDeleted(ownerId: string, assetId: string): Promise<void>;
}

export function getKnowledgeRepository(): KnowledgeRepository {
  const client = createServiceClient();

  return {
    async registerUpload(ownerId, upload, idempotencyKey) {
      const { data, error } = await client.rpc("register_knowledge_upload", {
        p_user_id: ownerId,
        p_storage_key: upload.storageKey,
        p_original_name: upload.originalName,
        p_mime_type: upload.mimeType,
        p_size_bytes: upload.sizeBytes,
        p_sha256: upload.sha256,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new Error(`知识文件注册失败: ${error.message}`);

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.asset_id || !row.document_id || !row.job_id) {
        throw new Error("知识文件注册未返回完整结果");
      }
      return {
        assetId: String(row.asset_id),
        documentId: String(row.document_id),
        jobId: String(row.job_id),
        reusedAsset: Boolean(row.reused_asset),
      };
    },

    async activateAsset(ownerId, assetId, storageKey) {
      const { error } = await client
        .from("file_assets")
        .update({ storage_key: storageKey, status: "available" })
        .eq("user_id", ownerId)
        .eq("id", assetId)
        .eq("status", "quarantine");
      if (error) throw new Error(`知识文件启用失败: ${error.message}`);
    },

    async markAssetRejected(ownerId, assetId) {
      const { error } = await client
        .from("file_assets")
        .update({ status: "rejected" })
        .eq("user_id", ownerId)
        .eq("id", assetId);
      if (error) throw new Error(`知识文件拒绝状态写入失败: ${error.message}`);
    },

    async findAsset(ownerId, assetId) {
      const { data, error } = await client
        .from("file_assets")
        .select("id, storage_key, original_name, mime_type, size_bytes, status")
        .eq("user_id", ownerId)
        .eq("id", assetId)
        .eq("status", "available")
        .maybeSingle();
      if (error) throw new Error(`知识文件查询失败: ${error.message}`);
      if (!data) return null;
      return {
        id: String(data.id),
        storageKey: String(data.storage_key),
        originalName: String(data.original_name),
        mimeType: String(data.mime_type),
        sizeBytes: Number(data.size_bytes),
        status: data.status as KnowledgeAssetRecord["status"],
      };
    },

    async countAssetRelations(ownerId, assetId) {
      const { data: documents, error: documentError } = await client
        .from("knowledge_documents")
        .select("id")
        .eq("user_id", ownerId)
        .eq("asset_id", assetId);
      if (documentError) {
        throw new Error(`知识文件关联文档查询失败: ${documentError.message}`);
      }

      const filters = [
        `and(source_type.eq.file_asset,source_id.eq.${assetId})`,
        `and(target_type.eq.file_asset,target_id.eq.${assetId})`,
      ];
      const documentIds = (documents ?? []).map((item) => String(item.id));
      if (documentIds.length > 0) {
        const ids = documentIds.join(",");
        filters.push(
          `and(source_type.eq.knowledge_document,source_id.in.(${ids}))`,
          `and(target_type.eq.knowledge_document,target_id.in.(${ids}))`,
        );
      }

      const { count, error } = await client
        .from("knowledge_relations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ownerId)
        .or(filters.join(","));
      if (error) throw new Error(`知识文件关联查询失败: ${error.message}`);
      return count ?? 0;
    },

    async markAssetDeleted(ownerId, assetId) {
      const { error } = await client
        .from("file_assets")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("user_id", ownerId)
        .eq("id", assetId)
        .eq("status", "available");
      if (error) throw new Error(`知识文件删除状态写入失败: ${error.message}`);
    },
  };
}
