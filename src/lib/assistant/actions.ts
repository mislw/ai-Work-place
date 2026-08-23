import { z } from "zod";

const optionalText = z.string().trim().max(10_000).optional();
const idInput = z.object({ id: z.string().min(1).max(200) });

export const workbenchActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("calendar.list"),
    input: z.object({ date: z.string().date().optional() }).default({}),
  }),
  z.object({
    action: z.literal("calendar.create"),
    input: z.object({
      title: z.string().trim().min(1).max(200),
      description: optionalText,
      event_date: z.string().date(),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      is_all_day: z.boolean().optional(),
    }),
  }),
  z.object({
    action: z.literal("calendar.update"),
    input: idInput.extend({
      title: z.string().trim().min(1).max(200).optional(),
      description: optionalText,
      event_date: z.string().date().optional(),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      is_all_day: z.boolean().optional(),
    }),
  }),
  z.object({ action: z.literal("calendar.delete"), input: idInput }),
  z.object({
    action: z.literal("todo.list"),
    input: z
      .object({
        date: z.string().date().optional(),
        status: z.enum(["pending", "completed"]).optional(),
      })
      .default({}),
  }),
  z.object({
    action: z.literal("todo.create"),
    input: z.object({
      title: z.string().trim().min(1).max(200),
      description: optionalText,
      priority: z.enum(["low", "medium", "high"]).optional(),
      due_date: z.string().date().optional(),
      due_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    }),
  }),
  z.object({
    action: z.literal("todo.update"),
    input: idInput.extend({
      title: z.string().trim().min(1).max(200).optional(),
      description: optionalText,
      priority: z.enum(["low", "medium", "high"]).optional(),
      due_date: z.string().date().nullable().optional(),
      due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    }),
  }),
  z.object({ action: z.literal("todo.complete"), input: idInput }),
  z.object({ action: z.literal("todo.delete"), input: idInput }),
  z.object({
    action: z.literal("note.list"),
    input: z.object({ query: z.string().trim().max(200).optional() }).default({}),
  }),
  z.object({
    action: z.literal("note.create"),
    input: z.object({
      title: z.string().trim().min(1).max(200),
      content: z.string().max(50_000).optional(),
      summary: z.string().max(2_000).optional(),
      tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    }),
  }),
  z.object({
    action: z.literal("note.update"),
    input: idInput.extend({
      version: z.number().int().positive(),
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().max(50_000).optional(),
      summary: z.string().max(2_000).nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    }),
  }),
  z.object({ action: z.literal("note.delete"), input: idInput }),
  z.object({
    action: z.literal("document.list"),
    input: z.object({ query: z.string().trim().max(200).optional() }).default({}),
  }),
  z.object({
    action: z.literal("document.create"),
    input: z.object({
      title: z.string().trim().min(1).max(200),
      document_url: z.string().url().max(2_000),
      note: z.string().max(10_000).optional(),
    }),
  }),
  z.object({
    action: z.literal("document.update"),
    input: idInput.extend({
      title: z.string().trim().min(1).max(200).optional(),
      document_url: z.string().url().max(2_000).optional(),
      note: z.string().max(10_000).nullable().optional(),
    }),
  }),
  z.object({ action: z.literal("document.delete"), input: idInput }),
]);

export type WorkbenchAction = z.infer<typeof workbenchActionSchema>;
export type WorkbenchActionName = WorkbenchAction["action"];
export type ActionPolicy = "immediate" | "confirm";

export const WORKBENCH_ACTION_NAMES = workbenchActionSchema.options.map(
  (option) => option.shape.action.value,
) as WorkbenchActionName[];

export function getActionPolicy(action: WorkbenchActionName): ActionPolicy {
  return action.endsWith(".list") || action.endsWith(".create")
    ? "immediate"
    : "confirm";
}

export function parseWorkbenchActionBlocks(text: string): {
  text: string;
  actions: WorkbenchAction[];
} {
  const actions: WorkbenchAction[] = [];
  const visibleText = text.replace(
    /```workbench-action\s*\n([\s\S]*?)```/g,
    (_match, raw: string) => {
      try {
        actions.push(workbenchActionSchema.parse(JSON.parse(raw.trim())));
        return "";
      } catch {
        return "";
      }
    },
  );
  return { text: visibleText.trim(), actions };
}

export function summarizeActionResult(
  action: WorkbenchAction,
  result: unknown,
): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return "没有找到相关内容";
    const lines = result.slice(0, 5).map(formatResultRow);
    if (result.length > 5) lines.push(`另有 ${result.length - 5} 条`);
    return lines.join("\n");
  }

  if (isRecord(result)) {
    const detail = formatResultRow(result);
    if (action.action.endsWith(".create")) return `已创建：${detail}`;
    if (action.action === "todo.complete") return `已完成：${detail}`;
    if (action.action.endsWith(".delete")) return "已删除";
    return detail;
  }

  return "操作已完成";
}

function formatResultRow(value: unknown): string {
  if (!isRecord(value)) return String(value);
  const title = firstText(value.title, value.name, value.id, "未命名");
  const date = firstText(value.event_date, value.due_date, value.date);
  const time = normalizeTime(firstText(value.start_time, value.due_time));
  const status = firstText(value.status);
  return [title, [date, time].filter(Boolean).join(" "), status]
    .filter(Boolean)
    .join(" · ");
}

function normalizeTime(value: string) {
  return /^\d{2}:\d{2}:\d{2}$/.test(value) ? value.slice(0, 5) : value;
}

function firstText(...values: unknown[]): string {
  const value = values.find(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
