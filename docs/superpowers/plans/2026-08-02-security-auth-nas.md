# Security, Authentication, and NAS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure the application, make Supabase login sessions work reliably, and provide a production Docker deployment for a single-instance NAS.

**Architecture:** Keep Supabase as the managed authentication/database service and run only a standalone Next.js container on the NAS. Put pure validation and rate-limit behavior in small testable modules, keep middleware responsible for session refresh and routing, and remove the unmaintained PWA build chain.

**Tech Stack:** Next.js 15.5.22, React 19, TypeScript, Vitest, Supabase SSR, Docker Compose, GitHub Actions

## Global Constraints

- NAS runs one application instance behind an HTTPS reverse proxy.
- Supabase remains externally managed; do not self-host Supabase in this change.
- AI limit is 10 accepted requests per user per 60-second fixed window.
- Secrets are injected at runtime and are never copied into an image or committed.
- Preserve all existing application routes and business behavior outside the approved security scope.

---

### Task 1: Safe Authentication Redirects and SSR Session Middleware

**Files:**
- Create: `src/lib/auth/redirect.ts`
- Create: `src/tests/auth-redirect.test.ts`
- Modify: `src/app/(auth)/login/login-form.tsx:26-57`
- Modify: `middleware.ts:1-36`
- Modify: `src/lib/supabase/middleware.ts:7-32`

**Interfaces:**
- Produces: `safeNextPath(value: string | null, fallback?: string): string`
- Consumes: `createMiddlewareClient(request)` returning a Supabase client and mutable Next response.

- [ ] **Step 1: Write failing redirect tests**

```ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps an internal absolute path", () => {
    expect(safeNextPath("/notes/123?tab=edit")).toBe("/notes/123?tab=edit");
  });
  it.each([null, "", "//evil.example", "https://evil.example", "javascript:alert(1)", "/\\evil"])(
    "falls back for unsafe value %s",
    (value) => expect(safeNextPath(value)).toBe("/workspace"),
  );
});
```

- [ ] **Step 2: Run `npm run test -- src/tests/auth-redirect.test.ts` and confirm module-not-found failure**

- [ ] **Step 3: Implement `safeNextPath` and replace the raw `next` query usage**

```ts
export function safeNextPath(value: string | null, fallback = "/workspace"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
```

- [ ] **Step 4: Make root middleware async, call `supabase.auth.getUser()`, preserve refreshed cookies on redirects, and route based on the verified user**

- [ ] **Step 5: Run the redirect test and existing authentication-adjacent tests**

- [ ] **Step 6: Commit `fix: secure login redirects and refresh sessions`**

### Task 2: AI Input Boundaries and User Rate Limiting

**Files:**
- Create: `src/lib/ai/rate-limit.ts`
- Create: `src/tests/rate-limit.test.ts`
- Modify: `src/lib/schemas.ts:87-102`
- Modify: `src/tests/schemas.test.ts`
- Modify: `src/lib/ai/prompts.ts:47-60`
- Modify: `src/app/api/ai/route.ts:13-50`

**Interfaces:**
- Produces: `checkRateLimit(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number }`
- Produces: action-specific validated AI context with bounded text and arrays.

- [ ] **Step 1: Write failing fixed-window rate-limit tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/ai/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(resetRateLimits);
  it("rejects the eleventh request in one minute", () => {
    for (let i = 0; i < 10; i++) expect(checkRateLimit("user", 1000).allowed).toBe(true);
    expect(checkRateLimit("user", 1000)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
  it("opens a new window after sixty seconds", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("user", 1000);
    expect(checkRateLimit("user", 61000).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test and confirm missing-module failure**

- [ ] **Step 3: Implement the smallest in-memory fixed-window limiter with cleanup and test reset**

- [ ] **Step 4: Add failing schema tests that reject unknown context fields, oversized arrays/text, and injected `messages`**

- [ ] **Step 5: Replace the generic `z.record(z.unknown())` with a discriminated union covering all nine actions**

- [ ] **Step 6: Remove `context.messages` spreading from prompts and insert the limiter before the provider call; return 429 with `Retry-After`**

- [ ] **Step 7: Run all AI, schema, and limiter tests**

- [ ] **Step 8: Commit `fix: bound and rate limit AI requests`**

### Task 3: Database Error Propagation

**Files:**
- Create: `src/lib/supabase/result.ts`
- Create: `src/tests/supabase-result.test.ts`
- Modify: `src/app/api/user-settings/route.ts:11-48`
- Modify: `src/app/api/ai/route.ts:34-44`
- Modify: `src/lib/data/documents.ts:62-69`

**Interfaces:**
- Produces: `throwIfSupabaseError(error: { message: string } | null, operation: string): void`

- [ ] **Step 1: Write a failing test proving null succeeds and a Supabase error throws a sanitized operation error**

```ts
import { expect, it } from "vitest";
import { throwIfSupabaseError } from "@/lib/supabase/result";

it("throws when Supabase reports a failed operation", () => {
  expect(() => throwIfSupabaseError({ message: "database unavailable" }, "save settings"))
    .toThrow("save settings failed");
});
```

- [ ] **Step 2: Run the test and confirm missing-module failure**

- [ ] **Step 3: Implement the helper, check settings GET/POST and document update errors, and keep AI audit-log failure non-fatal but logged**

- [ ] **Step 4: Run focused and full tests**

- [ ] **Step 5: Commit `fix: propagate Supabase write failures`**

### Task 4: Supported Dependencies and CI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`
- Delete: `public/sw.js`
- Delete: `public/workbox-8d583d63.js`
- Create: `eslint.config.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Build output: Next.js standalone server under `.next/standalone`.

- [ ] **Step 1: Upgrade Next.js and eslint config to 15.5.22, React/React DOM and types to React 19-compatible releases, remove `next-pwa`, and regenerate the lockfile**

- [ ] **Step 2: Replace `next lint` with ESLint CLI and add a flat config compatible with Next.js 15**

- [ ] **Step 3: Remove generated service-worker artifacts, ignore future generated files, and set `output: "standalone"`**

- [ ] **Step 4: Add CI using Node 22 with install, typecheck, lint, test, build, and `npm audit --omit=dev --audit-level=high` steps**

- [ ] **Step 5: Run install, audit, typecheck, lint, test, and build; correct migration issues without suppressing checks**

- [ ] **Step 6: Commit `build: upgrade Next and add CI`**

### Task 5: NAS Container Deployment and Documentation

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Exposes: container port `3000`; health endpoint `/api/health`.
- Consumes: `.env` runtime configuration and `NEXT_PUBLIC_*` build arguments.

- [ ] **Step 1: Add a Node 22 Alpine multi-stage Dockerfile that installs with `npm ci`, builds standalone output, copies static/public assets, runs as non-root, and defines a health check**

- [ ] **Step 2: Add Compose configuration with build args for public Supabase values, runtime env injection, restart policy, port mapping `${APP_PORT:-3000}:3000`, and health check**

- [ ] **Step 3: Exclude secrets, Git state, local build output, and tests from the Docker build context**

- [ ] **Step 4: Document NAS setup, Supabase Site URL/Redirect URL configuration, reverse-proxy HTTPS, first registration/login, upgrades, logs, and rollback**

- [ ] **Step 5: Run `docker compose config`, build the image, start it with placeholder-safe configuration where possible, and verify `/api/health`**

- [ ] **Step 6: Run the full verification suite and inspect `git diff --check` plus `git status`**

- [ ] **Step 7: Commit `feat: add NAS Docker deployment`**
