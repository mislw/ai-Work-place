"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRedirectIfAuthenticated } from "@/hooks/use-require-auth";
import { registerSchema } from "@/lib/schemas";

export default function RegisterPage() {
  useRedirectIfAuthenticated();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({
      email,
      displayName,
      password,
      confirmPassword,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { display_name: parsed.data.displayName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setLoading(false);
    if (err) {
      setError(translateAuthError(err.message));
      return;
    }
    // 如果 Supabase 项目关闭了 "Confirm email"，session 会立即返回
    if (data.session) {
      toast.success("注册成功");
      router.replace("/workspace");
      router.refresh();
    } else {
      toast.success("注册成功，请前往邮箱完成验证");
      router.replace("/login");
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">创建账号</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            开始管理你的每日工作
          </p>
        </div>
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1.5">
            <Label htmlFor="displayName">显示名称</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：YUAN"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">再次输入密码</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "提交中…" : "注册"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          已有账号？
          <Link
            href="/login"
            className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            直接登录
          </Link>
        </p>
      </div>
    </div>
  );
}

function translateAuthError(msg: string): string {
  if (/already registered/i.test(msg)) return "该邮箱已注册";
  if (/Password should be/i.test(msg)) return "密码强度不足，至少 8 位";
  if (/rate limit/i.test(msg)) return "尝试次数过多，请稍后再试";
  return msg;
}
