import { randomUUID } from "node:crypto";
import { getKnowledgeConfig } from "../src/lib/knowledge/config";
import { getProvider } from "../src/lib/ai/openai-compatible";
import { analyzeKnowledgeDocument } from "../src/lib/knowledge/analysis";
import { extractKnowledgeFile } from "../src/lib/knowledge/extractors";
import { chunkExtractedDocument } from "../src/lib/knowledge/chunks";
import { getKnowledgeJobRepository } from "../src/lib/knowledge/job-repository";
import { KnowledgeStorage } from "../src/lib/knowledge/storage";
import { runKnowledgeWorker } from "../src/lib/knowledge/worker";

async function main() {
  const config = getKnowledgeConfig();
  const controller = new AbortController();
  const provider = getProvider();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await runKnowledgeWorker({
    signal: controller.signal,
    pollMs: config.workerPollMs,
    dependencies: {
      repository: getKnowledgeJobRepository(),
      storage: new KnowledgeStorage(config.storageRoot),
      extract: extractKnowledgeFile,
      chunk: chunkExtractedDocument,
      analyze: provider
        ? (input) => analyzeKnowledgeDocument(input, provider)
        : null,
      workerId: `knowledge-${randomUUID()}`,
      maxAttempts: 3,
      ocrLanguages: config.ocrLanguages,
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Knowledge worker failed");
  process.exitCode = 1;
});
