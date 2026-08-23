"use client";

import Link from "next/link";
import {
  Bot,
  CalendarDays,
  Check,
  CheckSquare,
  FileText,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  StickyNote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { KnowledgeUploadTray } from "@/components/assistant/knowledge-upload-tray";
import { useKnowledgeUploads } from "@/hooks/use-knowledge-uploads";
import {
  getActionPolicy,
  parseWorkbenchActionBlocks,
  summarizeActionResult,
  type WorkbenchAction,
} from "@/lib/assistant/actions";
import {
  buildWorkbenchActionResultPrompt,
  buildWorkbenchPrompt,
  stripWorkbenchContext,
} from "@/lib/assistant/context";
import {
  getHarnessWebSocketUrl,
  parseHarnessResponse,
  reduceSessionEvents,
  type AssistantMessage,
  type HarnessEvent,
  type HarnessMethod,
} from "@/lib/assistant/harness-protocol";

const SESSION_STORAGE_KEY = "workbench.assistant.sessions.v1";

type LocalSession = {
  id: string;
  title: string;
  updatedAt: number;
};

type ActionState = {
  key: string;
  sessionId: string;
  messageId: string;
  action: WorkbenchAction;
  status: "pending" | "running" | "done" | "cancelled" | "error";
  result?: unknown;
  error?: string;
};

const SUGGESTIONS = [
  { icon: CalendarDays, text: "帮我看看今天的日程" },
  { icon: CheckSquare, text: "把今天没完成的事情整理一下" },
  { icon: StickyNote, text: "把我们刚才讨论的内容整理成笔记" },
] as const;

export function NativeAssistant() {
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [actions, setActions] = useState<ActionState[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [bootstrapUrl, setBootstrapUrl] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const eventLog = useRef<HarnessEvent[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const executedActions = useRef(new Set<string>());
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);
  const knowledgeUploads = useKnowledgeUploads({
    onConfirmed: (item) => {
      setMessages((current) => [
        ...current,
        {
          id: `knowledge-${item.localId}-${Date.now()}`,
          role: "assistant",
          text: `已把 ${item.file.name} 中选中的建议同步到工作台。`,
          time: Date.now(),
          streaming: false,
        },
      ]);
    },
  });

  const running = selectedId ? runningSessionIds.has(selectedId) : false;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const setSessionRunning = useCallback((sessionId: string, value: boolean) => {
    setRunningSessionIds((current) => {
      const next = new Set(current);
      if (value) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  const persistSessions = useCallback((next: LocalSession[]) => {
    setSessions(next);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const createSession = useCallback(async () => {
    setError(null);
    const response = await rpc<{ sessionId: string }>("session.create", {});
    const session = {
      id: response.sessionId,
      title: "新对话",
      updatedAt: Date.now(),
    };
    const next = [session, ...sessions.filter((item) => item.id !== session.id)];
    persistSessions(next);
    setSelectedId(session.id);
    setMessages([]);
    setActions([]);
    eventLog.current = [];
    return session.id;
  }, [persistSessions, sessions]);

  useEffect(() => {
    let stored: LocalSession[] = [];
    try {
      const value = localStorage.getItem(SESSION_STORAGE_KEY);
      if (value) stored = JSON.parse(value) as LocalSession[];
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    if (stored.length > 0) {
      setSessions(stored);
      setSelectedId(stored[0]?.id ?? null);
      return;
    }
    void createSession().catch((reason) => {
      setError(readError(reason));
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void rpc<{ events: Array<{ event: HarnessEvent }> }>("session.history", {
      sessionId: selectedId,
      maxMessages: 100,
    })
      .then((history) => {
        if (cancelled) return;
        eventLog.current = history.events.map((entry) => entry.event);
        const restored = restoreConversation(selectedId, eventLog.current);
        setMessages(restored.messages);
        setActions(restored.actions);
      })
      .catch((reason) => {
        if (!cancelled) setError(readError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const runAction = useCallback(
    async (state: ActionState, confirmed: boolean) => {
      setActions((current) =>
        current.map((item) =>
          item.key === state.key
            ? { ...item, status: "running", error: undefined }
            : item,
        ),
      );
      try {
        const response = await fetch("/api/assistant/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: state.action,
            confirmed,
            requestId: state.key,
          }),
        });
        const body = (await response.json()) as {
          result?: unknown;
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? "工作台操作失败");
        setActions((current) =>
          current.map((item) =>
            item.key === state.key
              ? { ...item, status: "done", result: body.result }
              : item,
          ),
        );

        if (state.action.action.endsWith(".list")) {
          const timeZone = getClientTimeZone();
          setSessionRunning(state.sessionId, true);
          try {
            await rpc("session.prompt", {
              sessionId: state.sessionId,
              mode: "queue",
              content: [
                {
                  type: "text",
                  text: buildWorkbenchActionResultPrompt(
                    state.action,
                    body.result,
                  ),
                },
              ],
              clientTimeZone: timeZone,
            });
          } catch (reason) {
            setSessionRunning(state.sessionId, false);
            setError(`查询已完成，但助手续答失败：${readError(reason)}`);
          }
        }
      } catch (reason) {
        setActions((current) =>
          current.map((item) =>
            item.key === state.key
              ? { ...item, status: "error", error: readError(reason) }
              : item,
          ),
        );
      }
    },
    [setSessionRunning],
  );

  const handleLiveEvent = useCallback(
    (sessionId: string, event: HarnessEvent) => {
      if (event.type === "turn/end") setSessionRunning(sessionId, false);
      if (sessionId !== selectedIdRef.current) return;
      eventLog.current.push(event);
      setMessages(restoreConversation(sessionId, eventLog.current).messages);

      if (event.type !== "assistant/message") return;
      const data = isRecord(event.data) ? event.data : null;
      const message = isRecord(data?.message) ? data.message : null;
      const messageId = typeof message?.id === "string" ? message.id : `seq-${event.seq}`;
      const text = readMessageText(message);
      const parsed = parseWorkbenchActionBlocks(text);
      const next = parsed.actions.map((action, index): ActionState => ({
        key: `${messageId}:${index}`,
        sessionId,
        messageId,
        action,
        status: "pending",
      }));
      setActions((current) => [
        ...current.filter((item) => item.messageId !== messageId),
        ...next,
      ]);
      for (const state of next) {
        if (getActionPolicy(state.action.action) !== "immediate") continue;
        if (executedActions.current.has(state.key)) continue;
        executedActions.current.add(state.key);
        void runAction(state, false);
      }
    },
    [runAction, setSessionRunning],
  );

  const loadHarnessBootstrap = useCallback(async () => {
    const response = await fetch("/api/harness/bootstrap", { method: "POST" });
    const body = (await response.json()) as {
      url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.url) {
      throw new Error(body.error?.message ?? "AI 助手服务未配置");
    }
    if (!disposed.current) setBootstrapUrl(body.url);
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (disposed.current || reconnectTimer.current) return;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      void loadHarnessBootstrap().catch((reason) => setError(readError(reason)));
    }, 1_500);
  }, [loadHarnessBootstrap]);

  const connectHarnessSocket = useCallback(() => {
    if (!bootstrapUrl || disposed.current) return;
    const previous = socketRef.current;
    socketRef.current = null;
    previous?.close();

    const socket = new WebSocket(getHarnessWebSocketUrl(bootstrapUrl));
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      setConnected(true);
    });
    socket.addEventListener("error", () => {
      if (socketRef.current === socket) setConnected(false);
    });
    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setConnected(false);
      scheduleReconnect();
    });
    socket.addEventListener("message", (message) => {
      try {
        const envelope = JSON.parse(String(message.data)) as unknown;
        if (!isRecord(envelope) || envelope.type !== "server-request") return;
        const payload = isRecord(envelope.payload) ? envelope.payload : null;
        if (
          payload?.type !== "session/event" ||
          typeof payload.sessionId !== "string" ||
          !isRecord(payload.event)
        ) {
          return;
        }
        handleLiveEvent(
          payload.sessionId,
          payload.event as unknown as HarnessEvent,
        );
      } catch {
        // A malformed frame is ignored; the next history load repairs the view.
      }
    });
  }, [bootstrapUrl, handleLiveEvent, scheduleReconnect]);

  useEffect(() => {
    disposed.current = false;
    void loadHarnessBootstrap().catch((reason) => setError(readError(reason)));
    return () => {
      disposed.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [loadHarnessBootstrap]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, actions]);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedId) ?? null,
    [selectedId, sessions],
  );

  async function sendMessage(text = draft) {
    const value = text.trim();
    if (!value || running) return;
    setDraft("");
    setError(null);
    let sessionId = selectedId;
    try {
      if (!sessionId) sessionId = await createSession();
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          role: "user",
          text: value,
          time: Date.now(),
          streaming: false,
        },
      ]);
      setSessionRunning(sessionId, true);
      const timeZone = getClientTimeZone();
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      await rpc("session.prompt", {
        sessionId,
        mode: "queue",
        content: [
          {
            type: "text",
            text: buildWorkbenchPrompt(value, {
              page: window.location.pathname,
              date,
              timeZone,
            }),
          },
        ],
        clientTimeZone: timeZone,
      });
      const title = value.length > 22 ? `${value.slice(0, 22)}...` : value;
      const next = [
        { id: sessionId, title, updatedAt: Date.now() },
        ...sessions.filter((item) => item.id !== sessionId),
      ];
      persistSessions(next);
    } catch (reason) {
      if (sessionId) setSessionRunning(sessionId, false);
      setError(readError(reason));
    }
  }

  async function cancel() {
    const sessionId = selectedId;
    if (!sessionId) return;
    try {
      await rpc("session.cancel", { sessionId });
    } finally {
      setSessionRunning(sessionId, false);
    }
  }

  return (
    <section
      data-crayon-page="assistant"
      className="crayon-page flex h-[calc(100svh-4rem)] min-h-[540px] w-full overflow-hidden bg-transparent md:h-[calc(100svh-4rem)]"
    >
      {bootstrapUrl ? (
        <iframe
          title="Harness session bootstrap"
          src={bootstrapUrl}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onLoad={connectHarnessSocket}
        />
      ) : null}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-border bg-card md:flex md:flex-col",
          sidebarOpen ? "w-64" : "w-14",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          {sidebarOpen ? <span className="text-sm font-semibold">对话</span> : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label={sidebarOpen ? "收起对话列表" : "展开对话列表"}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="p-2">
          <Button
            variant="outline"
            className={cn("w-full", sidebarOpen ? "justify-start gap-2" : "px-0")}
            aria-label="新对话"
            onClick={() => void createSession().catch((reason) => setError(readError(reason)))}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {sidebarOpen ? "新对话" : null}
          </Button>
        </div>
        {sidebarOpen ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                className={cn(
                  "mb-1 w-full rounded-md px-3 py-2 text-left text-sm",
                  session.id === selectedId
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="block truncate">{session.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border pl-14 pr-4 md:px-5">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">我的助手</h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected ? "bg-success" : "bg-muted-foreground/50",
                )}
              />
              {connected ? "已连接" : "正在连接"}
              {selectedSession ? ` · ${selectedSession.title}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden"
              aria-label="新建移动端对话"
              onClick={() => void createSession().catch((reason) => setError(readError(reason)))}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
            <Button asChild size="icon" variant="ghost">
              <Link href="/assistant?mode=harness" aria-label="打开 Harness 高级模式">
                <Settings2 className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 md:px-8">
            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="加载对话" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center py-10">
                <div className="mb-8 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xl font-semibold">今天想先处理什么？</p>
                    <p className="mt-1 text-sm text-muted-foreground">我可以和你聊，也可以直接整理工作台里的事情。</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion.text}
                      onClick={() => void sendMessage(suggestion.text)}
                      className="flex min-h-24 flex-col items-start justify-between rounded-md border border-border p-3 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <suggestion.icon className="h-4 w-4 text-muted-foreground" />
                      <span>{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    actions={actions.filter((item) => item.messageId === message.id)}
                    onConfirm={(state) => void runAction(state, true)}
                    onCancel={(state) =>
                      setActions((current) =>
                        current.map((item) =>
                          item.key === state.key ? { ...item, status: "cancelled" } : item,
                        ),
                      )
                    }
                  />
                ))}
                <div ref={scrollAnchor} />
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background px-3 py-3 md:px-6">
          <div className="mx-auto max-w-3xl">
            {error ? (
              <div className="mb-2 flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span>{error}</span>
                <button aria-label="关闭错误" onClick={() => setError(null)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            <KnowledgeUploadTray
              items={knowledgeUploads.items}
              onToggleProposal={knowledgeUploads.toggleProposal}
              onConfirm={(localId, proposalIds) =>
                void knowledgeUploads.confirm(localId, proposalIds).catch((reason) =>
                  setError(readError(reason)),
                )
              }
              onRetry={knowledgeUploads.retry}
              onDelete={(localId) =>
                void knowledgeUploads.remove(localId).catch((reason) =>
                  setError(readError(reason)),
                )
              }
            />
            <AssistantComposer
              draft={draft}
              loading={loading}
              running={running}
              onDraftChange={setDraft}
              onSend={() => void sendMessage()}
              onCancel={() => void cancel()}
              onFiles={knowledgeUploads.addFiles}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageRow({
  message,
  actions,
  onConfirm,
  onCancel,
}: {
  message: AssistantMessage;
  actions: ActionState[];
  onConfirm: (state: ActionState) => void;
  onCancel: (state: ActionState) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0", isUser ? "max-w-[85%]" : "w-full max-w-[92%]")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-7",
            isUser
              ? "rounded-md bg-foreground px-4 py-2.5 text-background"
              : "text-foreground",
          )}
        >
          {message.text || (message.streaming ? "正在思考..." : "")}
        </div>
        {actions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {actions.map((state) => (
              <ActionCard
                key={state.key}
                state={state}
                onConfirm={() => onConfirm(state)}
                onCancel={() => onCancel(state)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionCard({
  state,
  onConfirm,
  onCancel,
}: {
  state: ActionState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const Icon = getActionIcon(state.action.action);
  const requiresConfirmation = getActionPolicy(state.action.action) === "confirm";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{getActionTitle(state.action)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {getActionSummary(state.action)}
          </p>
        </div>
        {state.status === "running" ? (
          <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
        {state.status === "done" ? <Check className="mt-1 h-4 w-4 text-success" /> : null}
      </div>
      {state.status === "error" ? (
        <p className="mt-2 text-xs text-destructive">{state.error}</p>
      ) : null}
      {state.status === "done" && state.result !== undefined ? (
        <p className="mt-2 whitespace-pre-line text-xs leading-5 text-muted-foreground">
          {summarizeActionResult(state.action, state.result)}
        </p>
      ) : null}
      {requiresConfirmation && state.status === "pending" ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onConfirm}>
            确认
          </Button>
        </div>
      ) : null}
      {!requiresConfirmation && state.status === "pending" ? (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={onConfirm}>
            执行
          </Button>
        </div>
      ) : null}
      {state.status === "cancelled" ? (
        <p className="mt-2 text-xs text-muted-foreground">已取消</p>
      ) : null}
    </div>
  );
}

async function rpc<T = unknown>(method: HarnessMethod, payload: Record<string, unknown>) {
  const response = await fetch("/api/assistant/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, payload }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const record = isRecord(body) && isRecord(body.error) ? body.error : null;
    throw new Error(typeof record?.message === "string" ? record.message : "AI 助手请求失败");
  }
  return parseHarnessResponse<T>(body);
}

function readMessageText(message: Record<string, unknown> | null) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter(isRecord)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("");
}

function getActionIcon(action: WorkbenchAction["action"]) {
  if (action.startsWith("calendar.")) return CalendarDays;
  if (action.startsWith("todo.")) return CheckSquare;
  if (action.startsWith("note.")) return StickyNote;
  return FileText;
}

function getActionTitle(action: WorkbenchAction) {
  const [resource, verb] = action.action.split(".");
  const resourceName = {
    calendar: "日程",
    todo: "待办",
    note: "笔记",
    document: "文档",
  }[resource ?? ""];
  const verbName = {
    list: "查询",
    create: "创建",
    update: "修改",
    complete: "完成",
    delete: "删除",
  }[verb ?? ""];
  return `${verbName ?? "处理"}${resourceName ?? "工作台内容"}`;
}

function getActionSummary(action: WorkbenchAction) {
  const input = action.input as Record<string, unknown>;
  return String(input.title ?? input.date ?? input.query ?? input.id ?? action.action);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "AI 助手暂时不可用";
}

function restoreConversation(sessionId: string, events: HarnessEvent[]) {
  const messages: AssistantMessage[] = [];
  const actions: ActionState[] = [];
  for (const message of reduceSessionEvents(events)) {
    if (message.role === "user") {
      const text = stripWorkbenchContext(message.text);
      if (text) messages.push({ ...message, text });
      continue;
    }
    const parsed = parseWorkbenchActionBlocks(message.text);
    messages.push({ ...message, text: parsed.text });
    parsed.actions.forEach((action, index) => {
      actions.push({
        key: `${message.id}:${index}`,
        sessionId,
        messageId: message.id,
        action,
        status: "pending",
      });
    });
  }
  return { messages, actions };
}

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
