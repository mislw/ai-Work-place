// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { analyzeKnowledgeDocument } from "@/lib/knowledge/analysis";
import type { AIProvider } from "@/lib/ai/provider";

function providerWith(content: string) {
  const chat = vi.fn().mockResolvedValue({
    content,
    model: "test-model",
    promptTokens: 1,
    completionTokens: 1,
    durationMs: 1,
  });
  return { name: "test", chat } satisfies AIProvider;
}

describe("analyzeKnowledgeDocument", () => {
  it("returns typed archive and action proposals without executing them", async () => {
    const provider = providerWith(
      JSON.stringify({
        documentType: "meeting_notes",
        title: "Cowart UI 讨论",
        summary: "讨论了 Cowart UI 整理和后续排期。",
        topics: ["Cowart", "UI"],
        entities: ["Cowart"],
        importantDates: [],
        suggestedCollection: "Cowart",
        proposals: [
          {
            kind: "todo",
            title: "整理 Cowart UI",
            payload: { title: "整理 Cowart UI" },
            confidence: 0.92,
            status: "pending",
          },
        ],
      }),
    );

    const result = await analyzeKnowledgeDocument(
      {
        originalName: "meeting.md",
        mimeType: "text/markdown",
        document: {
          parser: "markdown",
          parserVersion: "1",
          warnings: [],
          blocks: [{ text: "Cowart UI 讨论：需要整理界面。", headingPath: ["会议"] }],
        },
        chunks: [],
      },
      provider,
    );

    expect(result).toEqual({
      documentType: "meeting_notes",
      title: "Cowart UI 讨论",
      summary: expect.any(String),
      topics: ["Cowart", "UI"],
      entities: ["Cowart"],
      importantDates: [],
      suggestedCollection: "Cowart",
      proposals: expect.arrayContaining([
        expect.objectContaining({ kind: "todo", status: "pending" }),
      ]),
    });
    expect(provider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat: "json",
        temperature: 0.1,
      }),
    );
    const request = vi.mocked(provider.chat).mock.calls[0]?.[0];
    expect(request?.messages[0]?.content).toContain("不得声称已经创建");
  });

  it("bounds model input while sampling later content", async () => {
    const provider = providerWith(
      JSON.stringify({
        documentType: "notes",
        title: "Long",
        summary: "Long content",
        topics: [],
        entities: [],
        importantDates: [],
        suggestedCollection: null,
        proposals: [],
      }),
    );
    const blocks = Array.from({ length: 50 }, (_, index) => ({
      text: `BLOCK-${index} ` + "x".repeat(1_500),
    }));

    await analyzeKnowledgeDocument(
      {
        originalName: "long.txt",
        mimeType: "text/plain",
        document: { parser: "text", parserVersion: "1", warnings: [], blocks },
        chunks: [],
      },
      provider,
    );

    const prompt = vi.mocked(provider.chat).mock.calls[0]?.[0].messages.at(-1)?.content ?? "";
    expect(prompt.length).toBeLessThan(32_000);
    expect(prompt).toContain("BLOCK-0");
    expect(prompt).toMatch(/BLOCK-(?:2[5-9]|[3-4]\d)/);
  });

  it("rejects malformed JSON with a stable needs-attention error", async () => {
    const provider = providerWith("not json");

    await expect(
      analyzeKnowledgeDocument(
        {
          originalName: "bad.txt",
          mimeType: "text/plain",
          document: {
            parser: "text",
            parserVersion: "1",
            warnings: [],
            blocks: [{ text: "content" }],
          },
          chunks: [],
        },
        provider,
      ),
    ).rejects.toMatchObject({
      code: "ANALYSIS_INVALID",
    });
  });
});
