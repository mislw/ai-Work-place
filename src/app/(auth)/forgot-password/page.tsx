"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRedirectIfAuthenticated } from "@/hooks/use-require-auth";
import { emailSchema } from "@/lib/schemas";

export default function ForgotPasswordPage() {
  useRedirectIfAuthenticated();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请输入有效邮箱");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/login`,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    toast.success("重置邮件已发送");
  }

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">找回密码</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            我们会向你的邮箱发送重置链接
          </p>
        </div>
        {done ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm shadow-sm">
            <p className="text-foreground">邮件已发送，请前往邮箱查收。</p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground"
            >
              返回登录
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "发送中…" : "发送重置邮件"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
