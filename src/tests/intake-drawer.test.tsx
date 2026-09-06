import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeActivityButton } from "@/components/intake/intake-activity-button";
import { IntakeDrawer } from "@/components/intake/intake-drawer";
import type { GlobalFileIntakeContextValue } from "@/components/intake/global-file-intake-provider";
import type { IntakeBatch } from "@/lib/intake/contracts";

globalThis.React = React;

const state = vi.hoisted(() => ({ value: {} as GlobalFileIntakeContextValue }));
vi.mock("@/components/intake/global-file-intake-provider", () => ({
  useGlobalFileIntake: () => state.value,
}));

describe("IntakeDrawer", () => {
  beforeEach(() => {
    state.value = contextValue();
  });

  it("shows source context, Hermes state, receipts, and responsive overlay sizing", () => {
    render(<IntakeDrawer />);

    expect(screen.getByText("来源：待办")).toBeInTheDocument();
    expect(screen.getByText("Hermes 正在判断放在哪里")).toBeInTheDocument();
    expect(screen.getByText("创建笔记")).toBeInTheDocument();
    expect(screen.getByTestId("intake-drawer")).toHaveClass(
      "fixed",
      "right-2",
      "w-[420px]",
      "max-w-[calc(100vw-16px)]",
      "max-md:bottom-20",
    );
  });

  it("closing the drawer changes only UI state", () => {
    render(<IntakeDrawer />);

    fireEvent.click(screen.getByRole("button", { name: "关闭整理面板" }));

    expect(state.value.setDrawerOpen).toHaveBeenCalledWith(false);
    expect(state.value.cancel).not.toHaveBeenCalled();
  });

  it("confirms undo and explains that edited records are preserved", async () => {
    state.value = contextValue({ batch: createBatch({ status: "completed" }) });
    render(<IntakeDrawer />);

    fireEvent.click(screen.getByRole("button", { name: "撤销本批操作" }));

    expect(screen.getByText("已被你修改的记录会保留，不会强行删除。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(state.value.undo).toHaveBeenCalledWith(BATCH_ID));
  });

  it("shows an explicit message for undo conflicts", () => {
    state.value = contextValue({
      batch: createBatch({
        status: "partial",
        errorCode: "UNDO_RECORD_CHANGED",
        stepStatus: "undo_conflict",
      }),
    });

    render(<IntakeDrawer />);

    expect(screen.getByText("记录已被你修改，未删除")).toBeInTheDocument();
  });

  it("renders retry and cancel only for their matching states", () => {
    state.value = contextValue({ batch: createBatch({ status: "failed" }) });
    const view = render(<IntakeDrawer />);
    expect(screen.getByRole("button", { name: "重试失败项" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "取消整理" })).not.toBeInTheDocument();

    state.value = contextValue({ batch: createBatch({ status: "executing" }) });
    view.rerender(<IntakeDrawer />);
    expect(screen.getByRole("button", { name: "取消整理" })).toBeEnabled();
  });
});

describe("IntakeActivityButton", () => {
  it("appears only while the drawer is closed and restores it", () => {
    state.value = contextValue({ drawerOpen: false });
    render(<IntakeActivityButton />);

    fireEvent.click(screen.getByRole("button", { name: "打开整理面板，处理中 1" }));

    expect(state.value.setDrawerOpen).toHaveBeenCalledWith(true);
  });
});

const BATCH_ID = "00000000-0000-4000-8000-000000000900";

function contextValue(options: { batch?: IntakeBatch; drawerOpen?: boolean } = {}): GlobalFileIntakeContextValue {
  const batch = options.batch ?? createBatch();
  return {
    batches: [batch],
    localUploads: [],
    drawerOpen: options.drawerOpen ?? true,
    activeCount: ["uploading", "processing", "orchestrating", "executing"].includes(batch.status) ? 1 : 0,
    enqueueFiles: vi.fn(),
    setDrawerOpen: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn().mockResolvedValue(undefined),
  };
}

function createBatch(options: {
  status?: IntakeBatch["status"];
  errorCode?: string | null;
  stepStatus?: IntakeBatch["items"][number]["steps"][number]["status"];
} = {}): IntakeBatch {
  return {
    id: BATCH_ID,
    clientBatchId: "client-1",
    sourceType: "file_drop",
    pageContext: {
      version: 1,
      route: "/todos?status=pending",
      pageType: "todos",
      capturedAt: "2026-09-06T08:00:00.000Z",
      timezone: "Asia/Shanghai",
      trigger: { kind: "file_drop", clientBatchId: "client-1" },
    },
    status: options.status ?? "orchestrating",
    summary: "整理项目会议记录",
    errorCode: options.errorCode ?? null,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:01:00.000Z",
    completedAt: options.status === "completed" ? "2026-09-06T08:02:00.000Z" : null,
    undoneAt: null,
    items: [
      {
        id: "00000000-0000-4000-8000-000000000901",
        batchId: BATCH_ID,
        assetId: "00000000-0000-4000-8000-000000000001",
        documentId: "00000000-0000-4000-8000-000000000002",
        jobId: "00000000-0000-4000-8000-000000000003",
        hermesRunId: "run-1",
        status: options.status === "failed" ? "failed" : "orchestrating",
        confidence: 0.86,
        decisionSummary: "归档并创建会议笔记",
        errorCode: options.errorCode ?? null,
        attemptCount: 1,
        invalidPlanCount: 0,
        availableAt: "2026-09-06T08:00:00.000Z",
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: "2026-09-06T08:00:00.000Z",
        updatedAt: "2026-09-06T08:01:00.000Z",
        completedAt: null,
        steps: [
          {
            id: "00000000-0000-4000-8000-000000000902",
            batchId: BATCH_ID,
            itemId: "00000000-0000-4000-8000-000000000901",
            sequence: 0,
            actionName: "note.create",
            forwardInput: { title: "项目会议" },
            forwardResult: { id: "note-1" },
            inverseAction: "record.delete",
            inverseInput: { table: "notes", id: "note-1" },
            conflictFingerprint: "sha256:test",
            status: options.stepStatus ?? "completed",
            confidence: 0.86,
            errorCode: options.errorCode ?? null,
            createdAt: "2026-09-06T08:00:00.000Z",
            updatedAt: "2026-09-06T08:01:00.000Z",
            completedAt: "2026-09-06T08:01:00.000Z",
            undoneAt: null,
          },
        ],
      },
    ],
  };
}
