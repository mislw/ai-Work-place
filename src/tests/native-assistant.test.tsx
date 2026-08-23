import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  emit(type: string, data = "") {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }

  close = vi.fn();
}

import { NativeAssistant } from "@/components/assistant/native-assistant";

describe("NativeAssistant", () => {
  beforeEach(() => {
    localStorage.clear();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/harness/bootstrap") {
        return Response.json({
          url: "https://agent.mislw.cn/auth/bootstrap?token=secret",
        });
      }
      if (url === "/api/assistant/rpc") {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          payload: Record<string, unknown>;
        };
        const value =
          request.method === "session.create"
            ? { sessionId: "session-1" }
            : request.method === "session.history"
              ? { events: [] }
              : {};
        return Response.json({
          type: "server-response",
          rpcId: "rpc-1",
          result: { ok: true, value },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders a native conversation and uses a hidden bootstrap iframe for WebSocket auth", async () => {
    render(<NativeAssistant />);

    const heading = screen.getByRole("heading", { name: "我的助手" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("header")).toHaveClass("pl-14");
    expect(screen.getByRole("button", { name: "新对话" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "消息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
    expect(screen.queryByTitle("DeepSeek Harness")).not.toBeInTheDocument();

    const bootstrap = await screen.findByTitle("Harness session bootstrap");
    expect(bootstrap).toHaveClass("hidden");
    fireEvent.load(bootstrap);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://agent.mislw.cn/api/events.mux",
    );

    act(() => FakeWebSocket.instances[0]?.emit("open"));
    expect(await screen.findByText(/已连接/)).toBeInTheDocument();
  });

  it("executes a list action with a stable request id, shows results, and feeds them back", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/harness/bootstrap") {
        return Response.json({
          url: "https://agent.mislw.cn/auth/bootstrap?token=secret",
        });
      }
      if (url === "/api/assistant/actions") {
        return Response.json({
          ok: true,
          result: [
            {
              id: "event-1",
              title: "产品讨论",
              event_date: "2026-08-22",
              start_time: "14:00:00",
            },
          ],
        });
      }
      if (url === "/api/assistant/rpc") {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          payload: Record<string, unknown>;
        };
        const value =
          request.method === "session.create"
            ? { sessionId: "session-1" }
            : request.method === "session.history"
              ? { events: [] }
              : {};
        return Response.json({
          type: "server-response",
          rpcId: "rpc-1",
          result: { ok: true, value },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<NativeAssistant />);
    fireEvent.load(await screen.findByTitle("Harness session bootstrap"));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    act(() => {
      FakeWebSocket.instances[0]?.emit(
        "message",
        JSON.stringify({
          type: "server-request",
          payload: {
            type: "session/event",
            sessionId: "session-1",
            event: {
              type: "assistant/message",
              seq: 1,
              time: 1,
              data: {
                turn: 1,
                step: 1,
                message: {
                  id: "assistant-1",
                  content: [
                    {
                      type: "text",
                      text: '我查一下。\n```workbench-action\n{"action":"calendar.list","input":{"date":"2026-08-22"}}\n```',
                    },
                  ],
                },
              },
            },
          },
        }),
      );
    });

    expect(await screen.findByText("产品讨论 · 2026-08-22 14:00")).toBeInTheDocument();
    const actionRequest = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/assistant/actions",
    );
    expect(JSON.parse(String(actionRequest?.[1]?.body))).toEqual(
      expect.objectContaining({ requestId: "assistant-1:0" }),
    );
    await waitFor(() => {
      const prompts = fetchMock.mock.calls
        .filter(([url]) => String(url) === "/api/assistant/rpc")
        .map(([, init]) => JSON.parse(String(init?.body)))
        .filter((body) => body.method === "session.prompt");
      expect(prompts.at(-1)?.payload.content[0].text).toContain(
        "<workbench-action-result>",
      );
    });
  });

  it("keeps running state isolated when switching conversations", async () => {
    localStorage.setItem(
      "workbench.assistant.sessions.v1",
      JSON.stringify([
        { id: "session-1", title: "会话一", updatedAt: 2 },
        { id: "session-2", title: "会话二", updatedAt: 1 },
      ]),
    );

    render(<NativeAssistant />);
    fireEvent.load(await screen.findByTitle("Harness session bootstrap"));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await screen.findByText("今天想先处理什么？");

    fireEvent.change(screen.getByRole("textbox", { name: "消息" }), {
      target: { value: "会话一的问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("button", { name: "停止" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "会话二" }));
    expect(await screen.findByRole("button", { name: "发送" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "消息" }), {
      target: { value: "会话二的问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("button", { name: "停止" })).toBeInTheDocument();

    act(() => {
      FakeWebSocket.instances[0]?.emit(
        "message",
        JSON.stringify({
          type: "server-request",
          payload: {
            type: "session/event",
            sessionId: "session-1",
            event: { type: "turn/end", seq: 2, time: 2, data: {} },
          },
        }),
      );
    });

    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
  });
});
