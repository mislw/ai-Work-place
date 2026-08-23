import { z } from "zod";

export const emailSchema = z
  .string()
  .min(1, "请输入邮箱")
  .email("邮箱格式不正确");

export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码不能超过 72 位");

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "请输入用户名")
    .max(40, "用户名不能超过 40 位"),
  password: z.string().min(1, "请输入密码"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "请再次输入密码"),
    displayName: z.string().min(1, "请输入显示名称").max(40, "最多 40 字"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次密码不一致",
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const todoSchema = z.object({
  title: z.string().min(1, "请输入标题").max(200, "最多 200 字"),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式错误").nullable().optional(),
  due_time: z.string().regex(/^\d{2}:\d{2}$/, "时间格式错误").nullable().optional(),
});
export type TodoInput = z.infer<typeof todoSchema>;

export const eventSchema = z.object({
  title: z.string().min(1, "请输入标题").max(200),
  description: z.string().max(2000).nullable().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式错误"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  is_all_day: z.boolean().default(false),
});
export type EventInput = z.infer<typeof eventSchema>;

export const noteSchema = z.object({
  title: z.string().min(1, "请输入标题").max(200, "标题最多 200 字"),
  content: z.string().max(200_000, "内容过长，请分篇记录").default(""),
  summary: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().min(1).max(20)).max(20).default([]),
  is_pinned: z.boolean().default(false),
});
export type NoteInput = z.input<typeof noteSchema>;

const allowedDocsHost = (host: string): boolean => {
  const lower = host.toLowerCase();
  return (
    lower === "docs.qq.com" ||
    lower.endsWith(".docs.qq.com") ||
    lower === "qq.com" ||
    lower.endsWith(".qq.com")
  );
};

export const documentLinkSchema = z.object({
  title: z.string().min(1, "请输入标题").max(200),
  document_url: z
    .string()
    .url("链接格式不正确")
    .max(2048, "链接过长")
    .refine((u) => {
      try {
        return allowedDocsHost(new URL(u).host);
      } catch {
        return false;
      }
    }, "仅支持 docs.qq.com / *.qq.com 链接"),
  note: z.string().max(500).nullable().optional(),
});
export type DocumentLinkInput = z.infer<typeof documentLinkSchema>;

export const aiRequestSchema = z.object({
  action: z.enum([
    "summarize_notes",
    "extract_todos",
    "daily_digest",
    "plan_day",
    "search_notes",
    "summarize_note",
    "polish_note",
    "extract_actions",
    "free_chat",
  ]),
  prompt: z.string().max(2000).optional(),
  context: z.record(z.unknown()).optional(),
});
export type AiRequestInput = z.infer<typeof aiRequestSchema>;
