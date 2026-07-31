import {
  type AIProvider,
  type AIConfig,
  type ChatRequest,
  type ChatResponse,
  AIProviderError,
} from "./provider";
import { logger } from "@/lib/logger";

/** OpenAI 兼容实现（覆盖 OpenAI、DeepSeek、智谱、Moonshot、OneAPI 等）。 */
export class OpenAICompatibleProvider implements AIProvider {
  name = "openai-compatible";
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const started = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: req.model ?? this.config.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 1024,
      };
      if (req.responseFormat === "json") {
        body.response_format = { type: "json_object" };
      }
      const url = `${this.config.baseURL}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const duration = Date.now() - started;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("ai.request", {
          status: res.status,
          duration,
          model: this.config.model,
        });
        throw new AIProviderError(
          `HTTP_${res.status}`,
          `AI 接口返回 ${res.status}：${text.slice(0, 160)}`,
        );
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (!content) {
        throw new AIProviderError("EMPTY", "AI 返回内容为空");
      }
      return {
        content,
        model: json.model ?? this.config.model,
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        durationMs: duration,
      };
    } catch (e) {
      if (e instanceof AIProviderError) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new AIProviderError("TIMEOUT", "AI 请求超时");
      }
      logger.error("ai.network", { err: e instanceof Error ? e.message : "unknown" });
      throw new AIProviderError("NETWORK", "AI 接口不可达");
    } finally {
      clearTimeout(timer);
    }
  }
}

import {
  readAIConfig,
  type AIProvider as AIProviderType,
} from "./provider";

let cachedProvider: AIProviderType | null | undefined;

export function getProvider(): AIProviderType | null {
  if (cachedProvider !== undefined) return cachedProvider;
  const config = readAIConfig();
  if (!config) {
    cachedProvider = null;
    return null;
  }
  cachedProvider = new OpenAICompatibleProvider(config);
  return cachedProvider;
}
