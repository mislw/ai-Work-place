import { createServiceClient } from "@/lib/supabase/server";
import type { KnowledgeAnalysis } from "@/lib/knowledge/contracts";
import type { KnowledgeChunkDraft } from "@/lib/knowledge/chunks";
import type { ExtractedDocument } from "@/lib/knowledge/extractors";

export interface KnowledgeJob {
  id: string;
  userId: string;
  assetId: string;
  documentId: string;
  attemptCount: number;
  stage: "queued" | "extracting" | "chunking" | "analyzing" | "complete" | "failed";
}

export interface KnowledgeJobAsset {
  storageKey: string;
  originalName: string;
  mimeType: string;
}

export interface KnowledgeJobRepository {
  claimJob(workerId: string, leaseSeconds: number): Promise<KnowledgeJob | null>;
  renewLease(job: KnowledgeJob, workerId: string, leaseSeconds: number): Promise<void>;
  markStage(
    job: KnowledgeJob,
    stage: "extracting" | "chunking" | "analyzing",
    progress: number,
  ): Promise<void>;
  loadAsset(job: KnowledgeJob): Promise<KnowledgeJobAsset>;
  findVersion(
    documentId: string,
    contentHash: string,
    parser: string,
    parserVersion: string,
  ): Promise<string | null>;
  saveVersionAndChunks(
    job: KnowledgeJob,
    document: ExtractedDocument,
    chunks: KnowledgeChunkDraft[],
    contentHash: string,
  ): Promise<string>;
  persistAnalysis(
    job: KnowledgeJob,
    versionId: string,
    analysis: KnowledgeAnalysis,
  ): Promise<void>;
  completeJob(
    job: KnowledgeJob,
    result: {
      documentStatus: "ready" | "needs_attention";
      errorCode: string | null;
    },
  ): Promise<void>;
  failJob(job: KnowledgeJob, errorCode: string, maxAttempts: number): Promise<void>;
}

