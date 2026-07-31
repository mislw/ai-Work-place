import { logger } from "@/lib/logger";
import type { AiActionType } from "@/types/domain";

/** AI Provider 配置（仅服务端）。 */
export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function readAIConfig(): AIConfig | null {
  const baseURL = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!baseURL || !apiKey || !model) return null;
  const timeout = Number.parseInt(process.env.AI_TIMEOUT_MS ?? "20000", 10);
  return {
    baseURL: baseURL.replace(/\/$/, ""),
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeout) ? timeout : 20000,
  };
}

export function isAIConfigured(): boolean {
  return readAIConfig() !== null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json" | "text";
}

export interface ChatResponse {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number;
}

export interface AIProvider {
  name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class AIProviderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
