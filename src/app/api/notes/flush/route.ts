import { NextResponse } from "next/server";
import { z } from "zod";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const schema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(0),
  title: z.string().min(1).max(200),
  content: z.string().max(200_000),
  tags: z.array(z.string().min(1).max(20)).max(20).default([]),
});

/** 页面关闭前的最后保存兜底（使用 sendBeacon 调用）。 */
export async function POST(req: Request) {
  const supabase = createRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "未登录" } },
      { status: 401 },
    );
  }
  const text = await req.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "参数错误" } },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "参数错误" } },
      { status: 400 },
    );
  }
  try {
    const { data, error } = await supabase
      .from("notes")
      .update({
        title: parsed.data.title,
        content: parsed.data.content,
        tags: parsed.data.tags,
      })
      .eq("id", parsed.data.id)
      .eq("version", parsed.data.version)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "版本冲突" } },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error("notes.flush", { err: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "保存失败" } },
      { status: 500 },
    );
  }
}
