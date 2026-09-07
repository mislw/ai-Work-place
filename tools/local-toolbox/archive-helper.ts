import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createArchiveJob as defaultCreateArchiveJob,
  type ArchiveJob,
  type ArchiveJobInput,
  type ArchiveJobSnapshot,
} from "./archive-jobs";
import { findWinRar as defaultFindWinRar } from "./winrar";
import { findSevenZip as defaultFindSevenZip } from "./sevenzip";
import { pickWindowsPath as defaultPickWindowsPath } from "./native-picker";

const helperVersion = 1;
const recordLifetimeMs = 30 * 60 * 1000;
const approvedHealthOrigins = new Set([
  "https://ai.mislw.cn",
]);
const modulePath = fileURLToPath(import.meta.url);
const publicRoot = path.join(path.dirname(modulePath), "public");
const publicAssets = new Map([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
]);

type SelectionRecord = { path: string; expiresAt: number };
type JobRecord = { job: ArchiveJob; expiresAt: number };

export type LocalToolboxDependencies = {
  findWinRar?: () => Promise<string | null>;
  findSevenZip?: () => Promise<string | null>;
  pickWindowsPath?: (mode: "file" | "folder") => Promise<string | null>;
  createArchiveJob?: (input: ArchiveJobInput) => ArchiveJob;
  revealOutput?: (outputPath: string) => void | Promise<void>;
  now?: () => number;
  temporaryRoot?: string;
};

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function writeEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

async function writePublicAsset(
  response: ServerResponse,
  asset: { fileName: string; contentType: string },
): Promise<void> {
  const contents = await readFile(path.join(publicRoot, asset.fileName));
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": contents.length,
    "Cache-Control": "no-store",
  });
  response.end(contents);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) {
      throw new Error("REQUEST_TOO_LARGE");
    }
  }
  const parsed = JSON.parse(body || "{}");
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("INVALID_JSON_BODY");
  }
  return parsed as Record<string, unknown>;
}

function requestOrigin(request: IncomingMessage): string {
  return typeof request.headers.origin === "string" ? request.headers.origin : "";
}

function helperOrigin(request: IncomingMessage): string {
  return request.headers.host ? `http://${request.headers.host}` : "";
}

function normalizedRequestPath(request: IncomingMessage): string {
  const requestPath = request.url ?? "/";
  return requestPath.startsWith("//")
    ? `/${requestPath.replace(/^\/+/, "")}`
    : requestPath;
}

