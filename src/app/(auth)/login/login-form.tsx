"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRedirectIfAuthenticated } from "@/hooks/use-require-auth";
import { loginSchema } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { safeNextPath } from "@/lib/auth/redirect";

export function LoginForm() {
  const auth = useRedirectIfAuthenticated();
  const search = useSearchParams();
  const nextPath = safeNextPath(search.get("next"));
  const missingConfig = search.get("missing_config");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(translateAuthError(result?.error ?? "登录失败"));
        return;
      }
      toast.success("登录成功");
      window.location.assign(nextPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : "登录失败";
      setError(
        message.includes("Supabase")
          ? "Supabase 尚未配置，请先填写 .env 环境变量。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#fbfbfa] text-[#141815] dark:bg-[#111310] dark:text-[#f5f6f3]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_42%,rgba(49,117,73,0.12),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.94),rgba(248,249,247,0.9))] dark:bg-[radial-gradient(circle_at_18%_42%,rgba(89,155,107,0.14),transparent_34%),linear-gradient(135deg,rgba(17,19,16,0.97),rgba(22,25,22,0.93))]" />
      <div className="absolute inset-x-0 top-0 h-12 border-b border-black/[0.06] bg-white/45 backdrop-blur-md dark:border-white/[0.08] dark:bg-white/[0.03]">
        <div className="flex h-full items-center gap-2 px-5">
          <span className="h-3 w-3 rounded-full bg-[#ed6a5e]" />
          <span className="h-3 w-3 rounded-full bg-[#f4bf4f]" />
          <span className="h-3 w-3 rounded-full bg-[#61c554]" />
        </div>
      </div>

      <div className="relative z-10 mx-auto grid min-h-[100dvh] w-full max-w-7xl grid-cols-1 px-6 pb-8 pt-20 lg:grid-cols-[1fr_540px] lg:gap-14 lg:px-10 lg:pt-24">
        <section className="hidden min-h-[640px] flex-col justify-between lg:flex">
          <BrandMark className="self-start" />

          <div className="max-w-xl pl-16">
            <h1 className="text-[46px] font-semibold leading-none tracking-[-0.06em] text-[#101411] dark:text-[#f6f7f4]">
              AI 工作站
            </h1>
            <p className="mt-6 text-[21px] font-medium tracking-[-0.03em] text-[#2f7447] dark:text-[#87b994]">
              登录到你的个人工作空间
            </p>
            <div className="mt-7 h-px w-28 bg-[#2f7447]/70" />
            <div className="mt-7 flex items-center gap-3 text-sm text-[#6a716b] dark:text-[#aeb5ae]">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#2f7447]/25 bg-white/70 text-[#2f7447] shadow-sm dark:bg-white/[0.04] dark:text-[#91c39b]">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <span>安全同步你的待办、日历与笔记</span>
            </div>

            <WorkspaceIllustration />
          </div>

          <FooterLinks />
        </section>

        <section className="flex min-h-[calc(100dvh-7rem)] items-center justify-center lg:min-h-[640px]">
          <div className="w-full max-w-[520px]">
            <div className="mb-8 flex items-center justify-center lg:hidden">
              <BrandMark />
            </div>

            <div className="rounded-[18px] border border-black/[0.08] bg-white/78 px-7 py-10 shadow-[0_18px_55px_rgba(15,23,18,0.10)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.04] dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] sm:px-10 sm:py-12">
              <div className="mb-9 text-center">
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#111512] dark:text-[#f4f6f3]">
                  欢迎回来
                </h2>
                <p className="mt-3 text-sm text-[#777d78] dark:text-[#aeb5ae]">
                  登录到你的个人工作空间
                </p>
              </div>

              {missingConfig === "supabase" || !auth.configured ? (
                <div className="mb-5 rounded-md border border-[#2f7447]/20 bg-[#2f7447]/8 px-3 py-2 text-sm leading-relaxed text-[#2f7447] dark:border-[#87b994]/20 dark:bg-[#87b994]/10 dark:text-[#9ed0a7]">
                  Supabase 尚未配置。请复制 .env.example 为 .env，并填写
                  NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY。
                </div>
              ) : null}

              <form onSubmit={onSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-medium text-[#171b18] dark:text-[#f2f4f1]">
                    用户名
                  </Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa09b]" />
                    <Input
                      id="username"
                      type="text"
                      autoComplete="username"
                      placeholder="请输入用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="h-12 rounded-lg border-[#e1e3df] bg-white/70 pl-11 text-[15px] shadow-none transition-colors placeholder:text-[#b4b9b4] focus-visible:border-[#2f7447] focus-visible:ring-[#2f7447]/15 dark:border-white/[0.1] dark:bg-white/[0.04] dark:placeholder:text-[#737a73]"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-[#171b18] dark:text-[#f2f4f1]">
                    密码
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa09b]" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-12 rounded-lg border-[#e1e3df] bg-white/70 pl-11 pr-11 text-[15px] shadow-none transition-colors placeholder:text-[#b4b9b4] focus-visible:border-[#2f7447] focus-visible:ring-[#2f7447]/15 dark:border-white/[0.1] dark:bg-white/[0.04] dark:placeholder:text-[#737a73]"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md text-[#8c938d] transition-colors hover:text-[#2f7447] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7447]/30"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex justify-end">
                    <Link
                      href="/forgot-password"
                      className="text-sm font-medium text-[#2f7447] underline-offset-4 transition-colors hover:text-[#225a36] hover:underline dark:text-[#8ec59a]"
                    >
                      忘记密码？
                    </Link>
                  </div>
                </div>

                {error ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-lg bg-[#2f7447] text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(47,116,71,0.25)] transition-all duration-200 hover:bg-[#28653e] active:scale-[0.99] disabled:opacity-70 dark:bg-[#3f8a58] dark:hover:bg-[#4a9a64]"
                >
                  {loading ? "登录中…" : "登录"}
                </Button>
              </form>

            </div>

            <div className="mt-8 lg:hidden">
              <FooterLinks />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid h-9 w-9 grid-cols-2 gap-1 rounded-lg border border-black/[0.06] bg-white p-2 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="rounded-[3px] bg-[#2f7447] dark:bg-[#8ec59a]" />
        ))}
      </div>
      <span className="text-base font-semibold tracking-[-0.03em]">AI 工作站</span>
    </div>
  );
}

function WorkspaceIllustration() {
  return (
    <div className="relative mt-16 h-[290px] w-[470px] opacity-95">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(47,116,71,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(47,116,71,0.06)_1px,transparent_1px)] bg-[size:42px_42px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      <div className="absolute left-12 top-24 h-px w-80 -rotate-[22deg] bg-gradient-to-r from-transparent via-[#2f7447]/20 to-transparent" />
      <div className="absolute left-40 top-3 h-px w-72 rotate-[25deg] bg-gradient-to-r from-transparent via-[#2f7447]/18 to-transparent" />

      <FloatingTile style={{ left: 0, top: 170 }} icon={<ClipboardList className="h-6 w-6" />} delay="0ms" />
      <FloatingTile style={{ left: 245, top: 34 }} icon={<CalendarDays className="h-6 w-6" />} delay="120ms" />
      <FloatingTile style={{ right: 36, bottom: 34 }} icon={<CheckSquare className="h-6 w-6" />} delay="240ms" />

      <div className="absolute left-[118px] top-[96px] h-[142px] w-[188px] rotate-[-24deg] rounded-[24px] border border-[#2f7447]/12 bg-white/58 shadow-[0_28px_70px_rgba(47,116,71,0.18)] backdrop-blur-md dark:bg-white/[0.05]">
        <div className="absolute inset-5 rounded-[18px] bg-[#2f7447]/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" />
        <div className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 grid-cols-2 gap-2 rotate-[24deg]">
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="h-8 w-10 rounded-xl bg-[#2f7447]/65 shadow-[0_10px_20px_rgba(47,116,71,0.22)]"
            />
          ))}
        </div>
      </div>

      {[[25, 55], [382, 70], [64, 240], [420, 220]].map(([x, y], i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full bg-[#2f7447]/55"
          style={{ left: x, top: y }}
        />
      ))}
    </div>
  );
}

