import assert from "node:assert/strict";
import { once } from "node:events";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { SignJWT } from "jose";
import WebSocket, { WebSocketServer } from "ws";
import type { GatewayConfig } from "../src/config.js";
import { createGatewayServer } from "../src/server.js";
import { signSessionToken } from "../src/tokens.js";

const secret = new TextEncoder().encode(
  "0123456789abcdef0123456789abcdef",
);

let upstreamServer: Server;
let upstreamWebSockets: WebSocketServer;
let gatewayServer: Server;
let gatewayOrigin: string;
let config: GatewayConfig;
let upstreamWebSocketConnections = 0;
let lastUpstreamWebSocketHeaders: http.IncomingHttpHeaders | undefined;

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

function requestGateway(
  path: string,
  options: {
    headers?: http.OutgoingHttpHeaders;
    method?: string;
    origin?: string;
  } = {},
): Promise<{
  body: string;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
}> {
  const target = new URL(path, gatewayOrigin);
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        agent: false,
        headers: {
          Connection: "close",
          ...(options.origin ? { Origin: options.origin } : {}),
          ...options.headers,
        },
        method: options.method ?? "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function bootstrapToken(jti: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("harness-bootstrap")
    .setSubject("owner-1")
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(secret);
}

async function sessionCookie(): Promise<string> {
  const token = await signSessionToken("owner-1", config);
  return `dsh_embed=${token}`;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
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

async function openWebSocket(
  cookie: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{
  responseHeaders: http.IncomingHttpHeaders;
  websocket: WebSocket;
}> {
  const websocket = new WebSocket(gatewayOrigin.replace("http", "ws"), {
    headers: { Cookie: cookie, ...headers },
  });
  const message = once(websocket, "message");
  const upgrade = once(websocket, "upgrade");
  await withTimeout(once(websocket, "open").then(() => undefined), 2_000);
  const [payload] = await withTimeout(message, 2_000);
  const [response] = await withTimeout(upgrade, 2_000);
  assert.equal(payload.toString(), "upstream-ready");
  return {
    responseHeaders: (response as http.IncomingMessage).headers,
    websocket,
  };
}

async function closeWebSocket(websocket: WebSocket): Promise<void> {
  if (websocket.readyState === WebSocket.CLOSED) return;
  const closed = once(websocket, "close").then(() => undefined);
  websocket.close();
  await withTimeout(closed, 2_000);
}

before(async () => {
  upstreamServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Connection", "close");
    response.setHeader("Set-Cookie", [
      "upstream_session=secret; Path=/",
      "dsh_embed=overwritten; Path=/",
    ]);
    response.setHeader("Set-Cookie2", "legacy_upstream=secret; Path=/");
    response.end(
      JSON.stringify({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        cookie2: request.headers.cookie2,
        host: request.headers.host,
        method: request.method,
        origin: request.headers.origin,
        proxyAuthorization: request.headers["proxy-authorization"],
        url: request.url,
        xHarnessClient: request.headers["x-harness-client"],
      }),
    );
  });
  upstreamWebSockets = new WebSocketServer({ noServer: true });
  upstreamWebSockets.on("headers", (headers) => {
    headers.push("Set-Cookie: upstream_ws=secret; Path=/");
    headers.push("Set-Cookie2: legacy_upstream_ws=secret; Path=/");
  });
  upstreamServer.on("upgrade", (request, socket, head) => {
    upstreamWebSockets.handleUpgrade(request, socket, head, (websocket) => {
      upstreamWebSockets.emit("connection", websocket, request);
    });
  });
  upstreamWebSockets.on("connection", (websocket, request) => {
    upstreamWebSocketConnections += 1;
    lastUpstreamWebSocketHeaders = request.headers;
    websocket.send("upstream-ready");
  });

  const upstreamPort = await listen(upstreamServer);
  config = {
    harnessUpstream: `http://127.0.0.1:${upstreamPort}`,
    ownerUserId: "owner-1",
    port: 0,
    secret,
  };
  gatewayServer = createGatewayServer(config);
  const gatewayPort = await listen(gatewayServer);
  gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
});

after(async () => {
  for (const websocket of upstreamWebSockets.clients) websocket.terminate();
  await closeServer(gatewayServer);
  await new Promise<void>((resolve) => upstreamWebSockets.close(() => resolve()));
  await closeServer(upstreamServer);
});

