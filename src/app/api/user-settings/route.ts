import { NextResponse } from "next/server";
import { z } from "zod";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const schema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

export async function GET() {
  const supabase = await createRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ theme: "system" });
  const { data } = await supabase
    .from("user_settings")
    .select("theme")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ theme: data?.theme ?? "system" });
}

export async function POST(req: Request) {
  const supabase = await createRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "未登录" } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "参数错误" } },
      { status: 400 },
    );
  }
  await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, theme: parsed.data.theme });
  return NextResponse.json({ ok: true });
}
