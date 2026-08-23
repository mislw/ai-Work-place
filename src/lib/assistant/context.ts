import {
  WORKBENCH_ACTION_NAMES,
  type WorkbenchAction,
} from "@/lib/assistant/actions";

const CONTEXT_START = "<workbench-context>";
const CONTEXT_END = "</workbench-context>";
const ACTION_RESULT_START = "<workbench-action-result>";
const ACTION_RESULT_END = "</workbench-action-result>";

export interface WorkbenchContext {
  page: string;
  date: string;
  timeZone: string;
}

export function buildWorkbenchPrompt(
  userText: string,
  context: WorkbenchContext,
): string {
  const instructions = [
    CONTEXT_START,
    "You are the personal assistant inside a Chinese productivity workbench.",
    `page: ${context.page}`,
    `date: ${context.date}`,
    `time_zone: ${context.timeZone}`,
    `available_actions: ${WORKBENCH_ACTION_NAMES.join(", ")}`,
    "Use ordinary Chinese conversation unless the user asks otherwise.",
    "Do not claim an action succeeded before the workbench returns a result.",
    "When an action is useful, add one fenced workbench-action JSON block per action.",
    'Example: ```workbench-action\n{"action":"todo.create","input":{"title":"整理 UI"}}\n```',
    "Create and list actions may run immediately. Update, complete, and delete require user confirmation in the UI.",
    "Keep action JSON concise. Do not include user_id or authentication data.",
    CONTEXT_END,
    userText.trim(),
  ];
  return instructions.join("\n");
}

export function stripWorkbenchContext(text: string): string {
  return stripTaggedBlock(
    stripTaggedBlock(text, CONTEXT_START, CONTEXT_END),
    ACTION_RESULT_START,
    ACTION_RESULT_END,
  ).trim();
}

export function buildWorkbenchActionResultPrompt(
  action: WorkbenchAction,
  result: unknown,
): string {
  const payload = JSON.stringify({
    action: action.action,
    input: action.input,
    result: compactResult(result),
  });
  return [
    ACTION_RESULT_START,
    payload,
    "请基于这次工作台查询的真实结果自然回答用户。不要再次调用同一个查询，也不要展示协议标签。",
    ACTION_RESULT_END,
  ].join("\n");
}

function stripTaggedBlock(text: string, startTag: string, endTag: string) {
  let value = text;
  let start = value.indexOf(startTag);
  while (start >= 0) {
    const end = value.indexOf(endTag, start + startTag.length);
    if (end < start) break;
    value = `${value.slice(0, start)}${value.slice(end + endTag.length)}`;
    start = value.indexOf(startTag);
  }
  return value;
}

function compactResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      total: value.length,
      items: value.slice(0, 5).map(compactResult),
    };
  }
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 10)
      .map(([key, item]) => [key, compactResult(item)]),
  );
}
