import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { getGatewayConfig, type GatewayConfig } from "../src/config.js";
import { createGatewayServer } from "../src/server.js";
import { signSessionToken } from "../src/tokens.js";

const embedSecret = "embed-secret-0123456789abcdef0123";
const agentServiceSecret = "service-secret-0123456789abcdef01";
const upstreamToken = "upstream-token-0123456789abcdef012";
const fallbackUpstreamToken = "hermes-token-0123456789abcdef012345";
const toolSecret = "tool-secret-0123456789abcdef01234";

function validEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    AGENT_SERVICE_SECRET: agentServiceSecret,
    AGENT_UPSTREAM_SESSION_TOKEN: upstreamToken,
    HARNESS_EMBED_SECRET: embedSecret,
    HARNESS_OWNER_USER_ID: "owner-1",
    HARNESS_UPSTREAM: "http://127.0.0.1:3080",
    ...overrides,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

function request(
  origin: string,
  path: string,
  options: {
    body?: Buffer | string;
    headers?: http.OutgoingHttpHeaders;
    method?: string;
  } = {},
): Promise<{
  body: string;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
}> {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = <T>(
      callback: (value: T) => void,
      value: T,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const clientRequest = http.request(
      {
        agent: false,
        headers: {
          Connection: "close",
          ...options.headers,
        },
        hostname: target.hostname,
        method: options.method ?? "GET",
        path,
        port: target.port,
        protocol: target.protocol,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("aborted", () => {
          finish(reject, new Error("Gateway response aborted"));
        });
        response.once("error", (error) => finish(reject, error));
        response.on("end", () => {
          finish(
            resolve,
            {
              body: Buffer.concat(chunks).toString("utf8"),
              headers: response.headers,
              statusCode: response.statusCode ?? 0,
            },
          );
        });
      },
    );
    const timer = setTimeout(() => {
      clientRequest.destroy(new Error("Gateway request timed out"));
    }, 2_000);
    timer.unref();
    clientRequest.once("error", (error) => finish(reject, error));
    if (options.body !== undefined) clientRequest.write(options.body);
    clientRequest.end();
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${milliseconds}ms`)),
      milliseconds,
    );
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("agent service secret configuration", () => {
  it("requires at least 32 UTF-8 bytes", () => {
    assert.throws(
      () =>
        getGatewayConfig(
          validEnvironment({ AGENT_SERVICE_SECRET: "short" }),
        ),
      /AGENT_SERVICE_SECRET must be at least 32 bytes/,
    );
  });

  it("allows startup without internal Runs credentials", () => {
    const environment = validEnvironment();
    delete environment.AGENT_SERVICE_SECRET;
    delete environment.AGENT_UPSTREAM_SESSION_TOKEN;

    const config = getGatewayConfig(environment);

    assert.equal(config.agentServiceSecret, undefined);
    assert.equal(config.internalRunsUpstreamToken, undefined);
  });

  it("returns the dedicated internal Runs upstream token", () => {
    const config = getGatewayConfig(validEnvironment());

    assert.equal(config.internalRunsUpstreamToken, upstreamToken);
  });

  for (const [name, primary] of [
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", " \t "],
  ] as const) {
    it(`falls back to the trimmed Hermes token when primary is ${name}`, () => {
      const config = getGatewayConfig(
        validEnvironment({
          AGENT_UPSTREAM_SESSION_TOKEN: primary,
          HERMES_DASHBOARD_SESSION_TOKEN: `  ${fallbackUpstreamToken}  `,
        }),
      );

      assert.equal(config.internalRunsUpstreamToken, fallbackUpstreamToken);
    });
  }

  it("prefers and trims a nonblank primary upstream token", () => {
    const config = getGatewayConfig(
      validEnvironment({
        AGENT_UPSTREAM_SESSION_TOKEN: `  ${upstreamToken}  `,
        HERMES_DASHBOARD_SESSION_TOKEN: fallbackUpstreamToken,
      }),
    );

    assert.equal(config.internalRunsUpstreamToken, upstreamToken);
  });

  it("validates a configured internal Runs upstream token", () => {
    assert.throws(
      () =>
        getGatewayConfig(
          validEnvironment({ AGENT_UPSTREAM_SESSION_TOKEN: "  short  " }),
        ),
      /AGENT_UPSTREAM_SESSION_TOKEN must be at least 32 bytes/,
    );
  });

  for (const [name, overrides] of [
    [
      "embed secret",
      {
        HARNESS_EMBED_SECRET: agentServiceSecret,
      },
    ],
    [
      "upstream session token",
      {
        AGENT_UPSTREAM_SESSION_TOKEN: agentServiceSecret,
      },
    ],
    [
      "MCP tool secret",
      {
        AGENT_SERVICE_SECRET: toolSecret,
        AI_WORKSPACE_TOOL_URL: "https://workspace.example.com/api/tools",
        HARNESS_TOOL_SECRET: toolSecret,
      },
    ],
  ] as const) {
    it(`rejects a service secret equal to the ${name}`, () => {
      assert.throws(
        () => getGatewayConfig(validEnvironment(overrides)),
        /AGENT_SERVICE_SECRET must be distinct/,
      );
    });
  }
});

describe("internal Runs proxy", () => {
  let gateway: Server;
  let gatewayOrigin: string;
  let upstream: Server;
  let upstreamOrigin: string;
  let config: GatewayConfig;
  let lastUpstreamAcceptEncoding: string | undefined;
  let resolveHangingUpstreamClosed: (() => void) | undefined;

  before(async () => {
    upstream = http.createServer((upstreamRequest, upstreamResponse) => {
      const chunks: Buffer[] = [];
      upstreamRequest.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstreamRequest.on("end", () => {
        lastUpstreamAcceptEncoding =
          upstreamRequest.headers["accept-encoding"];
        upstreamResponse.setHeader("Set-Cookie", "upstream=secret; Path=/");
        upstreamResponse.setHeader("Set-Cookie2", "legacy=secret; Path=/");
        if (upstreamRequest.url === "/v1/runs/run-gzip") {
          const body = Buffer.from("decompressed Hermes status payload");
          const compressed = gzipSync(body);
          upstreamResponse.setHeader("Content-Encoding", "gzip");
          upstreamResponse.setHeader("Content-Length", compressed.length);
          upstreamResponse.setHeader("Content-Type", "text/plain");
          upstreamResponse.end(compressed);
          return;
        }
        if (upstreamRequest.url === "/v1/runs/run-hang/events") {
          upstreamResponse.setHeader("Content-Type", "text/event-stream");
          upstreamResponse.once("close", () => {
            resolveHangingUpstreamClosed?.();
          });
          upstreamResponse.flushHeaders();
          upstreamResponse.write("data: first\n\n");
          return;
        }
        if (upstreamRequest.url?.endsWith("/events")) {
          upstreamResponse.setHeader("Content-Type", "text/event-stream");
          upstreamResponse.end("data: ready\n\n");
          return;
        }
        upstreamResponse.setHeader("Content-Type", "application/json");
        upstreamResponse.end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: upstreamRequest.headers,
            method: upstreamRequest.method,
            path: upstreamRequest.url,
          }),
        );
      });
    });
    const upstreamPort = await listen(upstream);
    upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;

    config = getGatewayConfig(
      validEnvironment({ HARNESS_UPSTREAM: upstreamOrigin }),
    );
    gateway = createGatewayServer(config);
    const gatewayPort = await listen(gateway);
    gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
  });

  after(async () => {
    await closeServer(gateway);
    await closeServer(upstream);
  });

  it("does not accept a valid browser cookie as internal authorization", async () => {
    const browserToken = await signSessionToken("owner-1", config);
    const response = await request(gatewayOrigin, "/internal/hermes/runs", {
      headers: { Cookie: `dsh_embed=${browserToken}` },
      method: "POST",
    });

    assert.equal(response.statusCode, 401);
  });

  it("starts without internal credentials and returns 503 only for internal routes", async () => {
    const environment = validEnvironment({ HARNESS_UPSTREAM: upstreamOrigin });
    delete environment.AGENT_SERVICE_SECRET;
    delete environment.AGENT_UPSTREAM_SESSION_TOKEN;
    const noInternalConfig = getGatewayConfig(environment);
    const noInternalGateway = createGatewayServer(noInternalConfig);
    const noInternalPort = await listen(noInternalGateway);
    const noInternalOrigin = `http://127.0.0.1:${noInternalPort}`;

    try {
      assert.equal(
        (await request(noInternalOrigin, "/health")).statusCode,
        200,
      );
      assert.equal(
        (
          await request(noInternalOrigin, "/internal/hermes/runs", {
            method: "POST",
          })
        ).statusCode,
        503,
      );
    } finally {
      await closeServer(noInternalGateway);
    }
  });

  it("forwards an allowlisted request with only the upstream credential", async () => {
    const response = await request(
      gatewayOrigin,
      "/internal/hermes/runs/run-1/stop",
      {
        body: '{"reason":"user"}',
        headers: {
          Authorization: `Bearer ${agentServiceSecret}`,
          Cookie: "browser=secret",
          Cookie2: "legacy-browser=secret",
          Origin: "https://evil.example",
          "Proxy-Authorization": "Basic proxy-secret",
          "X-Hermes-Session-Token": "attacker-token",
          "Content-Type": "application/json",
          "X-Request-Id": "request-1",
        },
        method: "POST",
      },
    );
    const forwarded = JSON.parse(response.body) as {
      body: string;
      headers: http.IncomingHttpHeaders;
      method: string;
      path: string;
    };

    assert.equal(response.statusCode, 200);
    assert.equal(forwarded.path, "/v1/runs/run-1/stop");
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.body, '{"reason":"user"}');
    assert.equal(forwarded.headers["x-hermes-session-token"], upstreamToken);
    assert.equal(forwarded.headers.authorization, undefined);
    assert.equal(forwarded.headers.cookie, undefined);
    assert.equal(forwarded.headers.cookie2, undefined);
    assert.equal(forwarded.headers.origin, undefined);
    assert.equal(forwarded.headers["proxy-authorization"], undefined);
    assert.equal(forwarded.headers["x-request-id"], "request-1");
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(response.headers["set-cookie2"], undefined);
  });

  it("maps create and status requests to the matching upstream paths", async () => {
    const create = await request(gatewayOrigin, "/internal/hermes/runs", {
      headers: { Authorization: `Bearer ${agentServiceSecret}` },
      method: "POST",
    });
    const status = await request(
      gatewayOrigin,
      "/internal/hermes/runs/run_1",
      {
        headers: { Authorization: `Bearer ${agentServiceSecret}` },
      },
    );

    assert.equal(
      (JSON.parse(create.body) as { path: string }).path,
      "/v1/runs",
    );
    assert.equal(
      (JSON.parse(status.body) as { path: string }).path,
      "/v1/runs/run_1",
    );
  });

  it("preserves an upstream SSE response content type", async () => {
    const response = await request(
      gatewayOrigin,
      "/internal/hermes/runs/run-1/events",
      {
        headers: {
          Authorization: `Bearer ${agentServiceSecret}`,
          Accept: "text/event-stream",
        },
      },
    );

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/event-stream/i);
    assert.equal(response.body, "data: ready\n\n");
  });

  it("requests identity encoding and removes stale compression framing", async () => {
    const response = await request(
      gatewayOrigin,
      "/internal/hermes/runs/run-gzip",
      {
        headers: {
          Authorization: `Bearer ${agentServiceSecret}`,
          "Accept-Encoding": "gzip",
        },
      },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(lastUpstreamAcceptEncoding, "identity");
    assert.equal(response.headers["content-encoding"], undefined);
    assert.equal(response.headers["content-length"], undefined);
    assert.equal(response.body, "decompressed Hermes status payload");
  });

  it("aborts the upstream SSE stream when the downstream client disconnects", async () => {
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveHangingUpstreamClosed = resolve;
    });
    const target = new URL(gatewayOrigin);

    await new Promise<void>((resolve, reject) => {
      const clientRequest = http.request(
        {
          headers: {
            Authorization: `Bearer ${agentServiceSecret}`,
            Connection: "close",
          },
          hostname: target.hostname,
          path: "/internal/hermes/runs/run-hang/events",
          port: target.port,
        },
        (response) => {
          response.once("data", () => {
            response.destroy();
            resolve();
          });
        },
      );
      clientRequest.once("error", reject);
      clientRequest.end();
    });

    await withTimeout(upstreamClosed, 500);
    resolveHangingUpstreamClosed = undefined;
  });

  it("rejects oversized request bodies before proxying", async () => {
    const declared = await request(gatewayOrigin, "/internal/hermes/runs", {
      body: Buffer.alloc(1_000_001, "a"),
      headers: {
        Authorization: `Bearer ${agentServiceSecret}`,
        "Content-Length": "1000001",
      },
      method: "POST",
    });
    const chunked = await request(gatewayOrigin, "/internal/hermes/runs", {
      body: Buffer.alloc(1_000_001, "a"),
      headers: {
        Authorization: `Bearer ${agentServiceSecret}`,
      },
      method: "POST",
    });

    assert.equal(declared.statusCode, 413);
    assert.equal(chunked.statusCode, 413);
  });

  it("returns 404 or 405 for non-allowlisted internal requests", async () => {
    for (const [method, path] of [
      ["DELETE", "/internal/hermes/runs/run-1"],
      ["PUT", "/internal/hermes/runs/run-1"],
      ["GET", "/internal/hermes/runs"],
      ["GET", "/internal/hermes/runs/run-1/logs"],
      ["GET", "/internal/hermes/runs//events"],
      ["GET", "/internal/hermes/runs/../secret"],
      ["GET", "/internal/hermes/runs/%2e%2e/secret"],
      ["GET", "/internal/hermes/unknown"],
      ["GET", "/internal/hermes/runs-unknown"],
    ]) {
      const response = await request(gatewayOrigin, path, {
        headers: { Authorization: `Bearer ${agentServiceSecret}` },
        method,
      });
      assert.ok(
        response.statusCode === 404 || response.statusCode === 405,
        `${method} ${path} returned ${response.statusCode}`,
      );
    }
  });
});
