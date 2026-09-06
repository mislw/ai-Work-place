import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { KnowledgeFileCard } from "@/components/assistant/knowledge-file-card";
import { useKnowledgeUploads } from "@/hooks/use-knowledge-uploads";
import type { KnowledgeUploadItem } from "@/hooks/use-knowledge-uploads";

globalThis.React = React;

describe("AssistantComposer", () => {
  it("provides an icon attachment button and a phase-one multi-file input", () => {
    render(
      <AssistantComposer
        draft=""
        loading={false}
        running={false}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onCancel={() => undefined}
        onFiles={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "添加文件" })).toBeInTheDocument();
    const input = screen.getByLabelText("选择知识文件") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain("application/pdf");
    expect(input.accept).toContain(".docx");
    expect(input.accept).toContain("image/png");
  });
});

describe("useKnowledgeUploads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts no more than two upload requests concurrently", async () => {
    const pending: Array<() => void> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() =>
            resolve(
              Response.json(
                { assetId: "asset", documentId: "document", jobId: "job", status: "queued" },
                { status: 201 },
              ),
            ),
          );
        }),
    );
    render(<UploadHarness />);

    fireEvent.click(screen.getByRole("button", { name: "添加三个文件" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      fetchMock.mock.calls.every(([url]) => String(url) === "/api/knowledge/uploads"),
    ).toBe(true);

    act(() => pending[0]?.());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("emits the durable upload item before polling analysis", async () => {
    const onDurable = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "/api/knowledge/uploads") {
        return Response.json(
          { assetId: "asset", documentId: "document", jobId: "job" },
          { status: 201 },
        );
      }
      return Response.json({ item: { status: "ready", stage: "complete", proposals: [] } });
    });
    render(<UploadCallbackHarness onDurable={onDurable} />);

    fireEvent.click(screen.getByRole("button", { name: "添加回调文件" }));

    await waitFor(() =>
      expect(onDurable).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "asset", documentId: "document", jobId: "job" }),
      ),
    );
  });

  it("cancels durable intake ownership without deleting the original asset", async () => {
    const onCancelIntake = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url) === "/api/knowledge/uploads") {
        return Response.json(
          { assetId: "asset", documentId: "document", jobId: "job" },
          { status: 201 },
        );
      }
      return Response.json({ item: { status: "ready", stage: "complete", proposals: [] } });
    });
    render(<UploadCancelHarness onCancelIntake={onCancelIntake} />);
    fireEvent.click(screen.getByRole("button", { name: "添加待取消文件" }));
    await screen.findByRole("button", { name: "取消 intake 文件" });

    fireEvent.click(screen.getByRole("button", { name: "取消 intake 文件" }));

    await waitFor(() => expect(onCancelIntake).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/knowledge/assets/"))).toBe(false);
  });
});

describe("KnowledgeFileCard", () => {
  const readyItem: KnowledgeUploadItem = {
    localId: "local-1",
    file: new File(["content"], "Harness.md", { type: "text/markdown" }),
    state: "ready" as const,
    progress: 100,
    assetId: "asset-1",
    documentId: "document-1",
    selectedProposalIds: new Set(["proposal-1"]),
    detail: {
      summary: "这是一份 Harness 接入资料。",
      suggestedCollection: "AI 工作台",
      sourceUrl: "/api/knowledge/assets/asset-1",
      proposals: [
        { id: "proposal-1", kind: "note", title: "保存 Harness 笔记", status: "pending" },
        { id: "proposal-2", kind: "todo", title: "验证接入", status: "pending" },
      ],
    },
  };

  it("keeps a stable card frame and shows summary, destination, and proposal choices", () => {
    render(
      <KnowledgeFileCard
        item={readyItem}
        onToggleProposal={() => undefined}
        onConfirm={() => undefined}
        onRetry={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByTestId("knowledge-file-card")).toHaveClass("min-h-[168px]");
    expect(screen.getByText("这是一份 Harness 接入资料。")).toBeInTheDocument();
    expect(screen.getByText(/AI 工作台/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "保存 Harness 笔记" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "验证接入" })).not.toBeChecked();
  });

  it("sends only selected proposals and targets retry/delete to this item", () => {
    const onConfirm = vi.fn();
    const onRetry = vi.fn();
    const onDelete = vi.fn();
    render(
      <KnowledgeFileCard
        item={readyItem}
        onToggleProposal={() => undefined}
        onConfirm={onConfirm}
        onRetry={onRetry}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认归档和操作" }));
    fireEvent.click(screen.getByRole("button", { name: "重试 Harness.md" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 Harness.md" }));

    expect(onConfirm).toHaveBeenCalledWith("local-1", ["proposal-1"]);
    expect(onRetry).toHaveBeenCalledWith("local-1");
    expect(onDelete).toHaveBeenCalledWith("local-1");
  });
});

function UploadHarness() {
  const uploads = useKnowledgeUploads();
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          uploads.addFiles([
            new File(["1"], "one.md", { type: "text/markdown" }),
            new File(["2"], "two.md", { type: "text/markdown" }),
            new File(["3"], "three.md", { type: "text/markdown" }),
          ]);
          setCount(3);
        }}
      >
        添加三个文件
      </button>
      <span>{count}</span>
    </div>
  );
}

function UploadCallbackHarness({ onDurable }: { onDurable: (item: KnowledgeUploadItem) => void }) {
  const uploads = useKnowledgeUploads({ onDurable });
  return (
    <button onClick={() => uploads.addFiles([new File(["x"], "callback.md")])}>
      添加回调文件
    </button>
  );
}

function UploadCancelHarness({ onCancelIntake }: { onCancelIntake: (item: KnowledgeUploadItem) => Promise<void> }) {
  const uploads = useKnowledgeUploads({ onCancelIntake });
  const durable = uploads.items.find((item) => item.assetId);
  return (
    <div>
      <button
        onClick={() =>
          uploads.addFiles(
            [new File(["x"], "cancel.md")],
            {
              clientBatchId: "client-1",
              pageContext: {
                version: 1,
                route: "/todos",
                pageType: "todos",
                capturedAt: "2026-09-06T08:00:00.000Z",
                timezone: "Asia/Shanghai",
                trigger: { kind: "file_drop", clientBatchId: "client-1" },
              },
            },
          )
        }
      >
        添加待取消文件
      </button>
      {durable ? <button onClick={() => void uploads.remove(durable.localId)}>取消 intake 文件</button> : null}
    </div>
  );
}
