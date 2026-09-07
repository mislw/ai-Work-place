import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveJob, ArchiveJobSnapshot } from "../../tools/local-toolbox/archive-jobs";
import { createLocalToolboxServer } from "../../tools/local-toolbox/archive-helper";

const servers: Array<ReturnType<typeof createLocalToolboxServer>> = [];

function completedSnapshot(): ArchiveJobSnapshot {
  return {
    status: "completed",
    progressPercent: 100,
    processedArchives: 1,
    successCount: 1,
    failureCount: 0,
    nonEmptyFileCount: 2,
    failures: [],
    outputPaths: ["D:\\private\\output"],
    primaryOutputPath: "D:\\private\\output",
  };
}

function createFakeJob(snapshot = completedSnapshot()): ArchiveJob {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    providePassword: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn(() => snapshot),
  };
}

async function startHelper(overrides: Record<string, unknown> = {}) {
  const job = createFakeJob();
  const dependencies = {
    findWinRar: vi.fn().mockResolvedValue("C:\\Program Files\\WinRAR\\WinRAR.exe"),
    findSevenZip: vi.fn().mockResolvedValue("C:\\Program Files\\7-Zip\\7z.exe"),
    pickWindowsPath: vi.fn().mockResolvedValue("D:\\private\\语文950"),
    createArchiveJob: vi.fn(() => job),
    revealOutput: vi.fn(),
    ...overrides,
  };
  const server = createLocalToolboxServer(dependencies);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    dependencies,
    job,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function helperPost(origin: string, pathname: string, body: unknown) {
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Local-Toolbox": "1",
    },
    body: JSON.stringify(body),
  });
}

async function rawHttpRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("end", () => resolve(response));
    socket.once("error", reject);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("local toolbox helper protocol", () => {
  it("serves only the fixed local interface assets", async () => {
    const { origin } = await startHelper();

    const page = await fetch(`${origin}/`);
    const missing = await fetch(`${origin}/private.txt`);

    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("解压小工具");
    expect(missing.status).toBe(404);
  });

  it("serves the local interface when WebView2 requests a triple-slash path", async () => {
    const { server } = await startHelper();
    const address = server.address() as AddressInfo;

    const response = await rawHttpRequest(
      address.port,
      `GET /// HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nConnection: close\r\n\r\n`,
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("解压小工具");
  });

  it("exposes only non-private health to an approved workspace origin", async () => {
    const { origin } = await startHelper();

    const response = await fetch(`${origin}/health`, {
      headers: { Origin: "https://ai.mislw.cn" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://ai.mislw.cn",
    );
    expect(await response.json()).toEqual({
      ok: true,
      version: 1,
      winRarAvailable: true,
      sevenZipAvailable: true,
    });
  });

  it("exposes non-private health to a local workspace development port", async () => {
    const { origin } = await startHelper();
    const workspaceOrigin = "http://127.0.0.1:3101";

    const response = await fetch(`${origin}/health`, {
      headers: { Origin: workspaceOrigin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      workspaceOrigin,
    );
  });

  it("rejects cross-origin job creation", async () => {
    const { origin } = await startHelper();

    const response = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        "X-Local-Toolbox": "1",
      },
      body: JSON.stringify({ selectionId: "selection-1", password: "secret" }),
    });

    expect(response.status).toBe(403);
  });

  it("stores an opaque selection id without returning the selected path", async () => {
    const { origin } = await startHelper();

    const response = await helperPost(origin, "/api/selections", { mode: "folder" });
    const body = await response.json();

    expect(body).toEqual({
      selectionId: expect.any(String),
      displayName: "语文950",
    });
    expect(JSON.stringify(body)).not.toContain("D:\\private");
  });

  it("rejects browser-supplied filesystem paths", async () => {
    const { origin } = await startHelper();

    const response = await helperPost(origin, "/api/selections", {
      mode: "folder",
      path: "D:\\private",
    });

    expect(response.status).toBe(400);
  });

  it("creates a job from the stored path without returning its password", async () => {
    const createArchiveJob = vi.fn(() => createFakeJob());
    const { origin } = await startHelper({ createArchiveJob });
    const selectionResponse = await helperPost(origin, "/api/selections", {
      mode: "folder",
    });
    const { selectionId } = await selectionResponse.json();

    const response = await helperPost(origin, "/api/jobs", {
      selectionId,
      password: "secret.",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      jobId: expect.any(String),
      status: "completed",
      primaryOutputPath: "D:\\private\\output",
    });
    expect(JSON.stringify(body)).not.toContain("secret.");
    expect(createArchiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionPath: "D:\\private\\语文950",
        password: "secret.",
      }),
    );
  });

  it("allows same-host polling without mutation headers", async () => {
    const { origin } = await startHelper();
    const selectionResponse = await helperPost(origin, "/api/selections", {
      mode: "folder",
    });
    const { selectionId } = await selectionResponse.json();
    const jobResponse = await helperPost(origin, "/api/jobs", {
      selectionId,
      password: "",
    });
    const { jobId } = await jobResponse.json();

    const response = await fetch(`${origin}/api/jobs/${jobId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId, status: "completed" });
  });

  it("returns job creation before a long-running job completes", async () => {
    let releaseJob!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const job = createFakeJob({ ...completedSnapshot(), status: "queued" });
    job.start = vi.fn(() => pending);
    const { origin } = await startHelper({ createArchiveJob: vi.fn(() => job) });
    const selectionResponse = await helperPost(origin, "/api/selections", {
      mode: "folder",
    });
    const { selectionId } = await selectionResponse.json();

    const response = await helperPost(origin, "/api/jobs", {
      selectionId,
      password: "",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "queued" });
    releaseJob();
    await pending;
  });

  it("reveals only the completed job output selected by the server", async () => {
    const revealOutput = vi.fn();
    const { origin } = await startHelper({ revealOutput });
    const selectionResponse = await helperPost(origin, "/api/selections", {
      mode: "folder",
    });
    const { selectionId } = await selectionResponse.json();
    const jobResponse = await helperPost(origin, "/api/jobs", {
      selectionId,
      password: "",
    });
    const { jobId } = await jobResponse.json();

    const response = await helperPost(origin, `/api/jobs/${jobId}/reveal`, {});

    expect(response.status).toBe(204);
    expect(revealOutput).toHaveBeenCalledWith("D:\\private\\output");
  });
});
