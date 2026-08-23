# Native Workbench Assistant Implementation Plan

## Scope

Implement the first local-only native assistant loop. Do not deploy to NAS and do not modify
the external DeepSeek Harness repository.

## 1. Contracts and tests

- Add Harness RPC and session-event parsers.
- Add compact context construction and context stripping.
- Add the Workbench Action schema and server-side confirmation policy.
- Write focused tests first and verify expected failures.

## 2. Server adapter

- Add owner-authenticated server-side Harness bootstrap exchange.
- Add typed RPC proxy endpoint.
- Add the official browser WebSocket mux downlink after hidden iframe bootstrap.
- Preserve the existing `/api/harness/bootstrap` iframe endpoint.

## 3. Workbench actions

- Add one authenticated action route backed by the current Supabase user and RLS.
- Implement list/create/update/complete/delete for calendar, todos, notes, and documents.
- Reject confirmation-required actions unless `confirmed: true` is present.

## 4. Native UI

- Replace the default iframe page with a native conversation surface.
- Add session persistence, history loading, prompt submission, cancellation, and streaming.
- Add action proposal/result/confirmation cards.
- Keep the iframe behind an Advanced Harness dialog or explicit query mode.

## 5. Verification

- Run focused tests after each red/green cycle.
- Run the full Vitest suite, `npm run typecheck`, and `npm run build`.
- Start a local server on a free port.
- Verify desktop and 390px mobile layouts, message streaming, empty/error states, and no
  horizontal overflow in the in-app browser.
