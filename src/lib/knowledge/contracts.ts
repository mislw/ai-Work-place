import { z } from "zod";

export const MAX_KNOWLEDGE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_KNOWLEDGE_BATCH_FILES = 20;
export const MAX_KNOWLEDGE_UPLOAD_CONCURRENCY = 2;

export const SUPPORTED_KNOWLEDGE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const knowledgeJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const knowledgeDocumentStatusSchema = z.enum([
  "extracting",
  "analyzing",
  "ready",
  "needs_attention",
  "failed",
]);

export const knowledgeStageSchema = z.enum([
  "queued",
  "extracting",
  "chunking",
  "analyzing",
  "complete",
  "failed",
]);

export const knowledgeProposalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["archive", "note", "todo", "calendar"]),
  title: z.string().trim().min(1).max(200),
  payload: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  status: z.enum(["pending", "confirmed", "rejected"]),
});

export const knowledgeAnalysisSchema = z.object({
  documentType: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4_000),
  topics: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  entities: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  importantDates: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(100),
        description: z.string().trim().min(1).max(300),
      }),
    )
    .max(30)
    .default([]),
  suggestedCollection: z.string().trim().max(200).nullable().default(null),
  proposals: z.array(knowledgeProposalSchema.omit({ id: true })).max(30).default([]),
});

export const knowledgeItemSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  collectionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  status: knowledgeDocumentStatusSchema,
  stage: knowledgeStageSchema,
  mimeType: z.string().trim().min(1).max(200),
  originalName: z.string().trim().min(1).max(500),
  summary: z.string().max(4_000).nullable().optional(),
  proposals: z.array(knowledgeProposalSchema),
  errorCode: z.string().max(100).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const knowledgeUploadResponseSchema = z.object({
  assetId: z.string().uuid(),
  documentId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: z.literal("queued"),
});

export const knowledgeSearchResultSchema = z.object({
  documentId: z.string().uuid(),
  chunkId: z.string().uuid(),
  title: z.string().min(1).max(200),
  snippet: z.string().min(1).max(2_000),
  rank: z.number(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  headingPath: z.array(z.string()).default([]),
  assetId: z.string().uuid().nullable(),
});

export type KnowledgeAnalysis = z.infer<typeof knowledgeAnalysisSchema>;
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;
export type KnowledgeProposal = z.infer<typeof knowledgeProposalSchema>;
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;
export type KnowledgeUploadResponse = z.infer<
  typeof knowledgeUploadResponseSchema
>;
