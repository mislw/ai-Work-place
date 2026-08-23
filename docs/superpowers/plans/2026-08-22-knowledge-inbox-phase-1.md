# Knowledge Inbox Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, asynchronous knowledge inbox that accepts supported files in the native assistant, extracts and analyzes them, recommends an archive destination, and creates confirmed workbench items with navigable source relationships.

**Architecture:** Next.js owns authenticated upload, status, source, search, and confirmation APIs. Files stream into a server-owned NAS-compatible storage root, while PostgreSQL stores owner-scoped metadata, versions, chunks, proposals, jobs, and relations. A separate TypeScript worker process claims PostgreSQL jobs, runs format adapters and OCR, calls the existing OpenAI-compatible provider for typed analysis, and leaves lexical search usable even when AI analysis is unavailable.

**Tech Stack:** Next.js 14 route handlers, React 18, TypeScript, Zod, Supabase/PostgreSQL with RLS and full-text search, Node filesystem streams, Busboy, `file-type`, PDF.js, Mammoth, Tesseract.js, `@napi-rs/canvas`, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-rag-obsidian-knowledge-base-design.md`

## Global Constraints

- Work only in the existing `D:\ai_WorkPlace\ai-Work-place` shared worktree.
- Do not revert unrelated local changes.
- Do not commit, push, migrate a live database, upload archives, enable NAS SSH, rebuild containers, or publish.
- Phase one supports PDF, DOCX, Markdown, plain text, PNG, JPEG, and WebP.
- Upload one file per HTTP request; the client may queue 20 files with at most two concurrent uploads.
- Reject files over 50 MB and unsupported or executable content.
- Original bytes, normalized text, analysis, proposals, and derived workbench items remain independently stored.
- Permanent archive and derived item creation require explicit user confirmation.
- All records are owner-scoped; no API accepts `user_id` from the browser or model.
- Do not add pgvector, Obsidian two-way sync, sharing, audio/video transcription, or autonomous bulk organization in this plan.
- Use Node-compatible dependency versions: `pdfjs-dist@4.10.38`, `file-type@20.5.0`, `mammoth@1.12.1`, `tesseract.js@7.0.0`, `@napi-rs/canvas@1.0.7`, `busboy@1.6.0`, `@types/busboy@1.5.4`, and `tsx@4.23.12`.
- Every production change follows a failing-test, minimal-implementation, passing-test cycle.

## File Structure

### Database and contracts

- Modify `supabase/init.sql`: knowledge tables, RLS, queue RPCs, lexical search RPC, and Realtime publication.
- Create `src/lib/knowledge/contracts.ts`: Zod schemas and shared DTO types.
- Create `src/lib/knowledge/config.ts`: size, concurrency, storage root, and worker configuration.
- Create `src/tests/knowledge-contracts.test.ts`.

### Storage and upload boundary

- Create `src/lib/knowledge/storage.ts`: safe storage keys, streaming writes, checksums, moves, reads, and deletion.
- Create `src/lib/knowledge/upload.ts`: Busboy parsing and MIME validation.
- Create `src/lib/knowledge/repository.ts`: user-scoped and service-role persistence helpers.
- Create `src/app/api/knowledge/uploads/route.ts`.
- Create `src/app/api/knowledge/assets/[id]/route.ts`.
- Create `src/tests/knowledge-storage.test.ts`.
- Create `src/tests/knowledge-upload-route.test.ts`.
- Create `src/tests/knowledge-asset-route.test.ts`.

### Worker and extraction

- Modify `package.json` and `package-lock.json`: parser, OCR, upload, and worker dependencies/scripts.
- Create `scripts/knowledge-worker.ts`: worker entry point.
- Create `src/lib/knowledge/job-repository.ts`: atomic job claim, progress, retry, and completion.
- Create `src/lib/knowledge/extractors/types.ts`.
- Create `src/lib/knowledge/extractors/text.ts`.
- Create `src/lib/knowledge/extractors/docx.ts`.
- Create `src/lib/knowledge/extractors/pdf.ts`.
- Create `src/lib/knowledge/extractors/image.ts`.
- Create `src/lib/knowledge/extractors/index.ts`.
- Create `src/lib/knowledge/chunks.ts`.
- Create `src/lib/knowledge/worker.ts`.
- Create `src/tests/knowledge-extractors.test.ts`.
- Create `src/tests/knowledge-worker.test.ts`.
- Create deterministic fixtures under `src/tests/fixtures/knowledge/`.

### Analysis, retrieval, and confirmation

- Create `src/lib/knowledge/analysis.ts`: typed analysis provider and prompt.
- Create `src/lib/knowledge/search.ts`: lexical search and source DTO mapping.
- Create `src/lib/knowledge/confirmation.ts`: idempotent proposal confirmation.
- Create `src/app/api/knowledge/inbox/route.ts`.
- Create `src/app/api/knowledge/items/[id]/route.ts`.
- Create `src/app/api/knowledge/search/route.ts`.
- Create `src/app/api/knowledge/confirm/route.ts`.
- Create `src/tests/knowledge-analysis.test.ts`.
- Create `src/tests/knowledge-inbox-route.test.ts`.
- Create `src/tests/knowledge-search-route.test.ts`.
- Create `src/tests/knowledge-confirm-route.test.ts`.

### Native assistant UI

- Modify `src/components/assistant/native-assistant.tsx`: attach the knowledge inbox components without adding parsing logic to the conversation component.
- Create `src/components/assistant/assistant-composer.tsx`: text composer and attachment trigger.
- Create `src/components/assistant/knowledge-upload-tray.tsx`: batch queue and concurrency.
- Create `src/components/assistant/knowledge-file-card.tsx`: stable progress, analysis, and proposal card.
- Create `src/hooks/use-knowledge-uploads.ts`: upload, polling, retry, and confirmation state machine.
- Create `src/tests/knowledge-upload-ui.test.tsx`.
- Modify `src/tests/native-assistant.test.tsx`.

---

### Task 1: Add Knowledge Contracts and Database Foundation

**Files:**
- Modify: `supabase/init.sql`
- Create: `src/lib/knowledge/contracts.ts`
- Create: `src/lib/knowledge/config.ts`
- Test: `src/tests/knowledge-contracts.test.ts`

**Interfaces:**
- Produces `knowledgeUploadResponseSchema`, `knowledgeItemSchema`, `knowledgeAnalysisSchema`, `knowledgeProposalSchema`, `knowledgeSearchResultSchema`, `SUPPORTED_KNOWLEDGE_MIME_TYPES`, `MAX_KNOWLEDGE_FILE_BYTES`, and `getKnowledgeConfig()`.
- Produces SQL RPCs `register_knowledge_upload`, `claim_ingestion_job`, `complete_ingestion_job`, `fail_ingestion_job`, and `search_knowledge_chunks`.

- [ ] **Step 1: Write failing contract tests**

```ts
it("accepts a ready knowledge item with independently stored analysis", () => {
  expect(
    knowledgeItemSchema.parse({
      id: "doc-1",
      assetId: "asset-1",
      title: "Harness 方案",
      status: "ready",
      stage: "complete",
      mimeType: "application/pdf",
      originalName: "harness.pdf",
      summary: "接入方案摘要",
      proposals: [],
    }),
  ).toEqual(expect.objectContaining({ id: "doc-1", status: "ready" }));
});

