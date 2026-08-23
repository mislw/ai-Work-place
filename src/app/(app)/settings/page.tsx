"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { useAuth } from "@/hooks/use-auth";
import { useUIStore } from "@/lib/stores/data";
import { signOut } from "@/hooks/use-require-auth";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Monitor, CheckCircle2, XCircle } from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuth();
  const { mode, setMode } = useThemeMode();
  const aiConfigured = useUIStore((s) => s.aiConfigured);
  const tencentConfigured = useUIStore((s) => s.tencentConfigured);
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // 持久化主题到 user_settings
  useEffect(() => {
    if (!user) return;
    fetch("/api/user-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: mode }),
    }).catch(() => null);
  }, [mode, user]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast.success("已退出登录");
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div data-crayon-page="settings" className="crayon-page">
      <PageHeader
        title="设置"
        description="外观、能力状态、账号"
      />
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 sm:px-6">
        <Card className="crayon-accent-yellow">
          <CardHeader>
            <CardTitle>外观</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="theme">主题</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as ThemeMode)}
              >
                <SelectTrigger id="theme" className="mt-1.5 w-full sm:w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <span className="flex items-center gap-2">
                      <Sun className="h-4 w-4" /> 明亮
                    </span>
                  </SelectItem>
                  <SelectItem value="dark">
                    <span className="flex items-center gap-2">
                      <Moon className="h-4 w-4" /> 暗色
                    </span>
                  </SelectItem>
                  <SelectItem value="system">
                    <span className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" /> 跟随系统
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="crayon-accent-green">
          <CardHeader>
            <CardTitle>能力状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <CapabilityRow label="AI 整理" enabled={aiConfigured} />
            <Separator />
            <CapabilityRow
              label="腾讯文档 API"
              enabled={tencentConfigured}
              hint={tencentConfigured ? undefined : "未配置时仅支持链接管理"}
            />
          </CardContent>
        </Card>

        <Card className="crayon-accent-red">
          <CardHeader>
            <CardTitle>账号</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">
              当前账号：<span className="text-foreground">{user?.email}</span>
            </div>
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              <LogOut className="h-4 w-4" />
              {signingOut ? "退出中…" : "退出登录"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CapabilityRow({
  label,
  enabled,
  hint,
}: {
  label: string;
  enabled: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {enabled ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-4 w-4" /> 已配置
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <XCircle className="h-4 w-4" /> 未配置
        </span>
      )}
    </div>
  );
}
