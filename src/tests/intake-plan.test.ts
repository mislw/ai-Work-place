// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildIntakeRunRequest,
  parseTerminalIntakePlan,
} from "@/lib/intake/plan";
import type { WorkspacePageContextV1 } from "@/lib/intake/contracts";
import type { KnowledgeAnalysis } from "@/lib/knowledge/contracts";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

const VALID_PLAN = {
  version: 1,
  documentId: DOCUMENT_ID,
  summary: "归档并建立待办",
  confidence: 0.62,
  actions: [
    { kind: "archive", collectionName: "Hermes" },
    { kind: "todo.create", input: { title: "验证接入" } },
  ],
  warnings: ["日期不明确，未创建日程"],
};

describe("terminal intake plan parser", () => {
  it("parses only terminal JSON matching the current document", () => {
    const plan = parseTerminalIntakePlan(
      JSON.stringify(VALID_PLAN),
      DOCUMENT_ID,
    );

    expect(plan.actions).toHaveLength(2);
    expect(plan.documentId).toBe(DOCUMENT_ID);
  });

  it("rejects prose-wrapped, fenced, and array output", () => {
    const validJson = JSON.stringify(VALID_PLAN);

    expect(() =>
      parseTerminalIntakePlan(`结果如下:\n${validJson}`, DOCUMENT_ID),
    ).toThrow("INVALID_HERMES_PLAN");
    expect(() =>
      parseTerminalIntakePlan(`\`\`\`json\n${validJson}\n\`\`\``, DOCUMENT_ID),
    ).toThrow("INVALID_HERMES_PLAN");
    expect(() => parseTerminalIntakePlan(`[${validJson}]`, DOCUMENT_ID)).toThrow(
      "INVALID_HERMES_PLAN",
    );
  });

  it("rejects a plan for another document with a distinct error", () => {
    expect(() =>
      parseTerminalIntakePlan(
        JSON.stringify({ ...VALID_PLAN, documentId: OTHER_DOCUMENT_ID }),
        DOCUMENT_ID,
      ),
    ).toThrow("PLAN_DOCUMENT_MISMATCH");
  });

  it("rejects owner fields, unsafe action kinds, and more than 30 actions", () => {
    expect(() =>
      parseTerminalIntakePlan(
        JSON.stringify({ ...VALID_PLAN, ownerId: "owner-1" }),
        DOCUMENT_ID,
      ),
    ).toThrow("INVALID_HERMES_PLAN");
    expect(() =>
      parseTerminalIntakePlan(
        JSON.stringify({
          ...VALID_PLAN,
          actions: [{ kind: "todo.delete", input: { id: "todo-1" } }],
        }),
        DOCUMENT_ID,
      ),
    ).toThrow("INVALID_HERMES_PLAN");
    expect(() =>
      parseTerminalIntakePlan(
        JSON.stringify({
          ...VALID_PLAN,
          actions: Array.from({ length: 31 }, (_, index) => ({
            kind: "todo.create",
            input: { title: `Todo ${index}` },
          })),
        }),
        DOCUMENT_ID,
      ),
    ).toThrow("INVALID_HERMES_PLAN");
  });
});