it("rejects unsupported MIME types and files over 50 MB", () => {
  expect(SUPPORTED_KNOWLEDGE_MIME_TYPES.has("application/x-msdownload")).toBe(false);
  expect(MAX_KNOWLEDGE_FILE_BYTES).toBe(50 * 1024 * 1024);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- --run src/tests/knowledge-contracts.test.ts`

Expected: FAIL because `@/lib/knowledge/contracts` does not exist.

- [ ] **Step 3: Implement the exact phase-one schemas**

```ts
export const knowledgeJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const knowledgeDocumentStatusSchema = z.enum([
  "extracting",
  "analyzing",
  "ready",
  "needs_attention",
  "failed",
]);

export const knowledgeProposalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["archive", "note", "todo", "calendar"]),
  title: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  status: z.enum(["pending", "confirmed", "rejected"]),
});
```

Add SQL tables with UUID primary keys, timestamps, owner foreign keys, RLS, and indexes:

```sql
knowledge_collections
file_assets
knowledge_documents
document_versions
document_chunks
knowledge_proposals
knowledge_relations
ingestion_jobs
```

`document_chunks` must include a generated `tsvector` or maintained search vector and a GIN
index. `ingestion_jobs` must include `lease_owner`, `lease_expires_at`, `attempt_count`, and
`idempotency_key`. `file_assets` must enforce uniqueness on `(user_id, sha256)` for active
assets.

- [ ] **Step 4: Add atomic upload and queue SQL functions**

`register_knowledge_upload` receives authenticated owner metadata, reuses an existing asset
with the same checksum when possible, creates one logical document and one queued job, and
returns all IDs. `claim_ingestion_job` uses `FOR UPDATE SKIP LOCKED` and is executable only by
`service_role`. Search RPCs always receive and enforce the authenticated owner id server-side.

- [ ] **Step 5: Run focused tests and SQL structure assertions**

Run: `npm test -- --run src/tests/knowledge-contracts.test.ts src/tests/schemas.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- supabase/init.sql src/lib/knowledge/contracts.ts src/lib/knowledge/config.ts src/tests/knowledge-contracts.test.ts`

Do not commit.

### Task 2: Implement Safe Private File Storage

**Files:**
- Create: `src/lib/knowledge/storage.ts`
- Create: `src/lib/knowledge/upload.ts`
- Test: `src/tests/knowledge-storage.test.ts`

**Interfaces:**
- Produces `KnowledgeStorage` with `writeQuarantine`, `promote`, `openRead`, `remove`, and `exists`.
- Produces `parseKnowledgeUpload(request, options): Promise<ParsedKnowledgeUpload>`.

- [ ] **Step 1: Write failing path and validation tests**

```ts
it("never derives a filesystem path from the original filename", async () => {
  const storage = new KnowledgeStorage(tempRoot);
  const result = await storage.writeQuarantine({
    ownerId: "owner-1",
    uploadId: "upload-1",
    originalName: "../../secret.txt",
    stream: Readable.from("hello"),
  });
  expect(result.absolutePath.startsWith(tempRoot)).toBe(true);
  expect(result.storageKey).not.toContain("..");
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
});
```

Also test the 50 MB limit, declared/detected MIME disagreement, unsupported executable
content, cleanup after partial writes, and deterministic promotion paths.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-storage.test.ts`

