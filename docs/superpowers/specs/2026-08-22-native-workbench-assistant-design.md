# Native Workbench Assistant Design

## Product position

The assistant is a personal workbench companion: conversation, information organization,
schedule management, and lightweight continuity. It is not a general autonomous Agent OS.

The first useful loop is intentionally short:

```text
user message -> assistant understands -> 0-2 workbench actions -> visible data change
```

## Architecture

```text
Native Assistant UI
        |
/api/assistant/*
        |
Assistant Adapter -------- Workbench Action API
        |                          |
Harness Gateway                Supabase/RLS
        |
DeepSeek Harness
```

The native UI owns the product experience. DeepSeek Harness remains responsible for
sessions, history, streaming responses, and its basic agent loop. The existing Harness
iframe remains available only as an advanced/debug entry.

## Harness adapter

The browser never receives Harness credentials. Every Assistant API request:

1. authenticates the Supabase user and checks the configured owner;
2. mints a one-time Harness bootstrap token;
3. exchanges it server-side for a short-lived gateway cookie for typed RPC calls;
4. bootstraps the browser through a hidden iframe so the Harness origin can set its
   HttpOnly cookie, then opens the official `events.mux` WebSocket downlink;
5. strips all gateway credentials from application-visible responses.

The adapter exposes only the methods required by the native UI:

- `session.create`
- `session.history`
- `session.prompt`
- `session.cancel`
- `events.mux`

Harness wire details stay inside `src/lib/assistant/harness-*`.

## Lightweight context

Each prompt carries a compact workbench context block containing only:

- current route/page;
- local date and time zone;
- current workbench section;
- available action names;
- the action-output contract.

No calendar, todo, note, or document table is injected wholesale. Retrieval is action-led.
The context block is marked and stripped when native history is rendered.

## Action contract

All workbench mutations share one discriminated JSON contract. This is the stable seam for
both the native structured-output bridge and the future Harness MCP service.

Phase-one actions:

- `calendar.create`, `calendar.list`, `calendar.update`, `calendar.delete`
- `todo.create`, `todo.list`, `todo.update`, `todo.complete`, `todo.delete`
- `note.create`, `note.list`, `note.update`, `note.delete`
- `document.create`, `document.list`, `document.update`, `document.delete`

The assistant emits action proposals in a fenced `workbench-action` JSON block. The native UI
parses and renders them. Read and create actions execute immediately. Update, complete, and
delete actions become confirmation cards and execute only after explicit user confirmation.

The server independently classifies every action, validates its payload with Zod, relies on
the user's Supabase session plus RLS, and never accepts a user id from the model.

## Conversation state

Harness is the source of truth for full conversation history. The browser stores only the
active Harness session id. Supabase conversation indexes, durable memory, and workspace
classification are deferred until the native loop has proven useful.

## Deferred work

- Streamable HTTP MCP wrapper over the same Workbench Action API
- workspace tables and attachment semantics
- PostgreSQL full-text memory search and curated long-term memory
- reminders/notifications
- vector retrieval, multi-agent routing, autonomous planning, and permission profiles

## Acceptance

- `/assistant` is native and responsive; it does not render an iframe by default.
- A conversation can create/resume a Harness session, load history, send a prompt, and stream.
- Action proposals render as workbench-native result or confirmation cards.
- Create can execute directly; update/complete/delete cannot execute without confirmation.
- Existing Harness iframe remains reachable as an advanced entry.
- Unit tests, typecheck, production build, and desktop/mobile browser checks pass locally.
