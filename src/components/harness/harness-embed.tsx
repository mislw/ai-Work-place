"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type BootstrapResponse = {
  url?: string;
  error?: {
    message?: string;
  };
};

type EmbedState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

const WRAPPER_CLASS =
  "fixed inset-y-0 left-0 right-0 h-svh bg-background md:left-[240px] lg:left-[256px]";

export function HarnessEmbed() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EmbedState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setState({ status: "loading" });

      try {
        const response = await fetch("/api/harness/bootstrap", {
          method: "POST",
          cache: "no-store",
        });
        const data = (await response.json()) as BootstrapResponse;

        if (!response.ok) {
          throw new Error(data.error?.message ?? "无法启动 AI 助手");
        }

        if (!data.url) {
          throw new Error("无法启动 AI 助手");
        }

        if (!cancelled) {
          setState({ status: "ready", url: data.url });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "无法启动 AI 助手",
          });
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section className={WRAPPER_CLASS}>
      {state.status === "loading" ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-label="加载中"
          />
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <iframe
          title="DeepSeek Harness"
          src={state.url}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : null}
    </section>
  );
}
