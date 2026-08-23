export type HarnessMethod =
  | "session.create"
  | "session.history"
  | "session.prompt"
  | "session.cancel";

export interface HarnessRequest<TPayload = Record<string, unknown>> {
  type: "client-request";
  rpcId: string;
  method: HarnessMethod;
  payload: TPayload;
}

export interface HarnessError {
  code: string;
  message: string;
  details?: unknown;
}

export interface HarnessEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: number;
  streaming: boolean;
}

export function buildHarnessRequest<TPayload>(
  method: HarnessMethod,
  payload: TPayload,
): HarnessRequest<TPayload> {
  return {
    type: "client-request",
    rpcId: crypto.randomUUID(),
    method,
    payload,
  };
}

export function getHarnessWebSocketUrl(bootstrapUrl: string): string {
  const url = new URL(bootstrapUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/events.mux";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function parseHarnessResponse<T>(body: unknown): T {
  if (!isRecord(body) || body.type !== "server-response") {
    throw new Error("Harness 返回了无效响应");
  }
  const result = body.result;
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error("Harness 返回了无效结果");
  }
  if (result.ok) return result.value as T;

  const error = isRecord(result.error) ? result.error : null;
  throw new Error(
    typeof error?.message === "string" ? error.message : "Harness 请求失败",
  );
}

export function reduceSessionEvents(events: HarnessEvent[]): AssistantMessage[] {
  const messages: AssistantMessage[] = [];
  const streamIndexes = new Map<string, number>();

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === "user/message") {
      const message = readMessage(event.data);
      if (!message) continue;
      messages.push({
        id: message.id,
        role: "user",
        text: message.text,
        time: event.time,
        streaming: false,
      });
      continue;
    }

    if (event.type === "assistant/chunk") {
      const chunk = readChunk(event.data);
      if (!chunk || chunk.type !== "text-delta" || !chunk.text) continue;
      const key = `${chunk.turn}:${chunk.step}`;
      const existingIndex = streamIndexes.get(key);
      if (existingIndex === undefined) {
        streamIndexes.set(key, messages.length);
        messages.push({
          id: `stream:${key}`,
          role: "assistant",
          text: chunk.text,
          time: event.time,
          streaming: true,
        });
      } else {
        const existing = messages[existingIndex];
        if (existing) existing.text += chunk.text;
      }
      continue;
    }

    if (event.type === "assistant/message") {
      const wrapped = isRecord(event.data) ? event.data : null;
      const message = readMessage(wrapped?.message);
      if (!message) continue;
      const key = `${readNumber(wrapped?.turn)}:${readNumber(wrapped?.step)}`;
      const existingIndex = streamIndexes.get(key);
      const complete: AssistantMessage = {
        id: message.id,
        role: "assistant",
        text: message.text,
        time: event.time,
        streaming: false,
      };
      if (existingIndex === undefined) {
        messages.push(complete);
      } else {
        messages[existingIndex] = complete;
        streamIndexes.delete(key);
      }
    }
  }

  return messages;
}

function readChunk(value: unknown) {
  if (!isRecord(value) || !isRecord(value.chunk)) return null;
  return {
    turn: readNumber(value.turn),
    step: readNumber(value.step),
    type: typeof value.chunk.type === "string" ? value.chunk.type : "",
    text: typeof value.chunk.text === "string" ? value.chunk.text : "",
  };
}

function readMessage(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const content = Array.isArray(value.content) ? value.content : [];
  const text = content
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("");
  return { id: value.id, text };
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