function FloatingTile({
  icon,
  style,
  delay,
}: {
  icon: ReactNode;
  style: CSSProperties;
  delay: string;
}) {
  return (
    <div
      className="absolute flex h-24 w-28 rotate-[-24deg] items-center justify-center rounded-2xl border border-[#2f7447]/10 bg-white/56 text-[#2f7447]/70 shadow-[0_18px_45px_rgba(15,23,18,0.08)] backdrop-blur-md animate-float-slow dark:bg-white/[0.04] dark:text-[#91c39b]"
      style={{ ...style, animationDelay: delay }}
    >
      <div className="rotate-[24deg]">{icon}</div>
    </div>
  );
}

function FooterLinks() {
  return (
    <div className="text-center text-xs text-[#9aa09b] lg:text-left">
      © 2026 AI 工作站
      <span className="mx-2">·</span>
      <Link href="#" className="hover:text-[#2f7447]">隐私政策</Link>
      <span className="mx-2">·</span>
      <Link href="#" className="hover:text-[#2f7447]">服务条款</Link>
    </div>
  );
}

function translateAuthError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return "用户名或密码错误";
  if (/Email not confirmed/i.test(msg)) return "邮箱尚未验证";
  if (/rate limit/i.test(msg)) return "尝试次数过多，请稍后再试";
  return msg;
}
