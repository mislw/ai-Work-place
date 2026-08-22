import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import httpProxy from "http-proxy";
import { type GatewayConfig, getGatewayConfig } from "./config.js";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionCookie,
} from "./cookies.js";
import {
  NonceStore,
  signSessionToken,
  verifyBootstrapToken,
  verifySessionToken,
} from "./tokens.js";

const APP_ORIGIN = "https://ai.mislw.cn";
const FRAME_POLICY = `frame-ancestors ${APP_ORIGIN}`;

function sendText(response: ServerResponse, statusCode: number, body: string) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

export function createGatewayServer(
  config: GatewayConfig,
  nonces = new NonceStore(),
): Server {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: false,
    ws: true,
  });
  const userSockets = new Map<string, Set<Socket>>();
  const socketTimers = new Map<Socket, NodeJS.Timeout>();

  async function authenticateCookie(cookieHeader: string | undefined) {
    const token = readSessionCookie(cookieHeader);
    if (!token) return null;
    try {
      return await verifySessionToken(token, config);
    } catch {
      return null;
    }
  }

  function registerUserSocket(
    userId: string,
    socket: Socket,
    expiresInMs: number,
  ) {
    const sockets = userSockets.get(userId) ?? new Set<Socket>();
    sockets.add(socket);
    userSockets.set(userId, sockets);

    const timer = setTimeout(() => socket.destroy(), expiresInMs);
    timer.unref();
    socketTimers.set(socket, timer);

    socket.once("close", () => {
      const activeTimer = socketTimers.get(socket);
      if (activeTimer) clearTimeout(activeTimer);
      socketTimers.delete(socket);
      sockets.delete(socket);
      if (sockets.size === 0) userSockets.delete(userId);
    });
  }

  function destroyUserSockets(userId: string) {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    userSockets.delete(userId);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  }

  proxy.on("proxyRes", (proxyResponse) => {
    proxyResponse.headers["content-security-policy"] = FRAME_POLICY;
    proxyResponse.headers["referrer-policy"] = "no-referrer";
  });

  proxy.on("error", (_error, _request, responseOrSocket) => {
    if (responseOrSocket instanceof http.ServerResponse) {
      if (responseOrSocket.headersSent) {
        responseOrSocket.destroy();
        return;
      }
      sendText(responseOrSocket, 502, "Bad Gateway");
      return;
    }
    responseOrSocket.destroy();
  });

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://gateway.local");

    if (requestUrl.pathname === "/health") {
      sendText(response, 200, "ok");
      return;
    }

    if (requestUrl.pathname === "/auth/bootstrap") {
      if (request.method !== "GET") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }
      const token = requestUrl.searchParams.get("token");
      if (!token) {
        sendText(response, 401, "Unauthorized");
        return;
      }
      try {
        const claims = await verifyBootstrapToken(token, config, nonces);
        const sessionToken = await signSessionToken(claims.sub, config);
        response.statusCode = 302;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Location", "/");
        response.setHeader("Set-Cookie", createSessionCookie(sessionToken));
        response.end();
      } catch {
        sendText(response, 401, "Unauthorized");
      }
      return;
    }

    if (requestUrl.pathname === "/auth/logout") {
      if (request.method !== "POST") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }
      if (request.headers.origin !== APP_ORIGIN) {
        sendText(response, 403, "Forbidden");
        return;
      }
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Origin", APP_ORIGIN);
      response.setHeader("Vary", "Origin");
      const session = await authenticateCookie(request.headers.cookie);
      if (!session) {
        sendText(response, 401, "Unauthorized");
        return;
      }
      destroyUserSockets(session.sub);
      response.statusCode = 204;
      response.setHeader("Set-Cookie", clearSessionCookie());
      response.end();
      return;
    }

    const session = await authenticateCookie(request.headers.cookie);
    if (!session) {
      sendText(response, 401, "Unauthorized");
      return;
    }

    proxy.web(request, response, { target: config.harnessUpstream });
  });

  server.on(
    "upgrade",
    async (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const session = await authenticateCookie(request.headers.cookie);
      if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const expiresInMs = Math.max(0, session.exp * 1000 - Date.now());
      registerUserSocket(session.sub, socket, expiresInMs);
      proxy.ws(request, socket, head, { target: config.harnessUpstream });
    },
  );

  server.on("close", () => {
    for (const timer of socketTimers.values()) clearTimeout(timer);
    socketTimers.clear();
    for (const sockets of userSockets.values()) {
      for (const socket of sockets) socket.destroy();
    }
    userSockets.clear();
    proxy.close();
  });

  return server;
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  const config = getGatewayConfig();
  createGatewayServer(config).listen(config.port, "0.0.0.0");
}