export function getKnowledgeJobRepository(): KnowledgeJobRepository {
  const client = createServiceClient();

  return {
    async claimJob(workerId, leaseSeconds) {
      const { data, error } = await client.rpc("claim_ingestion_job", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`知识任务领取失败: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      return row ? mapJob(row) : null;
    },

    async renewLease(job, workerId, leaseSeconds) {
      const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1_000).toISOString();
      const { error } = await client
        .from("ingestion_jobs")
        .update({ lease_expires_at: leaseExpiresAt })
        .eq("id", job.id)
        .eq("user_id", job.userId)
        .eq("lease_owner", workerId)
        .eq("status", "processing");
      if (error) throw new Error(`知识任务续租失败: ${error.message}`);
    },

    async markStage(job, stage, progress) {
      const { error } = await client
        .from("ingestion_jobs")
        .update({ status: "processing", stage, progress, error_code: null })
        .eq("id", job.id)
        .eq("user_id", job.userId);
      if (error) throw new Error(`知识任务阶段更新失败: ${error.message}`);

      const { error: documentError } = await client
        .from("knowledge_documents")
        .update({
          stage,
          status: stage === "analyzing" ? "analyzing" : "extracting",
          error_code: null,
        })
        .eq("id", job.documentId)
        .eq("user_id", job.userId);
      if (documentError) {
        throw new Error(`知识文档阶段更新失败: ${documentError.message}`);
      }
    },

    async loadAsset(job) {
      const { data, error } = await client
        .from("file_assets")
        .select("storage_key, original_name, mime_type")
        .eq("id", job.assetId)
        .eq("user_id", job.userId)
        .eq("status", "available")
        .maybeSingle();
      if (error) throw new Error(`知识源文件查询失败: ${error.message}`);
      if (!data) throw new Error("KNOWLEDGE_ASSET_NOT_FOUND");
      return {
        storageKey: String(data.storage_key),
        originalName: String(data.original_name),
        mimeType: String(data.mime_type),
      };
    },

    async findVersion(documentId, contentHash, parser, parserVersion) {
      const { data, error } = await client
        .from("document_versions")
        .select("id")
        .eq("document_id", documentId)
        .eq("content_hash", contentHash)
        .eq("parser", parser)
        .eq("parser_version", parserVersion)
        .maybeSingle();
      if (error) throw new Error(`知识文档版本查询失败: ${error.message}`);
      return data ? String(data.id) : null;
    },

    async saveVersionAndChunks(job, document, chunks, contentHash) {
      const { data: latest, error: latestError } = await client
        .from("document_versions")
        .select("version_number")
        .eq("document_id", job.documentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) {
        throw new Error(`知识文档版本号查询失败: ${latestError.message}`);
      }
      const normalizedText = document.blocks.map((block) => block.text).join("\n\n");
      const { data: version, error: versionError } = await client
        .from("document_versions")
        .insert({
          user_id: job.userId,
          document_id: job.documentId,
          version_number: Number(latest?.version_number ?? 0) + 1,
          content_hash: contentHash,
          normalized_text: normalizedText,
          parser: document.parser,
          parser_version: document.parserVersion,
          extraction_metadata: { warnings: document.warnings },
        })
        .select("id")
        .single();
      if (versionError || !version) {
        throw new Error(`知识文档版本写入失败: ${versionError?.message ?? "EMPTY_RESULT"}`);
      }
      const versionId = String(version.id);

      if (chunks.length > 0) {
        const { error: chunksError } = await client.from("document_chunks").insert(
          chunks.map((chunk) => ({
            user_id: job.userId,
            document_id: job.documentId,
            version_id: versionId,
            chunk_index: chunk.chunkIndex,
            content: chunk.content,
            heading_path: chunk.headingPath,
            page_start: chunk.pageStart,
            page_end: chunk.pageEnd,
            char_start: chunk.charStart,
            char_end: chunk.charEnd,
          })),
        );
        if (chunksError) {
          throw new Error(`知识分块写入失败: ${chunksError.message}`);
        }
      }

      const { error: documentError } = await client
        .from("knowledge_documents")
        .update({
          current_version_id: versionId,
          title: document.titleHint || undefined,
          language: document.languageHint || undefined,
        })
        .eq("id", job.documentId)
        .eq("user_id", job.userId);
      if (documentError) {
        throw new Error(`知识文档当前版本更新失败: ${documentError.message}`);
      }
      return versionId;
    },

    async persistAnalysis(job, _versionId, analysis) {
      const { error: documentError } = await client
        .from("knowledge_documents")
        .update({
          title: analysis.title,
          document_type: analysis.documentType,
          summary: analysis.summary,
          tags: analysis.topics,
        })
        .eq("id", job.documentId)
        .eq("user_id", job.userId);
      if (documentError) {
        throw new Error(`知识分析结果写入失败: ${documentError.message}`);
      }

      if (analysis.proposals.length > 0) {
        const { error: cleanupError } = await client
          .from("knowledge_proposals")
          .delete()
          .eq("user_id", job.userId)
          .eq("document_id", job.documentId)
          .eq("status", "pending");
        if (cleanupError) {
          throw new Error(`旧知识建议清理失败: ${cleanupError.message}`);
        }
        const { error: proposalError } = await client
          .from("knowledge_proposals")
          .insert(
            analysis.proposals.map((proposal) => ({
              user_id: job.userId,
              document_id: job.documentId,
              kind: proposal.kind,
              title: proposal.title,
              payload: proposal.payload,
              confidence: proposal.confidence,
              status: "pending",
            })),
          );
        if (proposalError) {
          throw new Error(`知识建议写入失败: ${proposalError.message}`);
        }
      }
    },

    async completeJob(job, result) {
      const { error: documentError } = await client
        .from("knowledge_documents")
        .update({
          status: result.documentStatus,
          stage: "complete",
          error_code: result.errorCode,
        })
        .eq("id", job.documentId)
        .eq("user_id", job.userId);
      if (documentError) {
        throw new Error(`知识文档完成状态写入失败: ${documentError.message}`);
      }
      const { error } = await client.rpc("complete_ingestion_job", {
        p_job_id: job.id,
      });
      if (error) throw new Error(`知识任务完成失败: ${error.message}`);
    },

    async failJob(job, errorCode, maxAttempts) {
      if (job.attemptCount < maxAttempts) {
        const retryDelaySeconds = Math.min(60, 2 ** Math.max(0, job.attemptCount - 1) * 5);
        const { error } = await client
          .from("ingestion_jobs")
          .update({
            status: "queued",
            stage: "queued",
            progress: 0,
            available_at: new Date(Date.now() + retryDelaySeconds * 1_000).toISOString(),
            lease_owner: null,
            lease_expires_at: null,
            error_code: errorCode.slice(0, 100),
          })
          .eq("id", job.id)
          .eq("user_id", job.userId);
        if (error) throw new Error(`知识任务重试排队失败: ${error.message}`);
        return;
      }

      const { error } = await client.rpc("fail_ingestion_job", {
        p_job_id: job.id,
        p_error_code: errorCode.slice(0, 100),
      });
      if (error) throw new Error(`知识任务失败状态写入失败: ${error.message}`);
      await client
        .from("knowledge_documents")
        .update({ status: "failed", stage: "failed", error_code: errorCode.slice(0, 100) })
        .eq("id", job.documentId)
        .eq("user_id", job.userId);
    },
  };
}

function mapJob(row: Record<string, unknown>): KnowledgeJob {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetId: String(row.asset_id),
    documentId: String(row.document_id),
    attemptCount: Number(row.attempt_count),
    stage: String(row.stage) as KnowledgeJob["stage"],
  };
}
