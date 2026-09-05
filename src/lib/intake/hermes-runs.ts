import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 20_000;

const runStatusSchema = z.enum([
  "started",
  "queued",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "stopping",
  "cancelled",
]);

const runResponseSchema = z.object({
  run_id: z.string().min(1).max(200),
  status: runStatusSchema,
  output: z.string().max(1_000_000).optional(),
  error: z.string().max(10_000).optional(),
});

const eventsResponseSchema = z.object({
  status: z.number().int().min(200).max(299),
  contentType: z.string().regex(/^text\/event-stream(?:;|$)/i),
});

const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export type HermesRunStatus = z.infer<typeof runStatusSchema>;

export interface HermesRun {
  runId: string;
  status: HermesRunStatus;
  output?: string;
  errorCode?: string;
}

export interface CreateHermesRunInput {
  sessionId: string;
  prompt: string;
  metadata: {
    purpose: "workspace_file_intake";
    itemId: string;
    documentId: string;
  };
}

export interface HermesRunsClientConfig {
  origin: string;
  serviceSecret: string;
  timeoutMs?: number;
}

export type HermesRunsClientErrorCode =
  | "HERMES_RUN_HTTP_ERROR"
  | "HERMES_RUN_NETWORK_ERROR"
  | "HERMES_RUN_TIMEOUT"
  | "INVALID_HERMES_EVENTS_RESPONSE"
  | "INVALID_HERMES_RUN_CONFIG"
  | "INVALID_HERMES_RUN_ID"
  | "INVALID_HERMES_RUN_RESPONSE";

export class HermesRunsClientError extends Error {
  constructor(readonly code: HermesRunsClientErrorCode) {
    super(code);
    this.name = "HermesRunsClientError";
  }
}

export class HermesRunsClient {
  private readonly origin: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;

  constructor(config: HermesRunsClientConfig = readEnvironmentConfig()) {
    if (typeof window !== "undefined") {
      throw new HermesRunsClientError("INVALID_HERMES_RUN_CONFIG");
    }
    this.origin = parseOrigin(config.origin);
    if (new TextEncoder().encode(config.serviceSecret).length < 32) {
      throw new HermesRunsClientError("INVALID_HERMES_RUN_CONFIG");
    }
    this.serviceSecret = config.serviceSecret;
    this.timeoutMs =
      Number.isFinite(config.timeoutMs) && (config.timeoutMs ?? 0) > 0
        ? config.timeoutMs!
        : DEFAULT_TIMEOUT_MS;
  }

  async createRun(input: CreateHermesRunInput): Promise<HermesRun> {
    return this.requestRun("/internal/hermes/runs", {
      method: "POST",
      body: JSON.stringify({
        session_id: input.sessionId,
        input: input.prompt,
        metadata: {
          purpose: input.metadata.purpose,
          item_id: input.metadata.itemId,
          document_id: input.metadata.documentId,
        },
      }),
    });
  }

  async getRun(runId: string): Promise<HermesRun> {
    return this.requestRun(`/internal/hermes/runs/${parseRunId(runId)}`, {
      method: "GET",
    });
  }

  async getEvents(runId: string): Promise<Response> {
    return this.request(
      `/internal/hermes/runs/${parseRunId(runId)}/events`,
      {
        method: "GET",
        accept: "text/event-stream",
      },
      (response) => {
        const parsed = eventsResponseSchema.safeParse({
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
        });
        if (!parsed.success) {
          throw new HermesRunsClientError("INVALID_HERMES_EVENTS_RESPONSE");
        }
        return response;
      },
    );
  }

  async stopRun(runId: string): Promise<HermesRun> {
    return this.requestRun(
      `/internal/hermes/runs/${parseRunId(runId)}/stop`,
      { method: "POST" },
    );
  }

  private async requestRun(
    path: string,
    init: { method: "GET" | "POST"; body?: string },
  ): Promise<HermesRun> {
    return this.request(
      path,
      {
        ...init,
        accept: "application/json",
      },
      async (response) => {
        const json: unknown = await response.json();
        const parsed = runResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new HermesRunsClientError("INVALID_HERMES_RUN_RESPONSE");
        }
        return {
          runId: parsed.data.run_id,
          status: parsed.data.status,
          ...(parsed.data.output === undefined
            ? {}
            : { output: parsed.data.output }),
          ...(parsed.data.error === undefined
            ? {}
            : { errorCode: "HERMES_RUN_FAILED" }),
        };
      },
    );
  }

  private async request<T>(
    path: string,
    init: {
      method: "GET" | "POST";
      accept: "application/json" | "text/event-stream";
      body?: string;
    },
    consume: (response: Response) => T | Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.origin}${path}`, {
        method: init.method,
        headers: {
          accept: init.accept,
          authorization: `Bearer ${this.serviceSecret}`,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new HermesRunsClientError("HERMES_RUN_HTTP_ERROR");
      }
      return await consume(response);
    } catch (error) {
      if (error instanceof HermesRunsClientError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new HermesRunsClientError("HERMES_RUN_TIMEOUT");
      }
      if (error instanceof SyntaxError) {
        throw new HermesRunsClientError("INVALID_HERMES_RUN_RESPONSE");
      }
      throw new HermesRunsClientError("HERMES_RUN_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new HermesRunsClientError("INVALID_HERMES_RUN_CONFIG");
  }
}

function readEnvironmentConfig(): HermesRunsClientConfig {
  const origin = process.env.AGENT_INTERNAL_ORIGIN?.trim();
  const serviceSecret = process.env.AGENT_SERVICE_SECRET;
  if (!origin || !serviceSecret) {
    throw new HermesRunsClientError("INVALID_HERMES_RUN_CONFIG");
  }
  return { origin, serviceSecret };
}

function parseRunId(value: string): string {
  const parsed = runIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HermesRunsClientError("INVALID_HERMES_RUN_ID");
  }
  return parsed.data;
}