describe("bounded intake run request", () => {
  it("builds an owner-scoped read-only planning request with exact metadata", () => {
    const request = buildIntakeRunRequest({
      ownerId: "owner-1",
      itemId: "item-1",
      documentId: DOCUMENT_ID,
      preliminary: preliminaryAnalysis(),
      pageContext: pageContext("todos"),
    });

    expect(request).toEqual({
      sessionId: "intake:owner-1:item-1",
      prompt: expect.any(String),
      metadata: {
        purpose: "workspace_file_intake",
        itemId: "item-1",
        documentId: DOCUMENT_ID,
      },
    });
    expect(request.metadata).not.toHaveProperty("ownerId");
    expect(request.prompt).toContain(DOCUMENT_ID);
    expect(request.prompt).toContain("摘要正文");
    expect(request.prompt).toContain("Topic A");
    expect(request.prompt).toContain("Entity A");
    expect(request.prompt).toContain("2026-09-10");
    expect(request.prompt).toContain("创建待办");
    expect(request.prompt).toContain('"pageType":"todos"');
    expect(request.prompt).toContain("knowledge_get_item");
    expect(request.prompt).toContain("knowledge_search");
    expect(request.prompt).toContain("workspace_search");
    expect(request.prompt).toContain("read-only");
    expect(request.prompt).toContain("untrusted data");
    expect(request.prompt).toContain("search");
    expect(request.prompt).toContain("duplicates");
    expect(request.prompt).toContain('"version": 1');
    expect(request.prompt).toContain('"documentId"');
    expect(request.prompt).toContain("archive");
    expect(request.prompt).toContain("note.create");
    expect(request.prompt).toContain("todo.create");
    expect(request.prompt).toContain("calendar.create");
    expect(request.prompt).toContain("30");
    expect(request.prompt).toContain("one JSON object");
    expect(request.prompt).toContain("never claim execution success");
    expect(request.prompt).toContain(
      "action-item extraction, deadlines, priority, source relations, and duplicate-task checks",
    );
  });

  it.each([
    [
      "workspace",
      "cross-module interpretation and project association",
    ],
    [
      "calendar",
      "concrete dates, time zones, event conflicts, and event-source relations",
    ],
    ["notes", "summaries, reference notes, tags, and related-note links"],
    [
      "documents",
      "collection selection, original-file preservation, versions, and duplicate detection",
    ],
    [
      "assistant",
      "current Hermes session identifier when available",
    ],
    [
      "settings",
      "content and existing workspace relationships only",
    ],
  ] as const)("includes the %s page routing rule", (pageType, routingRule) => {
    const request = buildIntakeRunRequest({
      ownerId: "owner-1",
      itemId: "item-1",
      documentId: DOCUMENT_ID,
      preliminary: preliminaryAnalysis(),
      pageContext: pageContext(pageType),
    });

    expect(request.prompt).toContain(routingRule);
  });

  it("rejects preliminary text over 12,000 characters", () => {
    expect(() =>
      buildIntakeRunRequest({
        ownerId: "owner-1",
        itemId: "item-1",
        documentId: DOCUMENT_ID,
        preliminary: preliminaryAnalysis({ summary: "x".repeat(12_001) }),
        pageContext: pageContext("workspace"),
      }),
    ).toThrow("INTAKE_PROMPT_TOO_LARGE");
  });

  it("rejects page context serialization over 8,000 characters", () => {
    expect(() =>
      buildIntakeRunRequest({
        ownerId: "owner-1",
        itemId: "item-1",
        documentId: DOCUMENT_ID,
        preliminary: preliminaryAnalysis(),
        pageContext: {
          ...pageContext("workspace"),
          view: { search: "x".repeat(8_000) },
        },
      }),
    ).toThrow("INTAKE_PROMPT_TOO_LARGE");
  });
});

function preliminaryAnalysis(
  overrides: Partial<KnowledgeAnalysis> = {},
): KnowledgeAnalysis {
  return {
    documentType: "text",
    title: "测试文档",
    summary: "摘要正文",
    topics: ["Topic A"],
    entities: ["Entity A"],
    importantDates: [
      { value: "2026-09-10", description: "计划日期" },
    ],
    suggestedCollection: "Hermes",
    proposals: [
      {
        kind: "todo",
        title: "创建待办",
        payload: { title: "验证接入" },
        confidence: 0.62,
        status: "pending",
      },
    ],
    ...overrides,
  };
}

function pageContext(
  pageType: WorkspacePageContextV1["pageType"],
): WorkspacePageContextV1 {
  return {
    version: 1,
    route: pageType === "workspace" ? "/workspace" : `/${pageType}`,
    pageType,
    capturedAt: "2026-09-05T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    trigger: {
      kind: "file_drop",
      clientBatchId: "client-batch-1",
    },
  };
}
