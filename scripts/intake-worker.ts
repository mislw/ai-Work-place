import type { SupabaseClient } from "@supabase/supabase-js";

import { executeIdempotentWorkbenchAction } from "../src/lib/assistant/action-service";
import type { WorkbenchAction } from "../src/lib/assistant/actions";
import {
  executeIntakePlan,
  type IntakeRelationInput,
} from "../src/lib/intake/executor";
import { HermesRunsClient } from "../src/lib/intake/hermes-runs";
import {
  runIntakeWorker,
  type IntakeOrchestratorDependencies,
} from "../src/lib/intake/orchestrator";
import { getIntakeRepository } from "../src/lib/intake/repository";
import {
  getKnowledgeConfirmationRepository,
  type KnowledgeProposalRecord,
} from "../src/lib/knowledge/confirmation";
import { getKnowledgeItem } from "../src/lib/knowledge/search";
import { createServiceClient } from "../src/lib/supabase/server";

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const repository = getIntakeRepository();
  const runs = new HermesRunsClient();
  const confirmation = getKnowledgeConfirmationRepository();
  const client = createServiceClient();
  const executeAction = executeIdempotentWorkbenchAction as (
    ownerId: string,
    action: WorkbenchAction,
    requestId: string,
    client: SupabaseClient,
  ) => ReturnType<typeof executeIdempotentWorkbenchAction>;

  const dependencies: IntakeOrchestratorDependencies = {
    repository,
    runs,
    getKnowledgeItem,
    executePlan: (input) =>
      executeIntakePlan(input, {
        repository,
        getKnowledgeDocument: getKnowledgeItem,
        archiveDocument: async (archiveInput) => {
          const result = await confirmation.confirmArchiveProposal(
            archiveInput.ownerId,
            archiveProposal(archiveInput),
          );
          const updatedDocument = await getKnowledgeItem(
            archiveInput.ownerId,
            archiveInput.documentId,
          );
          if (!updatedDocument) throw new Error("INTAKE_DOCUMENT_NOT_OWNED");
          return { result, updatedDocument };
        },
        executeAction: (ownerId, action, requestId) =>
          executeAction(ownerId, action, requestId, client),
        createRelation: (relationInput) =>
          createSourceRelation(client, relationInput),
      }),
    now: () => new Date(),
    sleep: abortableDelay,
  };

  await runIntakeWorker({
    dependencies,
    signal: controller.signal,
  });
}

function archiveProposal(input: {
  documentId: string;
  collectionName: string;
  collectionKind?: "project" | "area" | "resource" | "archive";
}): KnowledgeProposalRecord {
  return {
    id: `intake-archive:${input.documentId}`,
    documentId: input.documentId,
    kind: "archive",
    title: `归档到 ${input.collectionName}`,
    payload: {
      collectionName: input.collectionName,
      ...(input.collectionKind
        ? { collectionKind: input.collectionKind }
        : {}),
    },
    status: "pending",
    result: null,
  };
}

async function createSourceRelation(
  client: SupabaseClient,
  input: IntakeRelationInput,
) {
  const existing = await findSourceRelation(client, input);
  if (existing) return { result: existing, replayed: true };

  const payload = {
    user_id: input.ownerId,
    source_type: input.source_type,
    source_id: input.source_id,
    target_type: input.target_type,
    target_id: input.target_id,
    relation_type: input.relation_type,
    creator: input.creator,
    confidence: input.confidence,
  };
  const inserted = await client
    .from("knowledge_relations")
    .insert(payload)
    .select("*")
    .single();
  if (!inserted.error && inserted.data) {
    return { result: inserted.data, replayed: false };
  }

  const replayed = await findSourceRelation(client, input);
  if (replayed) return { result: replayed, replayed: true };
  throw new Error(inserted.error?.message ?? "KNOWLEDGE_RELATION_WRITE_FAILED");
}

async function findSourceRelation(
  client: SupabaseClient,
  input: IntakeRelationInput,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("knowledge_relations")
    .select("*")
    .eq("user_id", input.ownerId)
    .eq("source_type", input.source_type)
    .eq("source_id", input.source_id)
    .eq("target_type", input.target_type)
    .eq("target_id", input.target_id)
    .eq("relation_type", input.relation_type)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Intake worker failed",
  );
  process.exitCode = 1;
});