Expected: FAIL because the storage and upload modules do not exist.

- [ ] **Step 3: Implement streaming quarantine writes**

Use `pipeline`, a byte-counting transform, and `createHash("sha256")`. Generate storage keys
only from `ownerId`, `uploadId`, `assetId`, and a sanitized display extension. Write to a
temporary `.part` file and rename only after stream completion.

- [ ] **Step 4: Implement one-file multipart parsing**

Use Busboy with `files: 1`, `fileSize: MAX_KNOWLEDGE_FILE_BYTES`, and field count limits.
Read the first 4,100 bytes for `fileTypeFromBuffer`, then stream the entire file through the
storage writer. Accept extension fallback only for UTF-8 Markdown and text after a control
character check.

- [ ] **Step 5: Run storage tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-storage.test.ts`

Expected: PASS with no temporary files left after failure cases.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- src/lib/knowledge/storage.ts src/lib/knowledge/upload.ts src/tests/knowledge-storage.test.ts`

Do not commit.

### Task 3: Add Authenticated Upload and Asset APIs

**Files:**
- Create: `src/lib/knowledge/repository.ts`
- Create: `src/app/api/knowledge/uploads/route.ts`
- Create: `src/app/api/knowledge/assets/[id]/route.ts`
- Test: `src/tests/knowledge-upload-route.test.ts`
- Test: `src/tests/knowledge-asset-route.test.ts`

