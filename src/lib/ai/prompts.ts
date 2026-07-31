import { type AIProvider, type ChatRequest, type ChatResponse } from "./provider";
import { getProvider } from "./openai-compatible";
import type { AiActionType } from "@/types/domain";

/** 提示词模板。集中管理，便于后续调整语气与约束。 */
export const PROMPTS = {
  systemBase: (action: AiActionType): string =>
    [
      "你是一名个人工作助理，回答必须简洁、中文、可以使用 Markdown。",
      "禁止输出与个人生产力无关的内容，禁止编造不存在的待办或日程。",
      "当前操作类型：" + action,
    ].join("\n"),

  summarizeNotes: () =>
    "请基于我最近的笔记，提炼 3-5 条要点。优先输出结论，少展开细节。使用 Markdown 列表。",

  extractTodos: () =>
    "请从下列内容中提取可以转化为待办的事项。输出必须是严格 JSON 数组，字段为：title, description, priority(可选 low/medium/high), due_date(可选 yyyy-MM-dd)。不要输出其他解释文字。",

  dailyDigest: () =>
    "请基于今天的笔记和已有待办，生成一份 200 字以内的「今日工作总结」草稿，使用 Markdown。",

  planDay: () =>
    "请基于今天的待办和已有日程，输出一份 4-6 步的「今日任务安排」，按时间顺序排列，使用 Markdown 列表。",

  searchNotes: () =>
    "请基于我的笔记，给出与主题最相关的 5 条记录摘要，输出 JSON 数组 [{id_hint, title, snippet}]。如果没有匹配，直接返回空数组。",

  summarizeNote: () =>
    "请对当前笔记做一段不超过 120 字的总结，输出纯文本，不要 Markdown。",

  polishNote: () =>
    "请在保留原意的基础上润色下方文字，更通顺、更专业。直接返回润色后的纯文本，不要解释。",

  extractActions: () =>
    "请从当前笔记中提取行动项，输出严格 JSON 数组 [{title, priority?}，priority 可选 low/medium/high。",

  freeChat: () => "你是一名简洁、克制、中文优先的工作助理。",
};

export async function runAI(
  action: AiActionType,
  userPrompt: string,
  context?: Record<string, unknown>,
): Promise<ChatResponse & { action: AiActionType }> {
  const provider = getProvider();
  if (!provider) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const req: ChatRequest = {
    messages: [
      { role: "system", content: PROMPTS.systemBase(action) },
      ...(context?.messages as never) || [],
      { role: "user", content: composeUserPrompt(action, userPrompt, context) },
    ],
    responseFormat: needsJson(action) ? "json" : "text",
  };
  const res = await provider.chat(req);
  return { ...res, action };
}

function needsJson(action: AiActionType): boolean {
  return action === "extract_todos" || action === "search_notes" || action === "extract_actions";
}

function composeUserPrompt(
  action: AiActionType,
  userPrompt: string,
  context?: Record<string, unknown>,
): string {
  switch (action) {
    case "summarize_notes": {
      const notes = (context?.notes as Array<{ title: string; content: string }>) ?? [];
      return [
        PROMPTS.summarizeNotes(),
        "---",
        notes.map((n) => `# ${n.title}\n${n.content}`).join("\n\n"),
        userPrompt ? `附加要求：${userPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "extract_todos": {
      const text = (context?.text as string) ?? userPrompt;
      return [PROMPTS.extractTodos(), "---", text].join("\n");
    }
    case "daily_digest": {
      const todos = (context?.todos as string[]) ?? [];
      const notes = (context?.notes as string[]) ?? [];
      return [
        PROMPTS.dailyDigest(),
        "今日待办：",
        todos.map((t) => `- ${t}`).join("\n"),
        "今日笔记摘要：",
        notes.join("\n"),
      ].join("\n");
    }
    case "plan_day": {
      const todos = (context?.todos as string[]) ?? [];
      const events = (context?.events as string[]) ?? [];
      return [
        PROMPTS.planDay(),
        "今日待办：",
        todos.map((t) => `- ${t}`).join("\n"),
        "今日日程：",
        events.map((e) => `- ${e}`).join("\n"),
        userPrompt ? `附加要求：${userPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "search_notes": {
      const query = (context?.query as string) ?? userPrompt;
      const notes = (context?.notes as Array<{ id: string; title: string; content: string }>) ?? [];
      return [
        PROMPTS.searchNotes(),
        "查询主题：" + query,
        "---",
        notes.map((n) => `[id=${n.id}] # ${n.title}\n${n.content}`).join("\n\n"),
      ].join("\n");
    }
    case "summarize_note": {
      const content = (context?.content as string) ?? userPrompt;
      return [PROMPTS.summarizeNote(), "---", content].join("\n");
    }
    case "polish_note": {
      const content = (context?.content as string) ?? userPrompt;
      return [PROMPTS.polishNote(), "---", content].join("\n");
    }
    case "extract_actions": {
      const content = (context?.content as string) ?? userPrompt;
      return [PROMPTS.extractActions(), "---", content].join("\n");
    }
    case "free_chat":
    default:
      return userPrompt || "你好";
  }
}
