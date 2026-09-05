// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HermesRunsClient,
  HermesRunsClientError,
} from "@/lib/intake/hermes-runs";

const SERVICE_SECRET = "s".repeat(32);
const ORIGIN = "http://harness-gateway:8787";

describe("Hermes Runs client", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalInternalOrigin = process.env.AGENT_INTERNAL_ORIGIN;
  const originalServiceSecret = process.env.AGENT_SERVICE_SECRET;
  const originalPublicOrigin = process.env.NEXT_PUBLIC_AGENT_INTERNAL_ORIGIN;
  const originalPublicSecret = process.env.NEXT_PUBLIC_AGENT_SERVICE_SECRET;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.AGENT_INTERNAL_ORIGIN;
    delete process.env.AGENT_SERVICE_SECRET;
    delete process.env.NEXT_PUBLIC_AGENT_INTERNAL_ORIGIN;
    delete process.env.NEXT_PUBLIC_AGENT_SERVICE_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    restoreEnvironment("AGENT_INTERNAL_ORIGIN", originalInternalOrigin);
    restoreEnvironment("AGENT_SERVICE_SECRET", originalServiceSecret);
    restoreEnvironment(
      "NEXT_PUBLIC_AGENT_INTERNAL_ORIGIN",
      originalPublicOrigin,
    );
    restoreEnvironment(
      "NEXT_PUBLIC_AGENT_SERVICE_SECRET",
      originalPublicSecret,
    );
  });

  it("requires the two server-side environment variables for default configuration", async () => {
    process.env.AGENT_INTERNAL_ORIGIN = ORIGIN;
    process.env.AGENT_SERVICE_SECRET = SERVICE_SECRET;
    fetchMock.mockResolvedValue(
      Response.json({ run_id: "run-1", status: "queued" }),
    );

    await expect(
      new HermesRunsClient().createRun({
        sessionId: "intake:owner-1:item-1",
        prompt: "plan this document",
        metadata: {
          purpose: "workspace_file_intake",
          itemId: "item-1",
          documentId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).resolves.toEqual({ runId: "run-1", status: "queued" });
  });

  it("does not accept browser-exposed environment aliases", () => {
    process.env.NEXT_PUBLIC_AGENT_INTERNAL_ORIGIN = ORIGIN;
    process.env.NEXT_PUBLIC_AGENT_SERVICE_SECRET = SERVICE_SECRET;

    expect(() => new HermesRunsClient()).toThrow("INVALID_HERMES_RUN_CONFIG");
  });

  it("creates an owner-scoped intake run through the internal Gateway", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ run_id: "run-1", status: "queued" }),
    );
    const client = createClient();

    await expect(
      client.createRun({
        sessionId: "intake:owner-1:item-1",
        prompt: "plan this document",
        metadata: {
          purpose: "workspace_file_intake",
          itemId: "item-1",
          documentId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).resolves.toEqual({ runId: "run-1", status: "queued" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/internal/hermes/runs`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "application/json",
          authorization: `Bearer ${SERVICE_SECRET}`,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          session_id: "intake:owner-1:item-1",
          prompt: "plan this document",
          metadata: {
            purpose: "workspace_file_intake",
            item_id: "item-1",
            document_id: "11111111-1111-4111-8111-111111111111",
          },
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty(
      "ownerId",
    );
  });

  it("validates status responses and normalizes optional output and error code", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        run_id: "run-1",
        status: "failed",
        output: '{"version":1}',
        error: { code: "MODEL_FAILED" },
      }),
    );

    await expect(createClient().getRun("run-1")).resolves.toEqual({
      runId: "run-1",
      status: "failed",
      output: '{"version":1}',
      errorCode: "MODEL_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/internal/hermes/runs/run-1`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("posts stop requests and validates their response", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ run_id: "run-1", status: "stopped" }),
    );

    await expect(createClient().stopRun("run-1")).resolves.toEqual({
      runId: "run-1",
      status: "stopped",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/internal/hermes/runs/run-1/stop`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns a successful SSE response without consuming its stream", async () => {
    const response = new Response("data: ready\n\n", {
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
    fetchMock.mockResolvedValue(response);

    const result = await createClient().getEvents("run-1");

    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/internal/hermes/runs/run-1/events`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          accept: "text/event-stream",
          authorization: `Bearer ${SERVICE_SECRET}`,
        }),
      }),
    );
  });

  it("aborts a request after the configured timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const result = expect(
      createClient({ timeoutMs: 25 }).getRun("run-1"),
    ).rejects.toMatchObject({
      code: "HERMES_RUN_TIMEOUT",
      message: "HERMES_RUN_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(25);

    await result;
  });

  it.each([
    {
      name: "non-JSON success",
      response: new Response("not-json"),
      code: "INVALID_HERMES_RUN_RESPONSE",
    },
    {
      name: "malformed JSON success",
      response: Response.json({ run_id: "", status: "surprise" }),
      code: "INVALID_HERMES_RUN_RESPONSE",
    },
    {
      name: "upstream error",
      response: new Response("upstream raw body: private", { status: 502 }),
      code: "HERMES_RUN_HTTP_ERROR",
    },
  ])("sanitizes $name errors", async ({ response, code }) => {
    fetchMock.mockResolvedValue(response);

    let thrown: unknown;
    try {
      await createClient().getRun("run-1");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HermesRunsClientError);
    expect(thrown).toMatchObject({ code, message: code });
    expect(String((thrown as Error).message)).not.toContain(SERVICE_SECRET);
    expect(String((thrown as Error).message)).not.toContain("private");
    expect(String((thrown as Error).message)).not.toContain("not-json");
  });

  it("does not expose fetch error details or the service secret", async () => {
    fetchMock.mockRejectedValue(
      new Error(`failed with ${SERVICE_SECRET}: upstream raw body`),
    );

    await expect(createClient().getRun("run-1")).rejects.toMatchObject({
      code: "HERMES_RUN_NETWORK_ERROR",
      message: "HERMES_RUN_NETWORK_ERROR",
    });
  });

  it("rejects a non-SSE events response without consuming its raw body", async () => {
    const response = new Response(`private ${SERVICE_SECRET}`, {
      headers: { "content-type": "application/json" },
    });
    fetchMock.mockResolvedValue(response);

    await expect(createClient().getEvents("run-1")).rejects.toMatchObject({
      code: "INVALID_HERMES_EVENTS_RESPONSE",
      message: "INVALID_HERMES_EVENTS_RESPONSE",
    });
    expect(response.bodyUsed).toBe(false);
  });
});

function createClient(overrides: { timeoutMs?: number } = {}) {
  return new HermesRunsClient({
    origin: ORIGIN,
    serviceSecret: SERVICE_SECRET,
    ...overrides,
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