function isApprovedHealthOrigin(origin: string): boolean {
  if (approvedHealthOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isAuthorizedMutation(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"] ?? "";
  return (
    requestOrigin(request) === helperOrigin(request) &&
    contentType.toLowerCase().startsWith("application/json") &&
    request.headers["x-local-toolbox"] === "1"
  );
}

function jobResponse(jobId: string, snapshot: ArchiveJobSnapshot) {
  return { jobId, ...snapshot };
}

function defaultRevealOutput(outputPath: string): void {
  spawn("explorer.exe", [outputPath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();
}

export function createLocalToolboxServer(
  dependencies: LocalToolboxDependencies = {},
) {
  const findWinRar = dependencies.findWinRar ?? defaultFindWinRar;
  const findSevenZip = dependencies.findSevenZip ?? defaultFindSevenZip;
  const pickWindowsPath = dependencies.pickWindowsPath ?? defaultPickWindowsPath;
  const createArchiveJob = dependencies.createArchiveJob ?? defaultCreateArchiveJob;
  const revealOutput = dependencies.revealOutput ?? defaultRevealOutput;
  const now = dependencies.now ?? Date.now;
  const temporaryRoot =
    dependencies.temporaryRoot ?? path.join(os.tmpdir(), "local-toolbox-archives");
  const selections = new Map<string, SelectionRecord>();
  const jobs = new Map<string, JobRecord>();

  const pruneExpired = () => {
    const currentTime = now();
    for (const [id, record] of selections) {
      if (record.expiresAt <= currentTime) selections.delete(id);
    }
    for (const [id, record] of jobs) {
      if (record.expiresAt <= currentTime) jobs.delete(id);
    }
  };

  return createServer(async (request, response) => {
    pruneExpired();
    const url = new URL(
      normalizedRequestPath(request),
      helperOrigin(request) || "http://127.0.0.1",
    );

    const publicAsset = request.method === "GET" ? publicAssets.get(url.pathname) : null;
    if (publicAsset) {
      try {
        await writePublicAsset(response, publicAsset);
      } catch {
        writeJson(response, 500, { error: "ASSET_UNAVAILABLE" });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const origin = requestOrigin(request);
      const corsHeaders: Record<string, string> = isApprovedHealthOrigin(origin)
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {};
      writeJson(
        response,
        200,
        {
          ok: true,
          version: helperVersion,
          winRarAvailable: Boolean(await findWinRar()),
          sevenZipAvailable: Boolean(await findSevenZip()),
        },
        corsHeaders,
      );
      return;
    }

    if (
      url.pathname.startsWith("/api/") &&
      request.method !== "GET" &&
      !isAuthorizedMutation(request)
    ) {
      writeJson(response, 403, { error: "FORBIDDEN" });
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/selections") {
        const body = await readJson(request);
        if (Object.prototype.hasOwnProperty.call(body, "path")) {
          writeJson(response, 400, { error: "CLIENT_PATH_REJECTED" });
          return;
        }
        if (body.mode !== "file" && body.mode !== "folder") {
          writeJson(response, 400, { error: "INVALID_SELECTION_MODE" });
          return;
        }
        const selectedPath = await pickWindowsPath(body.mode);
        if (!selectedPath) {
          writeJson(response, 409, { error: "SELECTION_CANCELLED" });
          return;
        }
        const selectionId = randomUUID();
        selections.set(selectionId, {
          path: selectedPath,
          expiresAt: now() + recordLifetimeMs,
        });
        writeJson(response, 201, {
          selectionId,
          displayName: path.basename(selectedPath),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/jobs") {
        const body = await readJson(request);
        if (Object.prototype.hasOwnProperty.call(body, "path")) {
          writeJson(response, 400, { error: "CLIENT_PATH_REJECTED" });
          return;
        }
        const selection =
          typeof body.selectionId === "string" ? selections.get(body.selectionId) : null;
        if (!selection) {
          writeJson(response, 404, { error: "SELECTION_NOT_FOUND" });
          return;
        }
        const winRarPath = await findWinRar();
        const sevenZipPath = await findSevenZip();
        if (!winRarPath && !sevenZipPath) {
          writeJson(response, 503, { error: "ARCHIVE_ENGINE_NOT_FOUND" });
          return;
        }
        const jobId = randomUUID();
        const job = createArchiveJob({
          selectionPath: selection.path,
          password: typeof body.password === "string" ? body.password : "",
          winRarPath,
          sevenZipPath,
          temporaryRoot,
        });
        jobs.set(jobId, { job, expiresAt: now() + recordLifetimeMs });
        selections.delete(body.selectionId as string);
        void job.start().catch(() => undefined);
        writeJson(response, 201, jobResponse(jobId, job.snapshot()));
        return;
      }

      const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && jobMatch) {
        const jobId = jobMatch[1]!;
        const record = jobs.get(jobId);
        if (!record) {
          writeJson(response, 404, { error: "JOB_NOT_FOUND" });
          return;
        }
        writeJson(response, 200, jobResponse(jobId, record.job.snapshot()));
        return;
      }

      const passwordMatch = /^\/api\/jobs\/([^/]+)\/password$/.exec(url.pathname);
      if (request.method === "POST" && passwordMatch) {
        const jobId = passwordMatch[1]!;
        const record = jobs.get(jobId);
        if (!record) {
          writeJson(response, 404, { error: "JOB_NOT_FOUND" });
          return;
        }
        const body = await readJson(request);
        await record.job.providePassword(
          typeof body.password === "string" ? body.password : "",
        );
        writeJson(response, 200, jobResponse(jobId, record.job.snapshot()));
        return;
      }

      const revealMatch = /^\/api\/jobs\/([^/]+)\/reveal$/.exec(url.pathname);
      if (request.method === "POST" && revealMatch) {
        await readJson(request);
        const record = jobs.get(revealMatch[1]!);
        const snapshot = record?.job.snapshot();
        if (!record || snapshot?.status !== "completed" || !snapshot.primaryOutputPath) {
          writeJson(response, 409, { error: "OUTPUT_NOT_AVAILABLE" });
          return;
        }
        await revealOutput(snapshot.primaryOutputPath);
        writeEmpty(response, 204);
        return;
      }

      writeJson(response, 404, { error: "NOT_FOUND" });
    } catch {
      writeJson(response, 400, { error: "INVALID_REQUEST" });
    }
  });
}

async function openLocalPage(origin: string): Promise<void> {
  spawn("explorer.exe", [origin], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();
}

async function startStandaloneHelper(): Promise<void> {
  const argumentValue = (name: string): string | undefined => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const requestedPort = Number(argumentValue("--port") ?? "37654");
  const port =
    Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536
      ? requestedPort
      : 37654;
  const embedded = process.argv.includes("--embedded");
  const parentPid = Number(argumentValue("--parent-pid"));
  const origin = `http://127.0.0.1:${port}/`;

  if (Number.isInteger(parentPid) && parentPid > 0) {
    const parentGuard = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        clearInterval(parentGuard);
        process.exit(0);
      }
    }, 2000);
    parentGuard.unref();
  }

  try {
    const response = await fetch(`${origin}health`, {
      signal: AbortSignal.timeout(600),
    });
    if (response.ok) {
      if (!embedded) await openLocalPage(origin);
      return;
    }
  } catch {
    // No existing helper is listening.
  }

  const server = createLocalToolboxServer();
  server.once("error", (error) => {
    console.error(`Local toolbox failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", async () => {
    console.log(`LOCAL_TOOLBOX_ORIGIN=${origin.slice(0, -1)}`);
    if (!embedded) await openLocalPage(origin);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  void startStandaloneHelper();
}
