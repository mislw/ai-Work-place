# Hermes Runtime Migration Design

## Goal

Replace DeepSeek Harness as the agent runtime while preserving the Personal AI Workspace application, native assistant experience, knowledge ingestion pipeline, owner-scoped business tools, and NAS data boundaries.

Hermes becomes the source of truth for agent runs, model calls, tool orchestration, memory, skills, subagents, and scheduled work. The workspace remains the source of truth for authentication, calendar, todos, notes, document links, knowledge assets, approval presentation, and user-facing navigation.

## Decision

Use the existing workspace UI with the Hermes Runs API. Do not embed the Hermes Dashboard as the assistant page.

Three approaches were considered:

1. Embed the Hermes Dashboard. This is rejected because the Dashboard is an administration surface, does not match the workspace interaction model, and would recreate iframe authentication and styling problems.
2. Replace only the runtime. This is selected because it preserves completed business integration while gaining Hermes memory, skills, subagents, scheduling, and tool orchestration.
3. Keep DeepSeek Harness. This remains the rollback path during migration but is not the target architecture.

## Target Architecture

```text
Browser /assistant
  -> Personal AI Workspace native assistant UI
  -> same-origin Next.js Hermes proxy
  -> Hermes Runs API and SSE event stream
  -> Hermes agent runtime
  -> authenticated Streamable HTTP MCP
  -> existing workspace tool service
  -> calendar / todos / notes / documents / knowledge

Browser knowledge upload
  -> existing private upload API
  -> NAS private storage
  -> knowledge-worker
  -> PDF / DOCX / XLSX / Markdown / text / image extraction
  -> owner-scoped knowledge records
  -> knowledge MCP tools
```

The browser never receives the Hermes service credential or the internal MCP secret. Hermes does not receive Supabase service-role credentials, the NAS root, the Docker socket, or access to deployment files.

## Components

### Native Assistant

`/assistant` returns to a workspace-owned interface instead of an iframe. The existing native assistant components may be reused where their behavior matches the Runs API, but Harness-specific RPC and event assumptions must be removed rather than emulated.

The interface must support:

- creating and reopening conversations;
- streamed assistant text and reasoning status;
- tool call and tool result presentation;
- approval cards for gated tools;
- cancellation and retry;
- image attachment input;
- the existing knowledge upload tray for office files and documents;
- explicit disconnected, failed, and recoverable states.

### Hermes Proxy

Add a same-origin server boundary between the browser and Hermes. It authenticates the workspace user, maps the user to a Hermes profile or conversation namespace, attaches the internal Hermes API credential, validates request sizes, and forwards Runs API events without buffering the stream.

The proxy exposes only the operations needed by the assistant UI. It does not become a generic pass-through to every Hermes administrative endpoint.

### Hermes Runtime

Run Hermes as a separate container with persistent state and a dedicated workspace volume. Use the Runs API for interactive work. The legacy chat-completions endpoint is not part of the integration contract.

Hermes receives the existing workspace MCP endpoint as a remote Streamable HTTP server. The server is configured as untrusted so write-capable tools require approval. Read-only behavior continues to be communicated through MCP annotations.

### Workspace MCP and Tool Service

Keep the existing twenty tools and their Zod validation, owner binding, idempotency rules, and structured results. The current `harness` names can remain internally during the compatibility phase, but new public types and routes must use runtime-neutral names where practical.

The MCP bearer secret remains an internal service credential. Tool arguments never accept a model-supplied owner or user ID.

### Knowledge Pipeline

Keep the existing upload, quarantine, extraction, analysis, confirmation, storage, and search pipeline. Hermes inline image input is used only for direct visual conversation. PDF, DOCX, XLSX, Markdown, text, and archived images continue through the knowledge pipeline.

An uploaded file is not described as available to Hermes until processing succeeds and the corresponding knowledge tool can retrieve it.

## Session and Identity Model

The workspace user owns the browser session. The server maps that identity to a stable Hermes profile namespace and stores the relationship server-side.

Conversation identifiers returned by Hermes are opaque. Every read, resume, cancel, or approval request must prove that the current workspace user owns the mapped conversation. Client-provided profile paths or arbitrary Hermes run IDs are never trusted directly.

For the current single-owner deployment, one Hermes profile is sufficient. The mapping must nevertheless avoid hard-coding a browser-supplied owner so a future multi-user deployment does not expose shared memory.

## Approval Flow

1. Hermes requests a tool call.
2. Read-only tools execute immediately.
3. A write-capable tool produces an approval event before execution.
4. The proxy records the pending approval against the authenticated user and run.
5. The native assistant renders a specific description of the proposed operation and its arguments.
6. Approval or rejection is sent through the Hermes Runs approval operation.
7. The workspace tool service still validates owner scope, schema, and idempotency at execution time.

