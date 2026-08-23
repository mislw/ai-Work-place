import { type NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/schemas";
import { createAuthRouteClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "请检查输入" },
      { status: 400 },
    );
  }

  try {
    const configuredUsername = process.env.LOGIN_USERNAME?.trim();
    const configuredEmail = process.env.LOGIN_EMAIL?.trim();
    if (!configuredUsername || !configuredEmail) {
      return NextResponse.json({ error: "登录账号未配置" }, { status: 500 });
    }
    if (
      parsed.data.username.toLowerCase() !== configuredUsername.toLowerCase()
    ) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const { supabase, applyCookies } = createAuthRouteClient(request);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: configuredEmail,
      password: parsed.data.password,
    });
    if (error) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }
    if (!data.session) {
      return NextResponse.json({ error: "登录会话创建失败" }, { status: 401 });
    }
    return applyCookies(NextResponse.json({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