**Interfaces:**
- Consumes `parseKnowledgeUpload`, `KnowledgeStorage`, `register_knowledge_upload`, and `getAssistantOwner`.
- Produces `POST /api/knowledge/uploads`, `GET /api/knowledge/assets/:id`, and `DELETE /api/knowledge/assets/:id`.

- [ ] **Step 1: Write failing route tests**

Assert:

```ts
expect(unauthenticated.status).toBe(401);
expect(unsupported.status).toBe(415);
expect(oversized.status).toBe(413);
expect(created.status).toBe(201);
expect(await created.json()).toEqual({
  assetId: "asset-1",
  documentId: "document-1",
  jobId: "job-1",
  status: "queued",
});
```

Asset tests must verify owner lookup, byte-range responses, private cache headers, and explicit
delete confirmation when relations exist.

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-upload-route.test.ts src/tests/knowledge-asset-route.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement upload registration and cleanup**

The route authenticates with `getAssistantOwner`, streams to quarantine, calls the upload RPC,
and removes the quarantined file if database registration fails. Return only DTO fields; do
not return absolute paths or service credentials.

- [ ] **Step 4: Implement private source streaming**

Resolve assets through an owner-scoped query. Support `Range: bytes=start-end`, return
`Accept-Ranges: bytes`, `Content-Disposition: inline; filename*=UTF-8''...`, and
`Cache-Control: private, no-store`.

- [ ] **Step 5: Run route tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-upload-route.test.ts src/tests/knowledge-asset-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Run: `npm run typecheck`

Do not commit.

