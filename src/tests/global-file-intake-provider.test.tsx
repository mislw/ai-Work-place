import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GlobalFileIntakeProvider,
  useGlobalFileIntake,
} from "@/components/intake/global-file-intake-provider";
import type { IntakeBatch } from "@/lib/intake/contracts";

globalThis.React = React;

const navigation = vi.hoisted(() => ({
  pathname: "/todos",
  search: "status=pending",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

describe("GlobalFileIntakeProvider", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    navigation.pathname = "/todos";
    navigation.search = "status=pending";
    let uuidIndex = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`,
    );
  });

  it("keeps an empty workspace closed until files or durable batches exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ batches: [] }));

    render(<ProviderHarness />);

    await waitFor(() => expect(screen.getByText("面板关闭")).toBeInTheDocument());
    expect(sessionStorage.getItem("workspace-intake-drawer-open")).toBeNull();
  });

  it("registers one client batch after durable uploads and appends later items", async () => {
    const postedBodies: Array<Record<string, unknown>> = [];
    let uploadIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/intake/batches" && !init?.method) {
        return Response.json({ batches: [] });
      }
      if (url === "/api/knowledge/uploads") {
        uploadIndex += 1;
        return Response.json(durableIds(uploadIndex), { status: 201 });
      }
      if (url.startsWith("/api/knowledge/items/")) {
        return Response.json({ item: readyKnowledgeItem() });
      }
      if (url === "/api/intake/batches" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postedBodies.push(body);
        const items = body.items as Array<Record<string, string>>;
        return Response.json(
          { batch: createBatch({ clientBatchId: String(body.clientBatchId), itemCount: items.length }) },
          { status: postedBodies.length === 1 ? 201 : 200 },
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ProviderHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加两个文件" }));

    await waitFor(() => expect(postedBodies.length).toBeGreaterThanOrEqual(2));
    expect(new Set(postedBodies.map((body) => body.clientBatchId)).size).toBe(1);
    expect(postedBodies.at(-1)?.items).toHaveLength(2);
    expect((postedBodies[0]?.pageContext as { pageType: string }).pageType).toBe("todos");
  });

  it("hydrates active batches and keeps them when the drawer closes", async () => {
    const active = createBatch({ status: "processing" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/intake/batches") {
        return Response.json({ batches: [active] });
      }
      throw new Error(`Unexpected fetch ${String(input)}`);
    });
    render(<ProviderHarness />);

    await screen.findByText("处理中 1");
    fireEvent.click(screen.getByRole("button", { name: "关闭整理面板" }));

    expect(screen.getByText("处理中 1")).toBeInTheDocument();
    expect(screen.getByText("面板关闭")).toBeInTheDocument();
    expect(sessionStorage.getItem("workspace-intake-drawer-open")).toBe("false");
  });

  it("does not let a stale initial hydration erase a newly registered batch", async () => {
    let resolveHydration: ((response: Response) => void) | undefined;
    const hydration = new Promise<Response>((resolve) => {
      resolveHydration = resolve;
    });
    let uploadIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/intake/batches" && !init?.method) return hydration;
      if (url === "/api/knowledge/uploads") {
        uploadIndex += 1;
        return Response.json(durableIds(uploadIndex), { status: 201 });
      }
      if (url.startsWith("/api/knowledge/items/")) {
        return Response.json({ item: readyKnowledgeItem() });
      }
      if (url === "/api/intake/batches" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientBatchId: string };
        return Response.json({ batch: createBatch({ clientBatchId: body.clientBatchId }) }, { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ProviderHarness />);
    fireEvent.click(screen.getByRole("button", { name: "添加一个文件" }));
    await screen.findByText("批次状态 processing");

    await act(async () => {
      resolveHydration?.(Response.json({ batches: [] }));
      await hydration;
    });

    expect(screen.getByText("批次状态 processing")).toBeInTheDocument();
  });

  it("uses the current route for each new gesture without remounting", async () => {
    const contexts: Array<{ pageType: string }> = [];
    let uploadIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/intake/batches" && !init?.method) {
        return Response.json({ batches: [] });
      }
      if (url === "/api/knowledge/uploads") {
        uploadIndex += 1;
        return Response.json(durableIds(uploadIndex), { status: 201 });
      }
      if (url.startsWith("/api/knowledge/items/")) {
        return Response.json({ item: readyKnowledgeItem() });
      }
      if (url === "/api/intake/batches" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          pageContext: { pageType: string };
          clientBatchId: string;
        };
        contexts.push(body.pageContext);
        return Response.json({ batch: createBatch({ clientBatchId: body.clientBatchId }) }, { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const view = render(<ProviderHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加一个文件" }));
    await waitFor(() => expect(contexts).toHaveLength(1));

    navigation.pathname = "/calendar";
    navigation.search = "date=2026-09-07";
    view.rerender(<ProviderHarness />);
    fireEvent.click(screen.getByRole("button", { name: "添加一个文件" }));

    await waitFor(() => expect(contexts).toHaveLength(2));
    expect(contexts.map((context) => context.pageType)).toEqual(["todos", "calendar"]);
  });

  it.each(["retry", "cancel", "undo"] as const)("runs the %s command and refreshes the batch", async (command) => {
    const batch = createBatch({ status: command === "undo" ? "completed" : "failed" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/intake/batches") return Response.json({ batches: [batch] });
      if (url === `/api/intake/batches/${batch.id}/${command}` && init?.method === "POST") {
        return Response.json({ batch: createBatch({ status: command === "undo" ? "undone" : "processing" }) });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ProviderHarness />);
    await screen.findByText(/批次状态/);

    fireEvent.click(screen.getByRole("button", { name: command }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/intake/batches/${batch.id}/${command}`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("reopens the drawer for failures and undo conflicts", async () => {
    sessionStorage.setItem("workspace-intake-drawer-open", "false");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ batches: [createBatch({ status: "partial", errorCode: "UNDO_RECORD_CHANGED" })] }),
    );

    render(<ProviderHarness />);

    await screen.findByText("面板打开");
  });
});

