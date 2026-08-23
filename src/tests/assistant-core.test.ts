import { describe, expect, it } from "vitest";
import {
  buildHarnessRequest,
  getHarnessWebSocketUrl,
  parseHarnessResponse,
  reduceSessionEvents,
} from "@/lib/assistant/harness-protocol";
import {
  buildWorkbenchActionResultPrompt,
  buildWorkbenchPrompt,
  stripWorkbenchContext,
} from "@/lib/assistant/context";
import {
  getActionPolicy,
  parseWorkbenchActionBlocks,
  summarizeActionResult,
  workbenchActionSchema,
} from "@/lib/assistant/actions";

describe("Harness assistant protocol", () => {
  it("builds a client request envelope and unwraps a successful response", () => {
    const request = buildHarnessRequest("session.create", { agentPreset: "default" });

    expect(request.type).toBe("client-request");
    expect(request.method).toBe("session.create");
    expect(request.rpcId).toEqual(expect.any(String));

    expect(
      parseHarnessResponse({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { sessionId: "session-1" } },
      }),
    ).toEqual({ sessionId: "session-1" });
  });

  it("derives the authenticated mux WebSocket URL from the bootstrap origin", () => {
    expect(
      getHarnessWebSocketUrl(
        "https://agent.mislw.cn/auth/bootstrap?token=secret",
      ),
    ).toBe("wss://agent.mislw.cn/api/events.mux");
  });

  it("turns history and live chunks into native conversation messages", () => {
    const messages = reduceSessionEvents([
      {
        type: "user/message",
        seq: 1,
        time: 100,
        data: {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "你好" }],
        },
      },
      {
        type: "assistant/chunk",
        seq: 2,
        time: 110,
        data: {
          turn: 1,
          step: 1,
          chunk: { type: "text-delta", index: 0, text: "你" },
        },
      },
      {
        type: "assistant/chunk",
        seq: 3,
        time: 120,
        data: {
          turn: 1,
          step: 1,
          chunk: { type: "text-delta", index: 0, text: "好" },
        },
      },
      {
        type: "assistant/message",
        seq: 4,
        time: 130,
        data: {
          turn: 1,
          step: 1,
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "你好" }],
          },
        },
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({ id: "user-1", role: "user", text: "你好" }),
      expect.objectContaining({
        id: "assistant-1",
        role: "assistant",
        text: "你好",
        streaming: false,
      }),
    ]);
  });
});

describe("workbench context", () => {
  it("keeps prompt context compact and removable from rendered history", () => {
    const prompt = buildWorkbenchPrompt("下午两点提醒我开会", {
      page: "/assistant",
      date: "2026-08-22",
      timeZone: "Asia/Shanghai",
    });

    expect(prompt).toContain("<workbench-context>");
    expect(prompt).toContain("calendar.create");
    expect(prompt.length).toBeLessThan(2_400);
    expect(stripWorkbenchContext(prompt)).toBe("下午两点提醒我开会");
  });

  it("builds a hidden bounded action result prompt for the follow-up answer", () => {
    const prompt = buildWorkbenchActionResultPrompt(
      { action: "todo.list", input: { date: "2026-08-22" } },
      Array.from({ length: 30 }, (_, index) => ({
        id: `todo-${index}`,
        title: `事项 ${index}`,
        status: "pending",
      })),
    );

    expect(prompt).toContain("<workbench-action-result>");
    expect(prompt).toContain('"action":"todo.list"');
    expect(prompt.length).toBeLessThan(9_000);
    expect(stripWorkbenchContext(prompt)).toBe("");
  });
});

describe("workbench actions", () => {
  it("validates actions and requires confirmation for destructive mutations", () => {
    const create = workbenchActionSchema.parse({
      action: "todo.create",
      input: { title: "整理 Cowart UI" },
    });
    const complete = workbenchActionSchema.parse({
      action: "todo.complete",
      input: { id: "todo-1" },
    });

    expect(getActionPolicy(create.action)).toBe("immediate");
    expect(getActionPolicy(complete.action)).toBe("confirm");
  });

  it("extracts hidden action blocks without leaving protocol text in the reply", () => {
    const parsed = parseWorkbenchActionBlocks(
      "我可以帮你记下来。\n```workbench-action\n{\"action\":\"note.create\",\"input\":{\"title\":\"Harness\",\"content\":\"接入方案\"}}\n```",
    );

    expect(parsed.text).toBe("我可以帮你记下来。");
    expect(parsed.actions).toEqual([
      {
        action: "note.create",
        input: { title: "Harness", content: "接入方案" },
      },
    ]);
  });

  it("summarizes list results as readable workbench content", () => {
    expect(
      summarizeActionResult(
        { action: "calendar.list", input: { date: "2026-08-22" } },
        [
          {
            id: "event-1",
            title: "产品讨论",
            event_date: "2026-08-22",
            start_time: "14:00:00",
          },
          {
            id: "event-2",
            title: "整理资料",
            event_date: "2026-08-22",
          },
        ],
      ),
    ).toBe("产品讨论 · 2026-08-22 14:00\n整理资料 · 2026-08-22");
    expect(
      summarizeActionResult(
        { action: "todo.list", input: {} },
        [],
      ),
    ).toBe("没有找到相关内容");
  });
});
