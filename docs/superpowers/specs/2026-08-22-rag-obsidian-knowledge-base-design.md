# RAG and Obsidian Knowledge Base Design

## Product goal

Extend the native workbench assistant into a private knowledge companion that can:

- accept multiple PDF, DOCX, Markdown, text, and image files in chat;
- identify what each file contains and extract useful metadata;
- recommend a knowledge collection and related workbench actions;
- preserve the original file, normalized content, analysis, and generated items separately;
- answer later questions through source-grounded hybrid retrieval;
- use a dedicated Obsidian vault as the human-editable Markdown surface.

This remains a lightweight personal assistant. It does not become an autonomous research
agent, general document management platform, or multi-user collaboration system.

## Core decisions

1. Original binaries are immutable assets stored on the NAS.
2. Markdown notes in the dedicated Obsidian vault are the editable knowledge text.
3. PostgreSQL is the source of truth for identity, permissions, versions, relationships,
   ingestion state, chunks, embeddings, and retrieval metadata.
4. The assistant never permanently archives or creates derived workbench items without the
   user's confirmation.
5. All stored content is private to the authenticated owner in phase one.
6. RAG is retrieval-led: the model receives only selected chunks, never the entire library.
7. Obsidian is integrated through files, deep links, and a workbench connector plugin; the
   proprietary Obsidian application is not bundled into the web application.

## User experience

### File conversation

The composer gains a paperclip button and drag-and-drop target. A batch may contain up to 20
files, with a default per-file limit of 50 MB. Phase-one formats are:

- PDF
- DOCX
- Markdown and plain text
- PNG, JPEG, and WebP images with OCR

Each upload appears as a chat-native file card with stable dimensions and these states:

```text
uploading -> queued -> extracting -> analyzing -> ready
                                      \-> needs attention
                \-> failed
```

When analysis is ready, the assistant shows:

- detected document type and title;
- concise summary and key topics;
- important dates, people, projects, and action candidates;
- recommended knowledge collection and Obsidian path;
- proposed notes, todos, or calendar events;
- confidence or a clarification question when classification is uncertain.

The user can confirm all, select individual proposals, edit the destination, ask follow-up
questions, leave the item in the inbox, or delete it. Confirmation creates the selected
items and records their source relationship.

### Knowledge citations

Answers based on stored knowledge show compact citations that open the exact source:

- PDF page or extracted section;
- DOCX heading or paragraph anchor;
- Obsidian Markdown path and heading;
- original uploaded asset when no richer anchor exists.

The assistant must distinguish retrieved evidence from inference and must not claim a file
contains information that was not present in the retrieved chunks.

## System architecture

```text
Native Assistant / Knowledge UI
          |
          +-- Upload and confirmation APIs
          +-- Knowledge search and source APIs
          |
PostgreSQL job queue -------- Knowledge Worker
          |                         |
          |                         +-- file validation
          |                         +-- extraction and OCR
          |                         +-- normalization and chunking
          |                         +-- analysis and embeddings
          |
          +-- metadata, versions, chunks, vectors, relations

NAS private storage
  +-- original assets
  +-- temporary quarantine
  +-- dedicated Obsidian vault

Obsidian Workbench Connector
  +-- incremental Markdown and attachment sync
  +-- Obsidian deep links
  +-- assistant commands
```

The asynchronous worker is a separate process or container. It claims PostgreSQL jobs with
row locking, so phase one does not require Redis or another queue product. Upload requests
only validate, persist, and enqueue; extraction and model calls never hold the browser
request open.

## Storage layout

The NAS storage root is configurable and never exposed as a public static directory.

```text
knowledge/
  users/<user-id>/
    assets/<year>/<month>/<asset-id>/<safe-filename>
    quarantine/<job-id>/<safe-filename>
    vault/
      00_Inbox/
      10_Projects/
      20_Areas/
      30_Resources/
      90_Archive/
      _assets/
```

Downloads pass through an authenticated API that verifies ownership and supports byte
ranges. Paths are generated from server-owned identifiers; original filenames are display
metadata and are never concatenated into an unchecked filesystem path.

## Data model

### `knowledge_collections`

Represents destinations such as Cowart, AI Workbench, or a long-term subject area.

