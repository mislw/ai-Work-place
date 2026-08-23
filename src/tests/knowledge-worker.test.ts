// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processKnowledgeJob,
  runKnowledgeWorker,
  type KnowledgeJob,
  type KnowledgeWorkerDependencies,
} from "@/lib/knowledge/worker";
import { KnowledgeAnalysisError } from "@/lib/knowledge/analysis";

const job: KnowledgeJob = {
  id: "job-1",
  userId: "owner-1",
  assetId: "asset-1",
  documentId: "document-1",
  attemptCount: 1,
  stage: "queued",
};

function createDependencies(): KnowledgeWorkerDependencies {
  return {
    repository: {
      claimJob: vi.fn(),
      renewLease: vi.fn(),
      markStage: vi.fn(),
      loadAsset: vi.fn().mockResolvedValue({
        storageKey: "users/owner-1/assets/asset-1/file.md",
        originalName: "Harness.md",
        mimeType: "text/markdown",
      }),
      findVersion: vi.fn().mockResolvedValue(null),
      saveVersionAndChunks: vi.fn().mockResolvedValue("version-1"),
      persistAnalysis: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
    },
    storage: {
      openRead: vi.fn().mockResolvedValue({
        absolutePath: "D:/knowledge/file.md",
        sizeBytes: 20,
        stream: { destroy: vi.fn() },
      }),
    },
    extract: vi.fn().mockResolvedValue({
      parser: "markdown",
      parserVersion: "1",
      warnings: [],
      blocks: [{ text: "Harness knowledge" }],
    }),
    chunk: vi.fn().mockReturnValue([
      {
        chunkIndex: 0,
        content: "Harness knowledge",
        headingPath: [],
        pageStart: null,
        pageEnd: null,
        charStart: 0,
        charEnd: 17,
      },
    ]),
    analyze: vi.fn().mockResolvedValue({
      documentType: "notes",
      title: "Harness",
      summary: "Harness knowledge",
      topics: [],
      entities: [],
      importantDates: [],
      suggestedCollection: null,
      proposals: [],
    }),
    workerId: "worker-1",
    maxAttempts: 3,
    ocrLanguages: "chi_sim+eng",
  };
}

describe("processKnowledgeJob", () => {
  let dependencies: KnowledgeWorkerDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("moves through extracting, chunking, analyzing, and complete", async () => {
    await processKnowledgeJob(job, dependencies);

    expect(dependencies.repository.markStage).toHaveBeenNthCalledWith(
      1,
      job,
      "extracting",
      10,
    );
    expect(dependencies.repository.markStage).toHaveBeenNthCalledWith(
      2,
      job,
      "chunking",
      45,
    );
    expect(dependencies.repository.markStage).toHaveBeenNthCalledWith(
      3,
      job,
      "analyzing",
      75,
    );
    expect(dependencies.repository.completeJob).toHaveBeenCalledWith(job, {
      documentStatus: "ready",
      errorCode: null,
    });
  });

  it("finishes lexical extraction when AI is not configured", async () => {
    dependencies.analyze = null;

    await processKnowledgeJob(job, dependencies);

    expect(dependencies.repository.persistAnalysis).not.toHaveBeenCalled();
    expect(dependencies.repository.completeJob).toHaveBeenCalledWith(job, {
      documentStatus: "needs_attention",
      errorCode: "AI_NOT_CONFIGURED",
    });
  });

  it("does not insert duplicate versions or chunks on redelivery", async () => {
    vi.mocked(dependencies.repository.findVersion).mockResolvedValue("version-existing");

    await processKnowledgeJob(job, dependencies);

    expect(dependencies.repository.saveVersionAndChunks).not.toHaveBeenCalled();
    expect(dependencies.repository.persistAnalysis).toHaveBeenCalledWith(
      job,
      "version-existing",
      expect.any(Object),
    );
  });

  it("records a stable error code and bounded retry metadata", async () => {
    vi.mocked(dependencies.extract).mockRejectedValue(new Error("secret stack and content"));

    await expect(processKnowledgeJob(job, dependencies)).resolves.toBeUndefined();

    expect(dependencies.repository.failJob).toHaveBeenCalledWith(
      job,
      "EXTRACT_FAILED",
      3,
    );
  });

  it("keeps extracted text when structured analysis is malformed", async () => {
    vi.mocked(dependencies.analyze!).mockRejectedValue(
      new KnowledgeAnalysisError("ANALYSIS_INVALID", "分析结果格式无效"),
    );

    await processKnowledgeJob(job, dependencies);

    expect(dependencies.repository.failJob).not.toHaveBeenCalled();
    expect(dependencies.repository.completeJob).toHaveBeenCalledWith(job, {
      documentStatus: "needs_attention",
      errorCode: "ANALYSIS_INVALID",
    });
  });
});

describe("runKnowledgeWorker", () => {
  it("claims stale or queued jobs until aborted", async () => {
    const dependencies = createDependencies();
    const controller = new AbortController();
    vi.mocked(dependencies.repository.claimJob)
      .mockResolvedValueOnce(job)
      .mockImplementationOnce(async () => {
        controller.abort();
        return null;
      });

    await runKnowledgeWorker({
      dependencies,
      signal: controller.signal,
      pollMs: 1,
    });

    expect(dependencies.repository.claimJob).toHaveBeenCalledWith("worker-1", 120);
    expect(dependencies.repository.completeJob).toHaveBeenCalledTimes(1);
  });
});
