import type { AIProvider } from "@/lib/ai/provider";
import {
  knowledgeAnalysisSchema,
  type KnowledgeAnalysis,
} from "@/lib/knowledge/contracts";
import type { KnowledgeChunkDraft } from "@/lib/knowledge/chunks";
import type { ExtractedDocument } from "@/lib/knowledge/extractors";

const MAX_ANALYSIS_CHARACTERS = 30_000;

export class KnowledgeAnalysisError extends Error {
  constructor(
    readonly code: "ANALYSIS_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export async function analyzeKnowledgeDocument(
  input: {
    originalName: string;
    mimeType: string;
    document: ExtractedDocument;
    chunks: KnowledgeChunkDraft[];
  },
  provider: AIProvider,
): Promise<KnowledgeAnalysis> {
  const response = await provider.chat({
    temperature: 0.1,
    maxTokens: 2_500,
    responseFormat: "json",
    messages: [
      {
        role: "system",
        content: [
          "你是个人知识库整理助手，只分析给定资料。",
          "输出必须是严格 JSON 对象，禁止 Markdown 代码块和额外解释。",
          "只生成归档、笔记、待办、日程建议，不得声称已经创建、修改或执行任何操作。",
          "所有 proposals 的 status 必须是 pending。",
          "归档建议 kind=archive 时，payload 必须包含 collectionName，并可包含 collectionKind(project/area/resource/archive)。",
          "字段必须包含 documentType, title, summary, topics, entities, importantDates, suggestedCollection, proposals。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `文件名: ${input.originalName}`,
          `MIME: ${input.mimeType}`,
          `解析器: ${input.document.parser}@${input.document.parserVersion}`,
          "--- 资料内容 ---",
          buildBoundedAnalysisText(input.document),
        ].join("\n"),
      },
    ],
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.content);
  } catch {
    throw new KnowledgeAnalysisError("ANALYSIS_INVALID", "分析结果不是有效 JSON");
  }
  const parsed = knowledgeAnalysisSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new KnowledgeAnalysisError("ANALYSIS_INVALID", "分析结果不符合知识库契约");
  }
  return {
    ...parsed.data,
    proposals: parsed.data.proposals.map((proposal) => ({
      ...proposal,
      status: "pending" as const,
    })),
  };
}

export function buildBoundedAnalysisText(document: ExtractedDocument) {
  const entries = document.blocks
    .map((block, index) => {
      const anchors = [
        block.page ? `page=${block.page}` : "",
        block.headingPath?.length ? `heading=${block.headingPath.join(" > ")}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `[BLOCK-${index}${anchors ? `; ${anchors}` : ""}]\n${block.text.trim()}`;
    })
    .filter((entry) => entry.trim());
  if (entries.length === 0) return "";

  const selected: string[] = [];
  let used = 0;
  const firstSectionLimit = Math.min(entries.length, 10);
  for (let index = 0; index < firstSectionLimit; index += 1) {
    used = appendWithinLimit(selected, entries[index]!, used);
  }

  const remaining = entries.length - firstSectionLimit;
  if (remaining > 0 && used < MAX_ANALYSIS_CHARACTERS) {
    const samples = Math.min(12, remaining);
    for (let sample = 0; sample < samples; sample += 1) {
      const ratio = samples === 1 ? 1 : sample / (samples - 1);
      const index = firstSectionLimit + Math.floor(ratio * (remaining - 1));
      used = appendWithinLimit(selected, entries[index]!, used);
      if (used >= MAX_ANALYSIS_CHARACTERS) break;
    }
  }
  return selected.join("\n\n").slice(0, MAX_ANALYSIS_CHARACTERS);
}

function appendWithinLimit(selected: string[], value: string, used: number) {
  const separatorLength = selected.length > 0 ? 2 : 0;
  const available = MAX_ANALYSIS_CHARACTERS - used - separatorLength;
  if (available <= 0) return MAX_ANALYSIS_CHARACTERS;
  selected.push(value.slice(0, available));
  return used + separatorLength + Math.min(value.length, available);
}
