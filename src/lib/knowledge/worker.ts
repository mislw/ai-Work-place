import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { KnowledgeAnalysis } from "@/lib/knowledge/contracts";
import { KnowledgeAnalysisError } from "@/lib/knowledge/analysis";
import { chunkExtractedDocument, type KnowledgeChunkDraft } from "@/lib/knowledge/chunks";
import {
  extractKnowledgeFile,
  type ExtractedDocument,
} from "@/lib/knowledge/extractors";
import type {
  KnowledgeJob,
  KnowledgeJobRepository,
} from "@/lib/knowledge/job-repository";

export type { KnowledgeJob } from "@/lib/knowledge/job-repository";

export interface KnowledgeWorkerStorage {
  openRead(storageKey: string): Promise<{
    absolutePath: string;
    sizeBytes: number;
    stream: Pick<Readable, "destroy">;
  }>;
}

export interface KnowledgeWorkerDependencies {
  repository: KnowledgeJobRepository;
  storage: KnowledgeWorkerStorage;
  extract: typeof extractKnowledgeFile;
  chunk: (document: ExtractedDocument) => KnowledgeChunkDraft[];
  analyze: ((input: {
    originalName: string;
    mimeType: string;
    document: ExtractedDocument;
    chunks: KnowledgeChunkDraft[];
  }) => Promise<KnowledgeAnalysis>) | null;
  workerId: string;
  maxAttempts: number;
  ocrLanguages: string;
}

export async function processKnowledgeJob(
  job: KnowledgeJob,
  dependencies: KnowledgeWorkerDependencies,
) {
  let stage: "extracting" | "chunking" | "analyzing" = "extracting";
  try {
    await dependencies.repository.markStage(job, "extracting", 10);
    const asset = await dependencies.repository.loadAsset(job);
    const opened = await dependencies.storage.openRead(asset.storageKey);
    opened.stream.destroy();
    const document = await dependencies.extract({
      filePath: opened.absolutePath,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      ocrLanguages: dependencies.ocrLanguages,
    });

    stage = "chunking";
    await dependencies.repository.renewLease(job, dependencies.workerId, 120);
    await dependencies.repository.markStage(job, "chunking", 45);
    const chunks = dependencies.chunk(document);
    const contentHash = createHash("sha256")
      .update(document.blocks.map((block) => block.text).join("\n\n"))
      .digest("hex");
    const existingVersion = await dependencies.repository.findVersion(
      job.documentId,
      contentHash,
      document.parser,
      document.parserVersion,
    );
    const versionId =
      existingVersion ??
      (await dependencies.repository.saveVersionAndChunks(
        job,
        document,
        chunks,
        contentHash,
      ));

    stage = "analyzing";
    await dependencies.repository.renewLease(job, dependencies.workerId, 120);
    await dependencies.repository.markStage(job, "analyzing", 75);
    if (!dependencies.analyze) {
      await dependencies.repository.completeJob(job, {
        documentStatus: "needs_attention",
        errorCode: "AI_NOT_CONFIGURED",
      });
      return;
    }

    let analysis: KnowledgeAnalysis;
    try {
      analysis = await dependencies.analyze({
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        document,
        chunks,
      });
    } catch (error) {
      if (error instanceof KnowledgeAnalysisError) {
        await dependencies.repository.completeJob(job, {
          documentStatus: "needs_attention",
          errorCode: error.code,
        });
        return;
      }
      throw error;
    }
    await dependencies.repository.persistAnalysis(job, versionId, analysis);
    await dependencies.repository.completeJob(job, {
      documentStatus: "ready",
      errorCode: null,
    });
  } catch {
    const errorCode = stage === "analyzing" ? "ANALYSIS_FAILED" : "EXTRACT_FAILED";
    await dependencies.repository.failJob(job, errorCode, dependencies.maxAttempts);
  }
}

export async function runKnowledgeWorker(options: {
  dependencies: KnowledgeWorkerDependencies;
  signal: AbortSignal;
  pollMs: number;
  leaseSeconds?: number;
}) {
  const leaseSeconds = options.leaseSeconds ?? 120;
  while (!options.signal.aborted) {
    const job = await options.dependencies.repository.claimJob(
      options.dependencies.workerId,
      leaseSeconds,
    );
    if (job) {
      await processKnowledgeJob(job, options.dependencies);
      continue;
    }
    await abortableDelay(options.pollMs, options.signal);
  }
}

export function createDefaultChunker() {
  return chunkExtractedDocument;
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