- `id`, `user_id`, `name`, `slug`, `description`
- `kind`: project, area, resource, archive
- `obsidian_path`
- timestamps

### `file_assets`

Represents the immutable original binary.

- `id`, `user_id`, `storage_key`, `original_name`
- `mime_type`, `size_bytes`, `sha256`
- `status`: quarantine, available, rejected, deleted
- timestamps

The owner and SHA-256 digest form the deduplication boundary. Duplicate uploads may create
a new document relationship without storing the same bytes again.

### `knowledge_documents`

Represents one logical document independently of file revisions.

- `id`, `user_id`, optional `collection_id`, optional `asset_id`
- `title`, `document_type`, `language`, `status`
- `canonical_kind`: extracted, markdown, external
- `obsidian_path`, `current_version_id`
- `summary`, `tags`, timestamps

### `document_versions`

Preserves extracted or edited content without overwriting prior knowledge.

- `id`, `document_id`, `version_number`
- `content_hash`, `normalized_text`
- extraction metadata and parser version
- source modification time and timestamps

### `document_chunks`

Stores retrieval units with stable source anchors.

- `id`, `document_id`, `version_id`, `chunk_index`
- `content`, `token_count`
- `heading_path`, page and character boundaries
- PostgreSQL full-text vector
- timestamps

Chunks target roughly 400-800 tokens with small overlap, but structural boundaries such as
headings, paragraphs, and pages take precedence over fixed length.

### `document_embeddings`

Separates embeddings from chunks so models can be replaced or re-indexed.

- `chunk_id`, `provider`, `model`, `dimensions`
- `embedding vector`
- `content_hash`, timestamps

The migration enables `pgvector` only after the target PostgreSQL image is verified to
provide the extension. Embedding generation is behind an `EmbeddingProvider` interface so
a hosted or local multilingual model can be selected later without changing retrieval APIs.

### `knowledge_relations`

Connects knowledge to other knowledge and to existing workbench records.

- `id`, `user_id`
- typed source and target identifiers
- `relation_type`: source_of, derived_from, related_to, mentions, supersedes
- optional evidence chunk and confidence
- creator: user, assistant, importer
- timestamps

### `ingestion_jobs`

- `id`, `user_id`, `asset_id`, optional `document_id`
- `job_type`, `status`, `attempt_count`, `available_at`
- stage progress, sanitized error code, timestamps
- idempotency key and worker lease information

Retries are bounded. A completed stage is not repeated when its content hash and parser or
model version still match.

### `obsidian_sync_state`

- owner, vault identifier, normalized relative path
- workbench document id, content hash, modification time
- last pull, last push, and conflict status

## Extraction and analysis pipeline

1. Validate declared type, detected MIME type, size, extension, and checksum.
2. Store the file in quarantine and create an ingestion job.
3. Extract text with a format-specific adapter.
4. Run OCR only for images or image-only PDF pages.
5. Normalize text while preserving page, heading, and paragraph anchors.
6. Create or update the logical document and version.
7. Produce chunks and PostgreSQL full-text data.
8. Ask the model for typed analysis: title, type, summary, topics, entities, dates,
   destination recommendation, and proposed workbench actions.
9. Generate embeddings asynchronously.
10. Move accepted bytes from quarantine to private asset storage and mark the analysis ready.

Analysis output is validated with Zod before persistence. Model-proposed destinations and
actions remain proposals until confirmed through the existing workbench action boundary.

## Retrieval design

The knowledge search service performs:

1. owner and collection filtering;
2. PostgreSQL full-text search;
3. vector similarity search when embeddings are available;
4. reciprocal-rank fusion of lexical and semantic candidates;
5. boosts for direct relations, source freshness, and current workspace;
6. optional reranking of the top candidates;
7. selection of a small evidence set with source anchors.

The first retrieval release may run full-text search before vector migration, but every
document is already versioned and chunked so pgvector can be added without reshaping the
ingestion API.

Harness-facing tools are intentionally small:

- `knowledge.search`
- `knowledge.get_source`
- `knowledge.list_inbox`
- `knowledge.propose_archive`
- `knowledge.confirm_archive`
- `knowledge.relate`

The native assistant uses these tools on demand. Search results are returned to Harness in
a bounded protocol block, and final responses cite the selected sources.