function ProviderHarness() {
  return (
    <GlobalFileIntakeProvider>
      <ProviderControls />
    </GlobalFileIntakeProvider>
  );
}

function ProviderControls() {
  const intake = useGlobalFileIntake();
  const first = intake.batches[0];
  return (
    <div>
      <button onClick={() => intake.enqueueFiles(files(2), "file_drop")}>添加两个文件</button>
      <button onClick={() => intake.enqueueFiles(files(1), "file_picker")}>添加一个文件</button>
      <button onClick={() => intake.setDrawerOpen(false)}>关闭整理面板</button>
      <span>{intake.drawerOpen ? "面板打开" : "面板关闭"}</span>
      <span>处理中 {intake.activeCount}</span>
      <span>批次状态 {first?.status ?? "none"}</span>
      {first ? (
        <>
          <button onClick={() => void intake.retry(first.id)}>retry</button>
          <button onClick={() => void intake.cancel(first.id)}>cancel</button>
          <button onClick={() => void intake.undo(first.id)}>undo</button>
        </>
      ) : null}
    </div>
  );
}

function files(count: number) {
  return Array.from({ length: count }, (_, index) =>
    new File([String(index)], `file-${index}.md`, { type: "text/markdown" }),
  );
}

function durableIds(index: number) {
  return {
    assetId: uuid(index * 3 + 1),
    documentId: uuid(index * 3 + 2),
    jobId: uuid(index * 3 + 3),
  };
}

function readyKnowledgeItem() {
  return { status: "ready", stage: "complete", progress: 100, proposals: [] };
}

function createBatch(options: {
  clientBatchId?: string;
  status?: IntakeBatch["status"];
  errorCode?: string | null;
  itemCount?: number;
} = {}): IntakeBatch {
  const itemCount = options.itemCount ?? 1;
  return {
    id: uuid(900),
    clientBatchId: options.clientBatchId ?? "client-1",
    sourceType: "file_drop",
    pageContext: {
      version: 1,
      route: "/todos",
      pageType: "todos",
      capturedAt: "2026-09-06T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      trigger: { kind: "file_drop", clientBatchId: options.clientBatchId ?? "client-1" },
    },
    status: options.status ?? "processing",
    summary: null,
    errorCode: options.errorCode ?? null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:01.000Z",
    completedAt: null,
    undoneAt: null,
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: uuid(910 + index),
      batchId: uuid(900),
      assetId: uuid(index * 3 + 1),
      documentId: uuid(index * 3 + 2),
      jobId: uuid(index * 3 + 3),
      hermesRunId: null,
      status: "waiting_extraction" as const,
      confidence: null,
      decisionSummary: null,
      errorCode: null,
      attemptCount: 0,
      invalidPlanCount: 0,
      availableAt: "2026-09-06T08:00:00.000Z",
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: "2026-09-06T08:00:00.000Z",
      updatedAt: "2026-09-06T08:00:00.000Z",
      completedAt: null,
      steps: [],
    })),
  };
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