### Task 4: Build Extraction Adapters and Chunking

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/knowledge/extractors/types.ts`
- Create: `src/lib/knowledge/extractors/text.ts`
- Create: `src/lib/knowledge/extractors/docx.ts`
- Create: `src/lib/knowledge/extractors/pdf.ts`
- Create: `src/lib/knowledge/extractors/image.ts`
- Create: `src/lib/knowledge/extractors/index.ts`
- Create: `src/lib/knowledge/chunks.ts`
- Create: `src/tests/knowledge-extractors.test.ts`
- Create: `src/tests/fixtures/knowledge/*`

**Interfaces:**
- Produces `extractKnowledgeFile(input): Promise<ExtractedDocument>`.
- Produces `chunkExtractedDocument(document): KnowledgeChunkDraft[]`.

- [ ] **Step 1: Install pinned compatible dependencies**

Run:

```powershell
npm install pdfjs-dist@4.10.38 file-type@20.5.0 mammoth@1.12.1 tesseract.js@7.0.0 @napi-rs/canvas@1.0.7 busboy@1.6.0 tsx@4.23.12
npm install --save-dev @types/busboy@1.5.4
```

- [ ] **Step 2: Add deterministic extractor fixtures and failing tests**

Tests must assert exact phrases and anchors from:

- UTF-8 `.txt` and `.md` fixtures;
- one DOCX with two headings;
- one two-page text PDF;
- one PNG containing Chinese and English text;
- one image-only PDF page rendered through `@napi-rs/canvas` and OCR.

Chunk tests must ensure headings and pages remain intact where possible, every chunk has a
stable `chunkIndex`, and no chunk exceeds the configured hard character cap.

- [ ] **Step 3: Run extractor tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-extractors.test.ts`

Expected: FAIL because extractor modules do not exist.

- [ ] **Step 4: Implement format adapters**

Use these result types:

```ts
export interface ExtractedBlock {
  text: string;
  page?: number;
  headingPath?: string[];
}

export interface ExtractedDocument {
  titleHint?: string;
  languageHint?: string;
  blocks: ExtractedBlock[];
  parser: string;
  parserVersion: string;
  warnings: string[];
}
```

PDF.js extracts text first and renders only pages without useful text for OCR. Mammoth uses
plain-text output plus heading style mapping. Tesseract language is configurable and defaults
to `chi_sim+eng`.

- [ ] **Step 5: Implement structural chunking**

Accumulate blocks up to a 3,200-character target, split oversized paragraphs at sentence
boundaries, and overlap only the last paragraph or 400 characters. Preserve page range,
heading path, and character offsets.

- [ ] **Step 6: Run extractor tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-extractors.test.ts`

Expected: PASS for all supported formats and OCR fallback.

- [ ] **Step 7: Review checkpoint**

Run: `npm run typecheck`

Do not commit.

### Task 5: Implement the PostgreSQL-Backed Worker

**Files:**
- Modify: `package.json`
- Create: `scripts/knowledge-worker.ts`
- Create: `src/lib/knowledge/job-repository.ts`
- Create: `src/lib/knowledge/worker.ts`
- Test: `src/tests/knowledge-worker.test.ts`

**Interfaces:**
- Consumes service-role Supabase, `KnowledgeStorage`, extraction adapters, chunking, and analysis.
- Produces `processKnowledgeJob(job, dependencies)` and `runKnowledgeWorker(options)`.

- [ ] **Step 1: Write failing worker state-machine tests**

Test exact transitions:

```text
queued -> processing/extracting -> processing/chunking
       -> processing/analyzing -> completed/complete
```

Also assert bounded retry, stale lease recovery, extraction-only completion when AI is not
configured, and no duplicate versions/chunks when the same job is delivered twice.

- [ ] **Step 2: Run worker tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-worker.test.ts`

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement job claim and heartbeat repository**

Use the SQL claim RPC, assign a random worker id, renew leases between expensive stages, and
mark errors with stable codes such as `EXTRACT_FAILED`, `OCR_FAILED`, and `ANALYSIS_FAILED`.
Never persist stack traces or extracted content in the error column.

- [ ] **Step 4: Implement idempotent processing**

Before each stage, compare content hash, parser version, analysis version, and existing stage
records. Insert document versions and chunks using unique keys, then promote the asset from
quarantine only after extraction succeeds.

- [ ] **Step 5: Add the worker script**

Add:

```json
"knowledge:worker": "tsx scripts/knowledge-worker.ts"
```

The script handles `SIGINT` and `SIGTERM`, polls with an abortable delay, and exits non-zero
only for configuration failure or an unrecoverable worker loop error.

- [ ] **Step 6: Run worker tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-worker.test.ts`

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Run: `npm run typecheck`

Do not commit or start a production worker.

### Task 6: Add Typed Analysis and Proposals

**Files:**
- Create: `src/lib/knowledge/analysis.ts`
- Modify: `src/lib/knowledge/worker.ts`
- Test: `src/tests/knowledge-analysis.test.ts`

**Interfaces:**
- Produces `analyzeKnowledgeDocument(input, provider): Promise<KnowledgeAnalysis>`.
- Persists archive, note, todo, and calendar proposals without executing them.

- [ ] **Step 1: Write failing typed-analysis tests**

```ts
expect(result).toEqual({
  documentType: "meeting_notes",
  title: "Cowart UI 讨论",
  summary: expect.any(String),
  topics: ["Cowart", "UI"],
  suggestedCollection: "Cowart",
  proposals: expect.arrayContaining([
    expect.objectContaining({ kind: "todo", status: "pending" }),
  ]),
});
```

Malformed JSON must produce `needs_attention`, not erase extracted text or retry forever.

- [ ] **Step 2: Run analysis tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-analysis.test.ts`

Expected: FAIL because the analyzer does not exist.

- [ ] **Step 3: Implement bounded analysis input**

Send document metadata plus a maximum of 30,000 normalized characters, prioritizing the
first section and representative later chunks. Require strict JSON matching
`knowledgeAnalysisSchema`. The prompt must explicitly forbid claiming actions were executed.

- [ ] **Step 4: Integrate graceful degradation**

When `getProvider()` returns null, finish extraction and lexical indexing with document status
`needs_attention` and error code `AI_NOT_CONFIGURED`. Retrying analysis must not repeat
extraction.

- [ ] **Step 5: Run analysis and worker tests**

Run: `npm test -- --run src/tests/knowledge-analysis.test.ts src/tests/knowledge-worker.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- src/lib/knowledge/analysis.ts src/lib/knowledge/worker.ts src/tests/knowledge-analysis.test.ts`

Do not commit.

### Task 7: Add Inbox, Search, Source, and Confirmation APIs

**Files:**
- Create: `src/lib/knowledge/search.ts`
- Create: `src/lib/knowledge/confirmation.ts`
- Create: `src/app/api/knowledge/inbox/route.ts`
- Create: `src/app/api/knowledge/items/[id]/route.ts`
- Create: `src/app/api/knowledge/search/route.ts`
- Create: `src/app/api/knowledge/confirm/route.ts`
- Test: `src/tests/knowledge-inbox-route.test.ts`
- Test: `src/tests/knowledge-search-route.test.ts`
- Test: `src/tests/knowledge-confirm-route.test.ts`

**Interfaces:**
- Produces owner-scoped inbox polling, detail/source metadata, lexical search, and idempotent confirmation.
- Consumes `executeIdempotentWorkbenchAction` for note, todo, and calendar proposals.

- [ ] **Step 1: Write failing API tests**

Inbox tests verify stage progress and sanitized errors. Search tests verify owner filter,
collection filter, ranked snippets, and anchors. Confirmation tests verify:

```ts
expect(executeIdempotentWorkbenchAction).toHaveBeenCalledWith(
  "owner-1",
  expectedAction,
  `knowledge:${proposalId}`,
);
expect(createRelation).toHaveBeenCalledWith(
  expect.objectContaining({ relationType: "source_of" }),
);
```

Replaying the same confirmation returns the previous result without duplicate workbench rows.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-inbox-route.test.ts src/tests/knowledge-search-route.test.ts src/tests/knowledge-confirm-route.test.ts`

Expected: FAIL because the APIs do not exist.

- [ ] **Step 3: Implement inbox and item endpoints**

Use `getAssistantOwner`, route-client RLS queries, Zod response parsing, `no-store`, and stable
error codes. Item detail returns analysis and proposals but never the entire extracted text by
default.

- [ ] **Step 4: Implement lexical search**

Call `search_knowledge_chunks` with query, optional collection, and a hard result limit of 20.
Return title, snippet, document id, chunk id, page, heading path, and asset URL.

- [ ] **Step 5: Implement confirmation transaction boundary**

Claim a pending proposal with a receipt, execute the matching workbench action, create the
source relation, and mark the proposal confirmed. A committed workbench action must not be
reported as failed if relation bookkeeping fails; retain a repairable receipt instead.

- [ ] **Step 6: Run API tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-inbox-route.test.ts src/tests/knowledge-search-route.test.ts src/tests/knowledge-confirm-route.test.ts`

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Run: `npm run typecheck`

Do not commit.

### Task 8: Add Native Assistant Upload and Analysis Interaction

**Files:**
- Modify: `src/components/assistant/native-assistant.tsx`
- Create: `src/components/assistant/assistant-composer.tsx`
- Create: `src/components/assistant/knowledge-upload-tray.tsx`
- Create: `src/components/assistant/knowledge-file-card.tsx`
- Create: `src/hooks/use-knowledge-uploads.ts`
- Create: `src/tests/knowledge-upload-ui.test.tsx`
- Modify: `src/tests/native-assistant.test.tsx`

**Interfaces:**
- Consumes knowledge upload, inbox polling, item detail, retry, delete, and confirmation APIs.
- Produces paperclip and drag/drop upload, bounded concurrency, file cards, proposal editing, and confirmation.

- [ ] **Step 1: Write failing UI tests**

Tests verify:

- paperclip button uses an icon and accessible label;
- hidden file input accepts only phase-one formats and supports multiple selection;
- dropping three files starts no more than two upload requests concurrently;
- status transitions do not resize the card container;
- ready cards show summary, destination, and individual proposal checkboxes;
- confirmation sends only selected proposal ids;
- retry and delete operate on the correct item;
- mobile width 390 has no horizontal overflow.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- --run src/tests/knowledge-upload-ui.test.tsx src/tests/native-assistant.test.tsx`

Expected: FAIL because upload UI components do not exist.

- [ ] **Step 3: Extract the existing composer without changing chat behavior**

Move textarea, send, stop, error, and attachment trigger rendering into
`AssistantComposer`. Preserve current keyboard behavior and the per-session running state.

- [ ] **Step 4: Implement the upload state machine**

`useKnowledgeUploads` owns local ids and states:

```ts
type UploadState =
  | "waiting"
  | "uploading"
  | "queued"
  | "extracting"
  | "analyzing"
  | "ready"
  | "needs_attention"
  | "failed";
```

Upload one file per request, poll active items with exponential backoff capped at five
seconds, stop polling terminal items, and cancel timers on unmount.

- [ ] **Step 5: Implement file and proposal cards**

Use icons for file type and commands, a compact progress line, readable summary, destination
selector, and checkboxes for proposed note/todo/calendar actions. Keep card radius at 8px or
less and avoid nested cards.

- [ ] **Step 6: Integrate cards with the conversation**

Uploaded items appear above the composer while processing and as assistant-side source cards
once ready. A confirmed result appends a concise local system event and refreshes the relevant
workbench store without placing raw protocol JSON in chat.

- [ ] **Step 7: Run UI tests and verify GREEN**

Run: `npm test -- --run src/tests/knowledge-upload-ui.test.tsx src/tests/native-assistant.test.tsx`

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Run: `npm run typecheck`

Do not commit.

### Task 9: Complete Local Verification and Document the Deployment Boundary

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-22-rag-obsidian-knowledge-base-design.md` only if implementation discovers a necessary clarified constraint.

**Interfaces:**
- Documents `KNOWLEDGE_STORAGE_ROOT`, `KNOWLEDGE_MAX_FILE_BYTES`, `KNOWLEDGE_OCR_LANGUAGES`, worker polling, and service-role requirements.

- [ ] **Step 1: Add non-secret environment documentation**

```dotenv
KNOWLEDGE_STORAGE_ROOT=/data/knowledge
KNOWLEDGE_MAX_FILE_BYTES=52428800
KNOWLEDGE_OCR_LANGUAGES=chi_sim+eng
KNOWLEDGE_WORKER_POLL_MS=1500
```

Document that `SUPABASE_SERVICE_ROLE_KEY` is worker/server-only and must never use a
`NEXT_PUBLIC_` prefix.

- [ ] **Step 2: Run all automated gates with dev stopped**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0. Do not treat an interactive ESLint initializer as a completed
lint run if the repository still has no ESLint configuration.

- [ ] **Step 3: Run local worker integration with temporary storage**

Use a temporary `KNOWLEDGE_STORAGE_ROOT`, a test Supabase schema or mocked repository, and one
fixture from every supported format. Verify extraction, job completion, duplicate delivery,
and cleanup without touching NAS storage.

- [ ] **Step 4: Start a clean local preview and verify desktop**

Verify `/assistant` renders the native chat, paperclip control, multi-file queue, progress
cards, ready analysis, confirmation controls, source opening, no visible Harness UI iframe,
and no horizontal overflow.

- [ ] **Step 5: Verify 390 x 844 mobile layout**

Confirm the heading does not overlap navigation, file names wrap or truncate inside the card,
buttons remain reachable, and `scrollWidth === clientWidth`.

- [ ] **Step 6: Final scope audit**

Run:

```powershell
git diff --check
git status --short
```

Separate knowledge-inbox files from unrelated existing worktree changes. Report clearly:

- locally implemented;
- automated tests passed;
- browser verified;
- SQL migration not applied;
- NAS worker/storage not deployed;
- Obsidian connector and pgvector RAG not implemented in phase one.

Do not commit, push, or deploy.

## Follow-On Plans

After Phase 1 is locally accepted, create separate implementation plans for:

1. dedicated Obsidian vault writer, selective import, and conflict-safe connector plugin;
2. pgvector migration, embedding provider, hybrid retrieval, reranking, and citation evals;
3. reviewed knowledge graph and curated long-term memory.