## Obsidian integration

### Dedicated vault

The workbench creates one dedicated `AI Knowledge Vault`. Existing personal vaults are not
silently indexed. A later importer can selectively copy or link chosen folders.

Generated Markdown uses stable frontmatter:

```yaml
---
workbench_id: <document-id>
collection: Cowart
document_type: reference
source_assets:
  - <asset-id>
updated_at: 2026-08-22T00:00:00Z
---
```

Folders express broad lifecycle and ownership. Fine classification remains in collections,
frontmatter, tags, and explicit relationships so files do not need constant manual moves.

### Connector phases

1. Workbench writes confirmed generated Markdown into the dedicated vault and provides an
   Obsidian deep link.
2. A private Workbench Connector plugin authenticates to a narrow sync API and incrementally
   reports Markdown and attachment changes by hash.
3. The plugin adds commands such as Send to Workbench, Ask Workbench Assistant, Extract
   Todos, and Show Source Relations.
4. Two-way sync uses optimistic versions. Concurrent changes create a visible conflict copy;
   neither side silently overwrites the other.

The plugin may be open sourced independently. No Obsidian application code is copied,
modified, or redistributed.

## Security and privacy

- Every metadata table uses RLS with `auth.uid() = user_id`.
- File APIs authenticate the owner server-side and never accept a caller-supplied user id.
- Original files and extracted text are private by default.
- Executable files and unsupported archives are rejected in phase one.
- Uploaded HTML is treated as text and never rendered with active content.
- Filenames, parser errors, and model outputs are escaped before display.
- Temporary files are deleted after completion, rejection, or an expiry window.
- Audit logs store operation metadata, not extracted document contents.
- Deleting a note does not delete its source asset; deleting an asset requires a separate
  explicit confirmation and reports affected relationships.

## Failure behavior

- Upload failure leaves no document record and removes incomplete temporary data.
- Extraction failure preserves the private asset and offers retry, replace, or delete.
- Analysis failure leaves extracted text searchable and can be retried independently.
- Embedding failure does not block lexical search or manual organization.
- Obsidian sync failure does not delete workbench content and shows the last synchronized
  version.
- If a business write succeeds but audit or status bookkeeping fails, the operation remains
  successful and is not automatically repeated.

## Delivery phases

### Phase 1: Knowledge foundation and inbox

- schema, private NAS asset API, upload cards, asynchronous extraction, analysis proposals;
- PDF, DOCX, Markdown, text, and image OCR;
- confirmation creates notes, todos, calendar events, and source relationships;
- full-text search and source preview.

### Phase 2: Dedicated Obsidian vault

- vault writer, stable frontmatter, deep links, inbox and collection paths;
- selective import of existing Markdown folders;
- conflict-safe version tracking.

### Phase 3: Hybrid RAG

- pgvector migration gate and embedding provider;
- hybrid retrieval, reranking, source citations, retrieval evaluation set;
- assistant tools for knowledge search and source opening.

### Phase 4: Obsidian connector plugin

- authenticated incremental two-way sync;
- Obsidian commands and source relation views;
- packaged separately from the workbench application.

### Phase 5: Knowledge graph and long-term memory

- reviewed entity and topic relationships;
- curated personal preferences and durable memory;
- cross-document questions and provenance-aware suggestions.

## Deferred work

- multi-user sharing and collaboration;
- audio and video transcription;
- arbitrary archive extraction;
- autonomous bulk reorganization;
- public links and external publishing;
- replacing Obsidian Sync or implementing a general filesystem synchronization product.

## Acceptance boundaries

Phase one is complete only when:

- a supported batch can be uploaded without blocking the chat request;
- every file shows a recoverable processing state;
- original bytes, extracted text, analysis, and derived items remain independently stored;
- the assistant recommends a destination and requires confirmation before permanent archive;
- confirmed notes, todos, and events retain a navigable source relationship;
- search returns owner-scoped source chunks with stable anchors;
- duplicate requests and worker retries do not duplicate assets or derived items;
- unit, integration, typecheck, production build, and desktop/mobile browser checks pass;
- no NAS migration, container rebuild, or production rollout is claimed without separate
  deployment verification.
