import { createRouteHandlerClient, createServiceClient } from "@/lib/supabase/server";
import type { KnowledgeSearchResult } from "@/lib/knowledge/contracts";

export async function listKnowledgeInbox(ownerId: string, limit: number) {
  const client = createServiceClient();
  const { data: documents, error } = await client
    .from("knowledge_documents")
    .select(
      "id, asset_id, collection_id, title, status, stage, summary, error_code, created_at, updated_at",
    )
    .eq("user_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw new Error(`知识收件箱查询失败: ${error.message}`);

  const assetIds = unique((documents ?? []).map((item) => item.asset_id));
  const documentIds = unique((documents ?? []).map((item) => item.id));
  const assets = await loadAssets(client, ownerId, assetIds);
  const jobs = await loadLatestJobs(client, ownerId, documentIds);

  return (documents ?? []).map((document) => {
    const asset = assets.get(String(document.asset_id));
    const job = jobs.get(String(document.id));
    return {
      id: String(document.id),
      assetId: String(document.asset_id),
      collectionId: document.collection_id ? String(document.collection_id) : null,
      title: String(document.title),
      status: String(document.status),
      stage: String(document.stage),
      progress: Number(job?.progress ?? (document.stage === "complete" ? 100 : 0)),
      mimeType: String(asset?.mime_type ?? "application/octet-stream"),
      originalName: String(asset?.original_name ?? document.title),
      summary: document.summary ? String(document.summary) : null,
      errorCode: sanitizeErrorCode(document.error_code ?? job?.error_code),
      createdAt: String(document.created_at),
      updatedAt: String(document.updated_at),
    };
  });
}

export async function getKnowledgeItem(ownerId: string, documentId: string) {
  const client = createServiceClient();
  const { data: document, error } = await client
    .from("knowledge_documents")
    .select(
      "id, asset_id, collection_id, title, document_type, language, status, stage, summary, tags, error_code, created_at, updated_at",
    )
    .eq("user_id", ownerId)
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`知识条目查询失败: ${error.message}`);
  if (!document) return null;

  const [{ data: asset, error: assetError }, { data: proposals, error: proposalsError }] =
    await Promise.all([
      client
        .from("file_assets")
        .select("id, original_name, mime_type, size_bytes")
        .eq("user_id", ownerId)
        .eq("id", document.asset_id)
        .maybeSingle(),
      client
        .from("knowledge_proposals")
        .select("id, kind, title, payload, confidence, status, result")
        .eq("user_id", ownerId)
        .eq("document_id", documentId)
        .order("created_at", { ascending: true }),
    ]);
  if (assetError) throw new Error(`知识源文件查询失败: ${assetError.message}`);
  if (proposalsError) throw new Error(`知识建议查询失败: ${proposalsError.message}`);

  return {
    id: String(document.id),
    assetId: String(document.asset_id),
    collectionId: document.collection_id ? String(document.collection_id) : null,
    title: String(document.title),
    documentType: String(document.document_type),
    language: document.language ? String(document.language) : null,
    status: String(document.status),
    stage: String(document.stage),
    summary: document.summary ? String(document.summary) : null,
    tags: Array.isArray(document.tags) ? document.tags : [],
    errorCode: sanitizeErrorCode(document.error_code),
    originalName: String(asset?.original_name ?? document.title),
    mimeType: String(asset?.mime_type ?? "application/octet-stream"),
    sizeBytes: Number(asset?.size_bytes ?? 0),
    sourceUrl: `/api/knowledge/assets/${document.asset_id}`,
    proposals: (proposals ?? []).map((proposal) => ({
      id: String(proposal.id),
      kind: String(proposal.kind),
      title: String(proposal.title),
      payload: proposal.payload ?? {},
      confidence: Number(proposal.confidence),
      status: String(proposal.status),
      result: proposal.result ?? null,
    })),
    createdAt: String(document.created_at),
    updatedAt: String(document.updated_at),
  };
}

export async function searchKnowledge(input: {
  ownerId: string;
  query: string;
  collectionId: string | null;
  limit: number;
}): Promise<KnowledgeSearchResult[]> {
  const client = await createRouteHandlerClient();
  const { data, error } = await client.rpc("search_knowledge_chunks", {
    p_query: input.query,
    p_collection_id: input.collectionId,
    p_limit: Math.min(Math.max(input.limit, 1), 20),
  });
  if (error) throw new Error(`知识检索失败: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    documentId: String(row.document_id),
    chunkId: String(row.chunk_id),
    title: String(row.title),
    snippet: String(row.snippet),
    rank: Number(row.rank),
    pageStart: row.page_start == null ? null : Number(row.page_start),
    pageEnd: row.page_end == null ? null : Number(row.page_end),
    headingPath: Array.isArray(row.heading_path)
      ? row.heading_path.map(String)
      : [],
    assetId: row.asset_id == null ? null : String(row.asset_id),
  }));
}

async function loadAssets(
  client: ReturnType<typeof createServiceClient>,
  ownerId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) return new Map<string, Record<string, unknown>>();
  const { data, error } = await client
    .from("file_assets")
    .select("id, original_name, mime_type")
    .eq("user_id", ownerId)
    .in("id", assetIds);
  if (error) throw new Error(`知识源文件批量查询失败: ${error.message}`);
  return new Map((data ?? []).map((item) => [String(item.id), item]));
}

async function loadLatestJobs(
  client: ReturnType<typeof createServiceClient>,
  ownerId: string,
  documentIds: string[],
) {
  if (documentIds.length === 0) return new Map<string, Record<string, unknown>>();
  const { data, error } = await client
    .from("ingestion_jobs")
    .select("document_id, progress, error_code, created_at")
    .eq("user_id", ownerId)
    .in("document_id", documentIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`知识任务批量查询失败: ${error.message}`);
  const result = new Map<string, Record<string, unknown>>();
  for (const item of data ?? []) {
    const id = String(item.document_id);
    if (!result.has(id)) result.set(id, item);
  }
  return result;
}

function unique(values: unknown[]) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function sanitizeErrorCode(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return /^[A-Z0-9_]{1,100}$/.test(value) ? value : "PROCESSING_FAILED";
}
