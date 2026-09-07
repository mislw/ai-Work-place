"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getLocalToolboxHealth,
  getLocalToolboxOrigin,
  type LocalToolboxHealth,
} from "@/lib/local-toolbox/client";

type HelperState =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "connected"; health: LocalToolboxHealth };

export function ArchiveExtractorTool() {
  const [state, setState] = useState<HelperState>({ kind: "checking" });

  const checkHealth = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const health = await getLocalToolboxHealth();
      setState({ kind: "connected", health });
    } catch {
      setState({ kind: "offline" });
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const status =
    state.kind === "checking"
      ? "正在检查本机助手"
      : state.kind === "offline"
        ? "本机助手未启动"
        : state.health.winRarAvailable || state.health.sevenZipAvailable
          ? "本机助手已连接"
          : "未检测到解压引擎";

  return (
    <Card className="crayon-accent-green">
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-[#4b8b58]" />
            解压小工具
          </CardTitle>
          <CardDescription>普通压缩包、伪后缀、数字分卷和嵌套压缩包</CardDescription>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground/75">
          <ShieldCheck className="h-4 w-4 text-[#4b8b58]" />
          {status}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === "offline" ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>在本机项目目录运行：</p>
            <code className="block w-fit rounded border border-border bg-muted px-2 py-1 text-foreground">
              npm run toolbox:local
            </code>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              window.open(
                `${getLocalToolboxOrigin()}/`,
                "local-toolbox",
                "popup=yes,width=820,height=680,resizable=yes,scrollbars=yes",
              )
            }
          >
            <ExternalLink className="h-4 w-4" />
            打开解压小工具
          </Button>
          {state.kind === "offline" ? (
            <Button variant="outline" onClick={() => void checkHealth()}>
              <RefreshCw className="h-4 w-4" />
              重试连接
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