Approval is not treated as authorization to bypass server validation. A stale, replayed, cross-user, or already-resolved approval is rejected.

## Error Handling and Recovery

- If Hermes is unavailable, the assistant shows a retryable service error; the rest of the workspace remains usable.
- If the SSE connection drops, the UI resumes or reloads the run from the last known event cursor instead of duplicating the prompt.
- If an approval response is lost, the current run state is read before retrying it.
- If a write tool succeeds but the event stream disconnects, its stable request ID prevents duplicate business data on resume.
- If the knowledge worker is unavailable, uploads remain visibly queued or failed and are not silently sent as model context.
- Unsupported Hermes events are logged with safe metadata and shown as a generic recoverable state; secrets and full private document content are excluded from logs.

## Deployment

During migration, Compose runs both runtimes:

- `app`: Personal AI Workspace;
- `knowledge-worker`: existing document ingestion worker;
- `hermes`: new runtime and persistent profile state;
- `harness`: temporary rollback runtime;
- `harness-gateway`: temporary compatibility and MCP gateway, renamed only after migration stability is proven.

Hermes is reachable only on the private Compose network. The app exposes the authenticated same-origin proxy. The Hermes container receives a dedicated working directory and no broad NAS mount.

Local development starts the app, Hermes, and the required gateway without depending on the remote production gateway. Port selection remains configurable and loopback-only.

## Migration Stages

### Stage 1: Parallel Runtime

- Add Hermes configuration, container, health check, and persistent volumes.
- Connect Hermes to the existing MCP server with untrusted tool policy.
- Add a server-side Runs API client and focused contract tests.
- Keep `/assistant` on Harness by default and provide a server-controlled Hermes feature flag.

### Stage 2: Native Assistant Cutover

- Adapt the native assistant to Runs API events, approvals, cancellation, and history.
- Keep the existing knowledge upload UI.
- Make Hermes the default only after local browser acceptance passes.
- Preserve an operator-only rollback flag to return to Harness.

### Stage 3: NAS Acceptance

- Deploy Hermes alongside the current production services.
- Verify health, persistence across restart, tool approval, file processing, session recovery, and mobile/desktop behavior.
- Confirm existing non-assistant services and data volumes are unchanged.

### Stage 4: Harness Removal

Harness removal is a separate approved change. It may occur only after the Hermes default has remained stable through the agreed observation period and rollback evidence is no longer needed.

Removal includes obsolete iframe bootstrap, Harness-specific authentication, relay configuration, container definitions, tests, and dead UI components. Runtime-neutral MCP and knowledge code must not be removed.

## Verification

### Automated

- Runs API request, stream parsing, resume, cancel, and error contract tests;
- ownership checks for run, conversation, and approval operations;
- read-tool immediate execution and write-tool approval tests;
- approval rejection, replay, and cross-user denial tests;
- MCP discovery and all twenty tool schemas;
- idempotent write retry tests;
- knowledge upload and extractor regression tests;
- app and gateway typecheck, unit tests, and production builds;
- Compose configuration validation and Hermes health check.

### Browser

- new conversation and streamed response;
- refresh and conversation recovery;
- read tool call;
- approve and reject separate write calls;
- cancel a running response;
- direct image input;
- PDF, DOCX, XLSX, Markdown, text, and image knowledge uploads;
- desktop and mobile layout with no iframe or authentication loop;
- controlled fallback to Harness during the parallel stage.

### NAS

- Hermes profile and session state survive container restart;
- workspace and knowledge data remain owner-scoped and intact;
- app, knowledge worker, database, gateway, and unrelated container identities are not unintentionally replaced;
- no Hermes, MCP, Supabase, or model credential is exposed to the browser or public logs;
- source completion, local verification, deployment, and live browser verification are reported separately.

## Scope Boundaries

- Do not redesign unrelated workspace pages.
- Do not rewrite the knowledge pipeline around Hermes file handling.
- Do not grant Hermes direct database or NAS-root access.
- Do not delete Harness in the initial cutover.
- Do not change model providers unless required to prove the Hermes runtime path.
- Do not commit secrets, generated runtime state, uploaded documents, or private memories.
- Preserve unrelated user changes in both repositories.

## Acceptance Decision

The migration is complete only when Hermes is the verified default assistant runtime, all twenty workspace tools work through MCP with correct approval behavior, supported files remain usable through the knowledge pipeline, sessions survive refresh and restart, and the NAS deployment has been browser-verified. Harness removal is not implied by that completion and requires its own approval.