describe("HTTP gateway", () => {
  it("serves health without authentication", async () => {
    const response = await requestGateway("/health");
    assert.equal(response.statusCode, 200);
  });

  it("exchanges one bootstrap token for the secure session cookie", async () => {
    const token = await bootstrapToken("bootstrap-once");
    const response = await requestGateway(
      `/auth/bootstrap?token=${encodeURIComponent(token)}`,
    );
    const setCookie = response.headers["set-cookie"]?.join("; ") ?? "";

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/");
    assert.match(setCookie, /^dsh_embed=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=600/i);
    assert.equal(
      (await requestGateway(`/auth/bootstrap?token=${encodeURIComponent(token)}`))
        .statusCode,
      401,
    );
  });

  it("rejects missing and invalid bootstrap tokens", async () => {
    assert.equal((await requestGateway("/auth/bootstrap")).statusCode, 401);
    assert.equal(
      (await requestGateway("/auth/bootstrap?token=invalid")).statusCode,
      401,
    );
  });

  it("strips HTTP credentials while preserving required upstream headers", async () => {
    assert.equal((await requestGateway("/rpc")).statusCode, 401);
    const response = await requestGateway("/rpc?value=1", {
      headers: {
        Authorization: "Bearer browser-secret",
        Cookie: `${await sessionCookie()}; domain_secret=browser-secret`,
        Cookie2: "legacy_browser=secret",
        Host: "agent.mislw.cn",
        Origin: "https://ai.mislw.cn",
        "Proxy-Authorization": "Basic proxy-secret",
        "X-Harness-Client": "embed",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      host: "agent.mislw.cn",
      method: "GET",
      origin: "https://ai.mislw.cn",
      url: "/rpc?value=1",
      xHarnessClient: "embed",
    });
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(response.headers["set-cookie2"], undefined);
  });

  it("allows logout only from the configured app origin and clears the cookie", async () => {
    const cookie = await sessionCookie();
    assert.equal(
      (
        await requestGateway("/auth/logout", {
          headers: { Cookie: cookie },
          method: "POST",
          origin: "https://evil.example",
        })
      ).statusCode,
      403,
    );

    const response = await requestGateway("/auth/logout", {
      headers: { Cookie: cookie },
      method: "POST",
      origin: "https://ai.mislw.cn",
    });
    const setCookie = response.headers["set-cookie"]?.join("; ") ?? "";
    assert.equal(response.statusCode, 204);
    assert.equal(
      response.headers["access-control-allow-origin"],
      "https://ai.mislw.cn",
    );
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.match(setCookie, /^dsh_embed=/);
    assert.match(setCookie, /Max-Age=0/i);
  });

  it("adds frame and referrer protections to proxied responses", async () => {
    const response = await requestGateway("/", {
      headers: { Cookie: await sessionCookie() },
    });
    assert.equal(
      response.headers["content-security-policy"],
      "frame-ancestors https://ai.mislw.cn",
    );
    assert.equal(response.headers["referrer-policy"], "no-referrer");
  });

  it("returns a stack-free 502 when the upstream is unavailable", async () => {
    const deadUpstream = http.createServer();
    const deadPort = await listen(deadUpstream);
    await closeServer(deadUpstream);
    const isolatedGateway = createGatewayServer({
      ...config,
      harnessUpstream: `http://127.0.0.1:${deadPort}`,
    });
    const isolatedPort = await listen(isolatedGateway);
    const previousOrigin = gatewayOrigin;
    gatewayOrigin = `http://127.0.0.1:${isolatedPort}`;

    try {
      const response = await requestGateway("/unavailable", {
        headers: { Cookie: await sessionCookie() },
      });
      assert.equal(response.statusCode, 502);
      assert.equal(response.body, "Bad Gateway");
      assert.doesNotMatch(response.body, /Error|at /);
    } finally {
      gatewayOrigin = previousOrigin;
      await closeServer(isolatedGateway);
    }
  });
});

describe("WebSocket gateway", () => {
  it("rejects unauthenticated upgrades before they reach upstream", async () => {
    const connectionCount = upstreamWebSocketConnections;
    const websocket = new WebSocket(gatewayOrigin.replace("http", "ws"));
    websocket.on("error", () => undefined);
    const statusCode = await withTimeout(
      new Promise<number>((resolve) => {
        websocket.once("unexpected-response", (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
      }),
      2_000,
    );
    websocket.terminate();

    assert.equal(statusCode, 401);
    assert.equal(upstreamWebSocketConnections, connectionCount);
  });

  it("proxies authenticated upgrades to the real WebSocket upstream", async () => {
    const { responseHeaders, websocket } = await openWebSocket(
      `${await sessionCookie()}; domain_secret=browser-secret`,
      {
        Authorization: "Bearer browser-secret",
        Cookie2: "legacy_browser=secret",
        Host: "agent.mislw.cn",
        Origin: "https://ai.mislw.cn",
        "Proxy-Authorization": "Basic proxy-secret",
        "X-Harness-Client": "embed",
      },
    );

    assert.equal(lastUpstreamWebSocketHeaders?.authorization, undefined);
    assert.equal(lastUpstreamWebSocketHeaders?.cookie, undefined);
    assert.equal(lastUpstreamWebSocketHeaders?.cookie2, undefined);
    assert.equal(lastUpstreamWebSocketHeaders?.host, "agent.mislw.cn");
    assert.equal(lastUpstreamWebSocketHeaders?.origin, "https://ai.mislw.cn");
    assert.equal(
      lastUpstreamWebSocketHeaders?.["proxy-authorization"],
      undefined,
    );
    assert.equal(lastUpstreamWebSocketHeaders?.upgrade, "websocket");
    assert.equal(lastUpstreamWebSocketHeaders?.["x-harness-client"], "embed");
    assert.equal(responseHeaders["set-cookie"], undefined);
    assert.equal(responseHeaders["set-cookie2"], undefined);
    await closeWebSocket(websocket);
  });

  it("destroys a WebSocket when its JWT exp is reached", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience("harness-session")
      .setSubject("owner-1")
      .setIssuedAt(now)
      .setExpirationTime(now + 2)
      .sign(secret);
    const { websocket } = await openWebSocket(`dsh_embed=${token}`);

    await withTimeout(once(websocket, "close").then(() => undefined), 3_000);
    assert.equal(websocket.readyState, WebSocket.CLOSED);
  });

  it("logout destroys every existing WebSocket for the authenticated sub", async () => {
    const cookie = await sessionCookie();
    const { websocket: first } = await openWebSocket(cookie);
    const { websocket: second } = await openWebSocket(cookie);
    const firstClosed = once(first, "close").then(() => undefined);
    const secondClosed = once(second, "close").then(() => undefined);

    const response = await requestGateway("/auth/logout", {
      headers: { Cookie: cookie },
      method: "POST",
      origin: "https://ai.mislw.cn",
    });

    assert.equal(response.statusCode, 204);
    await withTimeout(Promise.all([firstClosed, secondClosed]), 2_000);
  });
});
