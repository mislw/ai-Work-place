import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const INTERNAL_HERMES_ROOT = "/internal/hermes";
const INTERNAL_RUNS_ROOT = "/internal/hermes/runs";
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "host",
  "keep-alive",
  "origin",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-hermes-session-token",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

class RequestBodyTooLargeError extends Error {}

export interface InternalRunsProxyConfig {
  agentServiceSecret?: string;
  harnessUpstream: string;
  internalRunsUpstreamToken?: string;
}

export function mapInternalRunsPath(
  method: string,
  pathname: string,
): string | null {
  if (method === "POST" && pathname === INTERNAL_RUNS_ROOT) {
    return "/v1/runs";
  }
  const match = pathname.match(
    /^\/internal\/hermes\/runs\/([A-Za-z0-9_-]{1,200})(\/events|\/stop)?$/,
  );
  if (!match) return null;
  if (!match[2] && method === "GET") return `/v1/runs/${match[1]}`;
  if (match[2] === "/events" && method === "GET") {
    return `/v1/runs/${match[1]}/events`;
  }
  if (match[2] === "/stop" && method === "POST") {
    return `/v1/runs/${match[1]}/stop`;
  }
  return null;
}

export async function handleInternalRunsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: InternalRunsProxyConfig,
): Promise<boolean> {
  const rawTarget = request.url ?? "/";
  const queryIndex = rawTarget.indexOf("?");
  const pathname =
    queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  if (
    pathname !== INTERNAL_HERMES_ROOT &&
    !pathname.startsWith(`${INTERNAL_HERMES_ROOT}/`)
  ) {
    return false;
  }

  const upstreamPath =
    queryIndex === -1
      ? mapInternalRunsPath(request.method ?? "", pathname)
      : null;
  if (!upstreamPath) {
    sendText(response, 404, "Not Found");
    return true;
  }
  if (!config.agentServiceSecret || !config.internalRunsUpstreamToken) {
    sendText(response, 503, "Internal Runs proxy is not configured");
    return true;
  }
  if (!authorized(request, config.agentServiceSecret)) {
    sendText(response, 401, "Unauthorized");
    return true;
  }

  const abortController = new AbortController();
  const abortOnClose = () => {
    if (!response.writableEnded) abortController.abort();
  };
  response.once("close", abortOnClose);
  try {
    const body = await readRequestBody(request);
    const upstreamResponse = await fetch(
      new URL(upstreamPath, config.harnessUpstream),
      {
        body: body.length > 0 ? new Uint8Array(body) : undefined,
        headers: createUpstreamHeaders(
          request,
          config.internalRunsUpstreamToken,
        ),
        method: request.method,
        redirect: "manual",
        signal: abortController.signal,
      },
    );
    response.statusCode = upstreamResponse.status;
    copyResponseHeaders(upstreamResponse.headers, response);
    if (!upstreamResponse.body) {
      response.end();
      return true;
    }
    await pipeline(
      Readable.fromWeb(
        upstreamResponse.body as unknown as NodeReadableStream,
      ),
      response,
      { signal: abortController.signal },
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendText(response, 413, "Payload Too Large");
    } else if (abortController.signal.aborted || response.destroyed) {
      if (!response.destroyed) response.destroy();
    } else if (!response.headersSent) {
      sendText(response, 502, "Bad Gateway");
    } else {
      response.destroy();
    }
  } finally {
    response.off("close", abortOnClose);
  }
  return true;
}

function authorized(request: IncomingMessage, secret: string): boolean {
  const authorization = request.headers.authorization;
  const provided =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
  const providedBytes = Buffer.from(provided);
  const secretBytes = Buffer.from(secret);
  return (
    providedBytes.length === secretBytes.length &&
    timingSafeEqual(providedBytes, secretBytes)
  );
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"]);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    request.resume();
    throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function createUpstreamHeaders(
  request: IncomingMessage,
  upstreamSessionToken: string,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase()) || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  headers.set("Accept-Encoding", "identity");
  headers.set("X-Hermes-Session-Token", upstreamSessionToken);
  return headers;
}

function copyResponseHeaders(
  headers: Headers,
  response: ServerResponse,
): void {
  for (const [name, value] of headers) {
    if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  }
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}
