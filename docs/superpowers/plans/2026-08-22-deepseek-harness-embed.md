# DeepSeek Harness Phase One Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready `/assistant` page that embeds the complete DeepSeek Harness Web UI behind the AI Workspace login, with authenticated HTTP/WebSocket proxying, persistent NAS storage, and container/network isolation.

**Architecture:** The Next.js app mints a one-minute HS256 bootstrap JWT for the authenticated owner. A dedicated Node gateway exchanges it once for a short-lived HttpOnly session cookie, then proxies the Harness Web UI, `/api` RPC calls, and WebSockets. Harness runs from the current `F:\deepseek-harness` source snapshot on a private Docker network; an internal LLM relay holds the real provider key so model-facing tools cannot read it from the Harness process.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, `jose`, Node.js 22.19, `http-proxy`, DeepSeek Harness `0.1.0-rc.5`, Docker Compose, Caddy, Cloudflare Tunnel.

**Spec:** `docs/superpowers/specs/2026-08-22-deepseek-harness-embed-design.md`

## Global Constraints

- Keep `F:\deepseek-harness` at the currently inspected `0.1.0-rc.5` source snapshot; do not update dependencies or discard its uncommitted Oasis UI work.
- Keep AI Workspace authentication mandatory. Production must never use the hard-coded preview user.
- Use `https://agent.mislw.cn` for the Harness iframe; do not mount Harness below the Next.js `/api` or pathname space.
- Do not publish Harness port `3080`, the gateway port, or the LLM relay port on the NAS host.
- Harness receives no Supabase keys, Docker Socket, Compose directory, NAS root, or real DeepSeek API key.
- Harness may read and write only its persistent home and the explicitly mounted `/workspace`.
- Preserve all pre-existing uncommitted changes. Stage only new files or exact owned hunks; do not commit unrelated user work.
- Do not put real secrets in Git, Docker build arguments, logs, snapshots, screenshots, or this plan.
- Stage two AI Workspace business tools is excluded from this plan and receives its own plan after phase one passes runtime acceptance.

---

### Task 1: Secure the App Authentication Boundary

**Files:**
- Create: `src/lib/auth/preview.ts`
- Modify: `middleware.ts`
- Modify: `src/hooks/use-auth.ts`
- Modify: `src/lib/supabase/guards.ts`
- Create: `src/tests/require-user-auth.test.ts`
- Create: `src/tests/auth-preview-boundary.test.tsx`
- Modify: `.env.example`

**Interfaces:**
- Produces: `isPreviewAuthEnabled(): boolean`
- Produces: `requireUser(): Promise<{ user: User; supabase: SupabaseClient | null }>`
- Constraint: every server, middleware and client preview bypass is allowed only when `NODE_ENV !== "production"` and `NEXT_PUBLIC_ENABLE_AUTH_PREVIEW === "true"`.

- [ ] **Step 1: Write the failing production-bypass test**

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("requireUser preview boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("refuses preview auth in production even when the flag is true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    const { isPreviewAuthEnabled } = await import("@/lib/auth/preview");
    expect(isPreviewAuthEnabled()).toBe(false);
  });

  it("allows the explicit preview user only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    const { isPreviewAuthEnabled } = await import("@/lib/auth/preview");
    expect(isPreviewAuthEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing middleware and client-hook tests**

`auth-preview-boundary.test.tsx` must:

- set `NODE_ENV=production` and `NEXT_PUBLIC_ENABLE_AUTH_PREVIEW=true`;
- assert an unauthenticated `/workspace` request is redirected to `/login`, proving middleware does not bypass;
- render `useAuth()` with Supabase browser config mocked unavailable and assert `user=null`, `configured=false`, proving the client does not return the preview user;
- set `NODE_ENV=development` and assert `useAuth()` returns the preview user without calling `createClient()`.

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `npm test -- --run src/tests/require-user-auth.test.ts src/tests/auth-preview-boundary.test.tsx`

Expected: FAIL because the shared helper does not exist and middleware/client preview auth is hard-coded on.

- [ ] **Step 4: Replace all hard-coded preview switches**

`src/lib/auth/preview.ts`:

```ts
export function isPreviewAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ENABLE_AUTH_PREVIEW === "true"
  );
}
```

`middleware.ts` and `src/lib/supabase/guards.ts` import this helper and replace their hard-coded constants. Registration remains disabled before the preview branch.

`src/hooks/use-auth.ts` must call all React hooks unconditionally. Compute `previewEnabled` first, let the effect return early when it is true, and return the fixed preview state only after `useState`/`useEffect` have been called:

```ts
const previewEnabled = isPreviewAuthEnabled();
const browserConfigured = isSupabaseBrowserConfigured();
// Declare state and effect here; the effect does nothing when previewEnabled.
if (previewEnabled) {
  return { user: PREVIEW_USER, loading: false, error: null, configured: true };
}
```

Add to `.env.example`:

```dotenv
# Local visual preview only. It is ignored in production.
NEXT_PUBLIC_ENABLE_AUTH_PREVIEW=false
```

- [ ] **Step 5: Run auth tests and typecheck**

Run:

```bash
npm test -- --run src/tests/require-user-auth.test.ts src/tests/auth-preview-boundary.test.tsx src/tests/auth-login-route.test.ts src/tests/registration-disabled.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Record the change without capturing unrelated dirty hunks**

`middleware.ts`, `src/hooks/use-auth.ts`, `src/lib/supabase/guards.ts` and `.env.example` already contain user changes. Leave the task uncommitted and record the exact owned hunks in the execution ledger; do not stage whole files.


### Task 2: Define and Test the Bootstrap JWT Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/harness/config.ts`
- Create: `src/lib/harness/bootstrap-token.ts`
- Create: `src/tests/harness-bootstrap-token.test.ts`

**Interfaces:**
- Produces: `getHarnessConfig(): { publicOrigin: string; secret: Uint8Array; ownerUserId: string }`
- Produces: `signHarnessBootstrapToken(userId: string, now?: Date): Promise<string>`
- JWT claims: `aud="harness-bootstrap"`, `sub=<owner user id>`, `jti=<random UUID>`, `iat`, `exp=iat+60`.

- [ ] **Step 1: Add the JWT dependency**

Run: `npm install jose@^6.1.0`

Expected: `package.json` and `package-lock.json` contain `jose`.

- [ ] **Step 2: Write failing config and JWT tests**

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";

describe("Harness bootstrap token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HARNESS_EMBED_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("HARNESS_OWNER_USER_ID", "owner-1");
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "https://agent.mislw.cn");
  });

  it("mints a one-minute owner-scoped token", async () => {
    const { signHarnessBootstrapToken } = await import(
      "@/lib/harness/bootstrap-token"
    );
    const token = await signHarnessBootstrapToken(
      "owner-1",
      new Date("2026-08-22T00:00:00.000Z"),
    );
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
      { audience: "harness-bootstrap" },
    );
    expect(verified.payload.sub).toBe("owner-1");
    expect(verified.payload.exp! - verified.payload.iat!).toBe(60);
    expect(verified.payload.jti).toEqual(expect.any(String));
  });

  it("rejects a non-owner user", async () => {
    const { signHarnessBootstrapToken } = await import(
      "@/lib/harness/bootstrap-token"
    );
    await expect(signHarnessBootstrapToken("other-user")).rejects.toThrow(
      "Harness owner mismatch",
    );
  });
});
```

- [ ] **Step 3: Run the tests and verify failure**

Run: `npm test -- --run src/tests/harness-bootstrap-token.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement strict configuration**

```ts
const MIN_SECRET_BYTES = 32;

export function getHarnessConfig() {
  const publicOrigin = process.env.NEXT_PUBLIC_HARNESS_ORIGIN;
  const rawSecret = process.env.HARNESS_EMBED_SECRET;
  const ownerUserId = process.env.HARNESS_OWNER_USER_ID;
  if (!publicOrigin || new URL(publicOrigin).protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_HARNESS_ORIGIN must be an HTTPS origin");
  }
  if (!rawSecret || new TextEncoder().encode(rawSecret).length < MIN_SECRET_BYTES) {
    throw new Error("HARNESS_EMBED_SECRET must be at least 32 bytes");
  }
  if (!ownerUserId) throw new Error("HARNESS_OWNER_USER_ID is required");
  return {
    publicOrigin: new URL(publicOrigin).origin,
    secret: new TextEncoder().encode(rawSecret),
    ownerUserId,
  };
}
```

- [ ] **Step 5: Implement token signing**

```ts
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getHarnessConfig } from "./config";

export async function signHarnessBootstrapToken(
  userId: string,
  now = new Date(),
): Promise<string> {
  const config = getHarnessConfig();
  if (userId !== config.ownerUserId) throw new Error("Harness owner mismatch");
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("harness-bootstrap")
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 60)
    .sign(config.secret);
}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- --run src/tests/harness-bootstrap-token.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit dependency and new modules**

```bash
git add package.json package-lock.json src/lib/harness src/tests/harness-bootstrap-token.test.ts
git commit -m "feat: add harness bootstrap token contract"
```

### Task 3: Add the Authenticated Bootstrap API

**Files:**
- Create: `src/app/api/harness/bootstrap/route.ts`
- Create: `src/tests/harness-bootstrap-route.test.ts`

**Interfaces:**
- Consumes: `signHarnessBootstrapToken(userId)`
- Produces: `POST /api/harness/bootstrap`
- Success: `{ url: "https://agent.mislw.cn/auth/bootstrap?token=<jwt>" }`
- Failures: `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `503 HARNESS_NOT_CONFIGURED`.

- [ ] **Step 1: Write failing route tests**

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getUser,
  createRouteHandlerClient,
  getHarnessConfig,
  signHarnessBootstrapToken,
} =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    createRouteHandlerClient: vi.fn(),
    getHarnessConfig: vi.fn(),
    signHarnessBootstrapToken: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createRouteHandlerClient }));
vi.mock("@/lib/harness/config", () => ({ getHarnessConfig }));
vi.mock("@/lib/harness/bootstrap-token", () => ({
  signHarnessBootstrapToken,
}));

import { POST } from "@/app/api/harness/bootstrap/route";

describe("POST /api/harness/bootstrap", () => {
  beforeEach(() => {
    getUser.mockReset();
    createRouteHandlerClient.mockReset();
    getHarnessConfig.mockReset();
    signHarnessBootstrapToken.mockReset();
    createRouteHandlerClient.mockResolvedValue({ auth: { getUser } });
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    getHarnessConfig.mockReturnValue({
      publicOrigin: "https://agent.mislw.cn",
      ownerUserId: "owner-1",
      secret: new Uint8Array(32),
    });
    signHarnessBootstrapToken.mockResolvedValue("signed-token");
  });

  it("returns a bootstrap URL for the authenticated owner", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://agent.mislw.cn/auth/bootstrap?token=signed-token",
    });
  });

  it("returns 401 without a Supabase user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 for an authenticated non-owner", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "other-user" } } });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", { method: "POST" }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 503 when Harness configuration is unavailable", async () => {
    getHarnessConfig.mockImplementation(() => {
      throw new Error("not configured");
    });
    const response = await POST(
      new NextRequest("http://localhost/api/harness/bootstrap", { method: "POST" }),
    );
    expect(response.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/tests/harness-bootstrap-route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

```ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { getHarnessConfig } from "@/lib/harness/config";
import { signHarnessBootstrapToken } from "@/lib/harness/bootstrap-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "未登录" } },
        { status: 401 },
      );
    }
    const config = getHarnessConfig();
    if (user.id !== config.ownerUserId) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "无权访问 AI 助手" } },
        { status: 403 },
      );
    }
    const token = await signHarnessBootstrapToken(user.id);
    return NextResponse.json({
      url: `${config.publicOrigin}/auth/bootstrap?token=${encodeURIComponent(token)}`,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "HARNESS_NOT_CONFIGURED", message: "AI 助手服务未配置" } },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 4: Run the route tests**

Run: `npm test -- --run src/tests/harness-bootstrap-route.test.ts`

Expected: PASS for success, unauthenticated, forbidden, and configuration failure cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/harness/bootstrap/route.ts src/tests/harness-bootstrap-route.test.ts
git commit -m "feat: issue authenticated harness bootstrap urls"
```

### Task 4: Build the Full-Screen Embedded Assistant Page

**Files:**
- Create: `src/app/(app)/assistant/page.tsx`
- Create: `src/components/harness/harness-embed.tsx`
- Modify: `src/components/layout/nav.tsx`
- Modify: `src/components/layout/topbar.tsx`
- Modify: `next.config.mjs`
- Create: `src/tests/harness-embed.test.tsx`
- Modify: `src/tests/navigation-performance.test.tsx`

**Interfaces:**
- Consumes: `POST /api/harness/bootstrap`
- Produces: `/assistant` page with iframe title `DeepSeek Harness`
- States: `loading`, `ready`, `error`.

- [ ] **Step 1: Write failing component tests**

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.React = React;

import { HarnessEmbed } from "@/components/harness/harness-embed";

describe("HarnessEmbed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads a server-issued iframe URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "https://agent.mislw.cn/auth/bootstrap?token=x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<HarnessEmbed />);
    await waitFor(() => {
      expect(screen.getByTitle("DeepSeek Harness")).toHaveAttribute(
        "src",
        "https://agent.mislw.cn/auth/bootstrap?token=x",
      );
    });
  });

  it("offers retry after a bootstrap failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "服务不可用" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<HarnessEmbed />);
    expect(await screen.findByText("服务不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the UI tests and verify failure**

Run: `npm test -- --run src/tests/harness-embed.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the page and embed state machine**

`page.tsx`:

```tsx
import { HarnessEmbed } from "@/components/harness/harness-embed";

export default function AssistantPage() {
  return <HarnessEmbed />;
}
```

`harness-embed.tsx` must:

- POST `/api/harness/bootstrap` on mount with `cache: "no-store"`.
- Keep the iframe unmounted until a URL is received.
- Show a centered `Loader2` while loading.
- Display the server error message and a `RefreshCw` icon button labeled `重试`.
- Render an unframed iframe with `className="h-full w-full border-0"`.
- Set `allow="clipboard-read; clipboard-write"` and `referrerPolicy="no-referrer"`.
- Use `fixed inset-y-0 left-0 right-0 h-svh bg-background md:left-[240px] lg:left-[256px]` for the wrapper. This escapes the shared mobile `main` bottom padding while matching the existing desktop sidebar widths; `/assistant` hides both `TopBar` and `BottomNav`.

- [ ] **Step 4: Add the navigation entry and assistant-specific chrome**

Add to `NAV` immediately after `/workspace`:

```ts
{ href: "/assistant", label: "AI 助手", icon: Bot },
```

`TopBar` and `BottomNav` must read `usePathname()` and return `null` on `/assistant`. Keep the desktop sidebar and mobile menu button so the user can leave the embedded page.

Add `/assistant` to the navigation test's `appPages` list and assert the sidebar link uses route prefetch.

- [ ] **Step 5: Exclude the embedded route from PWA navigation caching**

In `next.config.mjs`, extend `navigateFallbackDenylist` with `/^\/assistant(?:\/|$)/` and add a first `runtimeCaching` rule that uses `NetworkOnly` for same-origin document requests whose pathname is `/assistant` or starts with `/assistant/`. Keep the existing generated `public/sw.js` and `public/workbox-*` files unstaged; they are build output and already contain user changes.

- [ ] **Step 6: Run component and navigation tests**

Run: `npm test -- --run src/tests/harness-embed.test.tsx src/tests/navigation-performance.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit only owned changes**

Because `nav.tsx` already contains user navigation-performance changes, stage the exact AI Assistant hunk rather than the whole pre-existing diff.

```bash
git add src/app/\(app\)/assistant/page.tsx src/components/harness/harness-embed.tsx src/tests/harness-embed.test.tsx next.config.mjs
git diff -- src/components/layout/nav.tsx src/components/layout/topbar.tsx src/tests/navigation-performance.test.tsx
```

Commit only after verifying the index contains no unrelated lines:

```bash
git commit -m "feat: embed the harness assistant page"
```

### Task 5: Clear the Harness Session During Logout

**Files:**
- Create: `src/lib/harness/clear-session.ts`
- Modify: `src/hooks/use-require-auth.ts`
- Create: `src/tests/harness-logout.test.ts`

**Interfaces:**
- Produces: `clearHarnessSession(): Promise<void>`
- `signOut()` becomes best-effort Harness logout followed by authoritative Supabase logout.

- [ ] **Step 1: Write the failing logout test**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

describe("Harness logout", () => {
  it("posts credentials to the agent origin and contains network failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "https://agent.mislw.cn");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("offline"),
    );
    const { clearHarnessSession } = await import(
      "@/lib/harness/clear-session"
    );
    await expect(clearHarnessSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.mislw.cn/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("contains an invalid configured origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_HARNESS_ORIGIN", "not a url");
    const { clearHarnessSession } = await import(
      "@/lib/harness/clear-session"
    );
    await expect(clearHarnessSession()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- --run src/tests/harness-logout.test.ts`

Expected: FAIL because `clear-session.ts` does not exist.

- [ ] **Step 3: Implement best-effort logout**

Create `src/lib/harness/clear-session.ts`:

```ts
export async function clearHarnessSession(): Promise<void> {
  try {
    const origin = process.env.NEXT_PUBLIC_HARNESS_ORIGIN;
    if (!origin) return;
    await fetch(`${new URL(origin).origin}/auth/logout`, {
      method: "POST",
      credentials: "include",
      mode: "cors",
    });
  } catch {
    // Harness logout is best-effort; Supabase logout remains authoritative.
  }
}
```

Update `signOut()`:

```ts
export async function signOut(): Promise<void> {
  await clearHarnessSession();
  const supabase = createClient();
  await supabase.auth.signOut();
}
```

Keep the existing Navigation and Settings callers unchanged because both already use the shared `signOut()`.

- [ ] **Step 4: Run logout and login tests**

Run: `npm test -- --run src/tests/harness-logout.test.ts src/tests/login-form.test.tsx src/tests/auth-login-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only owned hunks**

```bash
git add src/lib/harness/clear-session.ts src/hooks/use-require-auth.ts src/tests/harness-logout.test.ts
git commit -m "feat: clear harness auth during logout"
```

### Task 6: Implement the Harness Auth Gateway

**Files:**
- Create: `services/harness-gateway/package.json`
- Create: `services/harness-gateway/package-lock.json`
- Create: `services/harness-gateway/tsconfig.json`
- Create: `services/harness-gateway/Dockerfile`
- Create: `services/harness-gateway/src/config.ts`
- Create: `services/harness-gateway/src/tokens.ts`
- Create: `services/harness-gateway/src/cookies.ts`
- Create: `services/harness-gateway/src/server.ts`
- Create: `services/harness-gateway/test/tokens.test.ts`
- Create: `services/harness-gateway/test/server.test.ts`

**Interfaces:**
- Consumes: bootstrap JWT from Task 2.
- Produces: `GET /auth/bootstrap?token=...`
- Produces: `POST /auth/logout`
- Produces: `GET /health`
- Proxies: all other HTTP and WebSocket requests to `HARNESS_UPSTREAM`.
- Cookie: `dsh_embed`, HS256 audience `harness-session`, ten-minute expiry.

- [ ] **Step 1: Scaffold the isolated Node package**

`package.json`:

```json
{
  "name": "harness-auth-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --import tsx --test test/*.test.ts",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "http-proxy": "^1.18.1",
    "jose": "^6.1.0"
  },
  "devDependencies": {
    "@types/http-proxy": "^1.17.16",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.20.0",
    "typescript": "^5.6.0",
    "ws": "^8.18.3"
  }
}
```

Run inside `services/harness-gateway`:

```bash
npm install
```

- [ ] **Step 2: Write failing token tests**

Test these exact cases:

- valid `harness-bootstrap` token for `HARNESS_OWNER_USER_ID` is accepted once;
- second use of the same `jti` returns `TOKEN_REPLAYED`;
- wrong audience, wrong owner and expired token are rejected;
- generated `harness-session` token expires after 600 seconds;
- session token verification returns its `sub` and `exp`;
- expired nonce entries are lazily removed before capacity checks;
- a store at 10,000 live entries rejects a new nonce with `NONCE_STORE_FULL` rather than growing without bound.

Run: `npm test`

Expected: FAIL because token functions do not exist.

- [ ] **Step 3: Implement token verification and replay protection**

Expose:

```ts
export interface BootstrapClaims {
  sub: string;
  jti: string;
}

export class NonceStore {
  constructor(maxEntries?: number);
  consume(jti: string, expiresAtSeconds: number, nowSeconds?: number): boolean;
}

export class NonceStoreCapacityError extends Error {
  readonly code: "NONCE_STORE_FULL";
}

export async function verifyBootstrapToken(
  token: string,
  config: GatewayConfig,
  nonces: NonceStore,
  now?: Date,
): Promise<BootstrapClaims>;

export async function signSessionToken(
  userId: string,
  config: GatewayConfig,
  now?: Date,
): Promise<string>;

export async function verifySessionToken(
  token: string,
  config: GatewayConfig,
  now?: Date,
): Promise<{ sub: string; exp: number }>;
```

Use `jwtVerify`/`SignJWT`, exact audiences, required `sub`/`jti`, and the same minimum 32-byte secret rule as the app.

`NonceStore` defaults to 10,000 live entries. Every `consume()` call first deletes expired entries, rejects replays, and then throws `NonceStoreCapacityError` if the live-entry limit is still reached. It must never silently evict an unexpired nonce or grow beyond the configured maximum.

- [ ] **Step 4: Write failing HTTP integration tests**

Start a fake upstream HTTP/WebSocket server and the gateway on ephemeral ports. Assert:

- `/health` returns 200 without auth;
- `/auth/bootstrap` sets `HttpOnly; Secure; SameSite=Lax; Path=/` and redirects to `/`;
- missing/invalid/replayed bootstrap token returns 401;
- protected HTTP without `dsh_embed` returns 401;
- authenticated HTTP reaches the fake upstream with the original `Host`;
- `/auth/logout` accepts only `Origin: https://ai.mislw.cn`, clears the cookie and emits matching CORS headers;
- unauthenticated WebSocket upgrade is destroyed before reaching upstream;
- authenticated WebSocket upgrade reaches upstream;
- a WebSocket is destroyed when its verified JWT `exp` is reached;
- `/auth/logout` destroys all existing WebSockets for the authenticated `sub`;
- proxied responses contain `Content-Security-Policy: frame-ancestors https://ai.mislw.cn` and `Referrer-Policy: no-referrer`.

- [ ] **Step 5: Implement the gateway server**

Use one `http.createServer()` and one `httpProxy.createProxyServer({ ws: true, changeOrigin: false })`.

Required behavior:

```ts
server.on("upgrade", async (request, socket, head) => {
  const session = await authenticateCookie(request.headers.cookie);
  if (!session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const expiresInMs = Math.max(0, session.exp * 1000 - Date.now());
  registerUserSocket(session.sub, socket, expiresInMs);
  proxy.ws(request, socket, head, { target: config.harnessUpstream });
});
```

Maintain a `Map<string, Set<Socket>>` keyed by session `sub`. `registerUserSocket()` adds the raw upgraded socket, removes it on `close`, and installs an unref'ed timer that destroys it at JWT expiry. The logout handler verifies the current cookie, destroys every registered socket for that user, clears the set, and then clears the cookie.

The normal request handler must route health/bootstrap/logout before enforcing the session cookie, then call `proxy.web()` for authenticated requests. Proxy errors return 502 without stack traces.

- [ ] **Step 6: Add the production container**

```dockerfile
FROM node:22.19-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22.19-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
```

- [ ] **Step 7: Run gateway verification**

Run:

```bash
npm test
npm run build
docker build -t harness-auth-gateway:test .
```

Expected: all tests PASS, TypeScript build exits 0, Docker image builds.

- [ ] **Step 8: Commit**

```bash
git add services/harness-gateway
git commit -m "feat: add authenticated harness proxy"
```

### Task 7: Package the Current Harness Source for NAS

**Files in `F:\deepseek-harness`:**
- Create: `deploy/nas/Dockerfile`
- Create: `deploy/nas/cordis.patch.yml`
- Create: `deploy/nas/Dockerfile.dockerignore`
- Create: `deploy/nas/README.md`

**Interfaces:**
- Produces: image `deepseek-harness-local:0.1.0-rc.5`
- Listens: container-only `0.0.0.0:3080`
- Uses: `DSH_HOME=/home/node/.dsh`, workspace `/workspace`
- Accepts only the public authority `agent.mislw.cn` at the Harness trust fence.

- [ ] **Step 1: Write the Cordis deployment patch**

```yaml
- id: webserver
  config:
    host: 0.0.0.0
    port: 3080

- id: connection
  config:
    trustedHosts:
      - agent.mislw.cn
```

Run:

```powershell
pnpm dsh web --patch .\deploy\nas\cordis.patch.yml --dump-config
```

Expected: output shows `webserver.host: 0.0.0.0`, port `3080`, and only `agent.mislw.cn` in the connection trusted-host list; the command does not start a server.

- [ ] **Step 2: Add a source-build Dockerfile**

```dockerfile
FROM node:22.19-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN mkdir -p /home/node/.dsh /workspace \
  && chown -R node:node /home/node/.dsh /workspace
ENV NODE_ENV=production
ENV DSH_HOME=/home/node/.dsh
USER node
EXPOSE 3080
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:3080').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["pnpm", "dsh", "web", "--patch", "/app/deploy/nas/cordis.patch.yml"]
```

`deploy/nas/Dockerfile.dockerignore` must exclude `.git`, all existing `node_modules`, test artifacts, coverage, temporary canvas output, and local `.env` files, while retaining current uncommitted source files including `packages/client/ui-oasis-workflow`. Docker discovers this file because it is named after the selected Dockerfile while the build context remains the repository root.

- [ ] **Step 3: Build from the current dirty source snapshot**

Run:

```powershell
docker build -f .\deploy\nas\Dockerfile -t deepseek-harness-local:0.1.0-rc.5 .
```

Expected: build succeeds without copying `.env` or `.git`; the image contains the current Oasis UI package.

- [ ] **Step 4: Run a keyless smoke**

Run the image with a temporary home and no public port, then execute inside its network namespace:

```powershell
docker run --rm -d --name dsh-smoke `
  -e DSH_HOME=/home/node/.dsh `
  deepseek-harness-local:0.1.0-rc.5
docker exec dsh-smoke node -e "fetch('http://127.0.0.1:3080').then(async r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
docker rm -f dsh-smoke
```

Expected: status 200 and clean container removal.

- [ ] **Step 5: Commit only the new deployment files**

```bash
git add deploy/nas
git commit -m "build: add nas harness image"
```

Do not stage any existing Harness modifications.

### Task 8: Add the Private LLM Relay and Compose Isolation

**Files:**
- Create: `deploy/harness/llm-relay/Caddyfile`
- Create: `deploy/harness/llm-relay/Dockerfile`
- Modify: `D:\ai_WorkPlace\docker-compose.yml`
- Modify: `D:\ai_WorkPlace\Dockerfile`
- Modify: `D:\ai_WorkPlace\Caddyfile`
- Create: `D:\ai_WorkPlace\.env.example`
- Modify: `.env.example`

**Interfaces:**
- `harness` joins only `harness_private`.
- `harness-gateway` joins `default` and `harness_private`.
- `harness-llm-relay` joins `harness_private` and `harness_egress`.
- Real `DEEPSEEK_API_KEY` exists only in `harness-llm-relay`.
- Harness receives a non-secret internal placeholder key and `DEEPSEEK_BASE_URL=http://harness-llm-relay:8080`.
- Harness Web Search uses `DEEPSEEK_SEARCH_BASE_URL=http://harness-llm-relay:8080/anthropic/v1`.

- [ ] **Step 1: Add a strict relay**

Use Caddy to proxy only the exact DeepSeek adapter and Web Search paths and inject the real key:

```caddyfile
:8080 {
	@allowed path /chat/completions /models /anthropic/v1/messages
	handle @allowed {
		reverse_proxy https://api.deepseek.com {
			header_up Host api.deepseek.com
			header_up Authorization "Bearer {$DEEPSEEK_UPSTREAM_API_KEY}"
		}
	}
	respond 404
}
```

The relay Dockerfile copies only this Caddyfile and runs `caddy:2.10.2-alpine`.

- [ ] **Step 2: Extend the app image build arguments**

Add `NEXT_PUBLIC_HARNESS_ORIGIN` to the app Dockerfile builder arguments and environment so the client logout helper receives the production origin.

- [ ] **Step 3: Add Compose services and networks**

Add:

```yaml
harness:
  build:
    context: ../../deepseek-harness-context
    dockerfile: deploy/nas/Dockerfile
  image: deepseek-harness-local:0.1.0-rc.5
  restart: unless-stopped
  environment:
    DSH_HOME: /home/node/.dsh
    DSH_CWD: /workspace
    DEEPSEEK_API_KEY: internal-relay-token
    DEEPSEEK_BASE_URL: http://harness-llm-relay:8080
    DEEPSEEK_SEARCH_BASE_URL: http://harness-llm-relay:8080/anthropic/v1
  volumes:
    - harness_home:/home/node/.dsh
    - ./volumes/harness/workspace:/workspace
  networks: [harness_private]
  init: true
  read_only: true
  tmpfs: [/tmp]
  security_opt: [no-new-privileges:true]
  cap_drop: [ALL]
  cpus: 2.0
  mem_limit: 4g
  pids_limit: 512
  logging: *default-logging

harness-gateway:
  build:
    context: ../../ai-workspace-app-context/services/harness-gateway
  restart: unless-stopped
  environment:
    HARNESS_UPSTREAM: http://harness:3080
    HARNESS_EMBED_SECRET: ${HARNESS_EMBED_SECRET}
    HARNESS_OWNER_USER_ID: ${HARNESS_OWNER_USER_ID}
    AI_WORKSPACE_ORIGIN: https://ai.mislw.cn
    HARNESS_PUBLIC_ORIGIN: https://agent.mislw.cn
  networks: [default, harness_private]
  init: true
  read_only: true
  tmpfs: [/tmp]
  security_opt: [no-new-privileges:true]
  cap_drop: [ALL]
  cpus: 0.5
  mem_limit: 256m
  pids_limit: 128
  logging: *default-logging

harness-llm-relay:
  build:
    context: ../../ai-workspace-app-context/deploy/harness/llm-relay
  restart: unless-stopped
  environment:
    DEEPSEEK_UPSTREAM_API_KEY: ${DEEPSEEK_API_KEY}
  networks: [harness_private, harness_egress]
  init: true
  read_only: true
  tmpfs: [/tmp]
  security_opt: [no-new-privileges:true]
  cap_drop: [ALL]
  cpus: 0.5
  mem_limit: 128m
  pids_limit: 64
  logging: *default-logging
```

Reuse the deployment's existing `x-logging: &default-logging` anchor, whose rotation policy caps log files. Add `harness_private: { internal: true }`, `harness_egress: {}`, and `harness_home:`. Add health checks and `depends_on` conditions so Gateway starts only after Harness is healthy.

Add these app environment variables:

```yaml
HARNESS_EMBED_SECRET: ${HARNESS_EMBED_SECRET}
HARNESS_OWNER_USER_ID: ${HARNESS_OWNER_USER_ID}
NEXT_PUBLIC_HARNESS_ORIGIN: https://agent.mislw.cn
```

- [ ] **Step 4: Add the Caddy public host**

```caddyfile
agent.mislw.cn {
	encode zstd gzip
	reverse_proxy harness-gateway:8787
}
```

Do not route `agent.mislw.cn` directly to `harness:3080`.

- [ ] **Step 5: Validate Compose without printing secrets**

Run:

```powershell
docker compose config --quiet
docker compose config --services
```

Expected services include `app`, `caddy`, `harness`, `harness-gateway`, and `harness-llm-relay`; validation exits 0.

Inspect the rendered configuration through a redacting script and confirm no host `ports:` exist on the three Harness services.

- [ ] **Step 6: Verify network isolation**

After local startup:

```powershell
docker compose exec harness node -e "fetch('http://app:3000').then(()=>process.exit(1)).catch(()=>process.exit(0))"
docker compose exec harness node -e "fetch('http://harness-llm-relay:8080/models').then(r=>process.exit(r.status===401||r.ok?0:1)).catch(()=>process.exit(1))"
```

Expected: Harness cannot resolve/reach `app`; it can reach only the relay on its private network. The real upstream key is absent from `docker compose exec harness env`.

- [ ] **Step 7: Commit repository-owned deployment files**

```bash
git add deploy/harness/llm-relay .env.example
git commit -m "build: add isolated harness deployment services"
```

The external FNOS Compose, app Dockerfile and Caddyfile remain deployment artifacts unless the user later authorizes importing them into this repository.

### Task 9: Run Full Local Verification

**Files:**
- Modify only if tests expose defects in Tasks 1-8.

**Interfaces:**
- Acceptance URL: local app `/assistant`
- Gateway health: `/health`
- Harness health: internal `:3080`

- [ ] **Step 1: Run AI Workspace checks**

```powershell
npm run typecheck
npm test
npm run build
```

Expected: all exit 0. The build must not enable preview auth in production.

- [ ] **Step 2: Run Gateway checks**

```powershell
Push-Location services\harness-gateway
npm test
npm run build
Pop-Location
```

Expected: all exit 0.

- [ ] **Step 3: Run Harness source checks relevant to deployment**

```powershell
pnpm dsh web --patch .\deploy\nas\cordis.patch.yml --dump-config
docker build -f .\deploy\nas\Dockerfile -t deepseek-harness-local:0.1.0-rc.5 .
```

Expected: config dump and image build succeed.

- [ ] **Step 4: Start the local integration stack**

Use non-production test secrets and a mock/limited provider key. Start only the required services on a test Compose project name; do not disturb the running NAS deployment.

Expected: app, gateway, Harness and relay are healthy.

- [ ] **Step 5: Verify with Playwright/browser**

Check desktop `1440x900` and mobile `390x844`:

- unauthenticated `/assistant` redirects to login;
- authenticated `/assistant` shows the Harness iframe without a second login;
- desktop sidebar remains usable;
- mobile menu remains usable and no bottom navigation covers the composer;
- direct unauthenticated `agent.mislw.cn` equivalent returns 401;
- prompt streams visibly, Stop ends the active turn, refresh restores history;
- approval requests remain blocked until explicitly answered;
- no incoherent overlap, blank iframe, console error, failed WebSocket, or service-worker cached stale page.

Capture screenshots and console/network evidence.

- [ ] **Step 6: Verify container boundaries**

From a Harness Shell tool, attempt only non-destructive probes:

- read `/workspace` succeeds;
- write a temporary `/workspace/acceptance.txt` succeeds;
- read Compose paths, `/var/run/docker.sock`, Supabase data and app container files fails;
- environment contains no real DeepSeek, Supabase or Gateway signing secret;
- requests to `app`, `kong`, `db` and NAS-only addresses fail;
- model calls still work through the relay.

Delete only the acceptance file after confirming its resolved path is under the mounted workspace.

- [ ] **Step 7: Review the complete diff**

Run:

```powershell
git diff --check
git status --short
git -c core.autocrlf=false diff --stat
```

Separate the user's prior dirty files from this feature's owned files. Do not normalize line endings or generated PWA files as part of this feature.

### Task 10: Deploy to FNOS and Configure Cloudflare

**Files/Systems:**
- NAS deployment directory: `/vol1/1000/docker/ai-workspace/ai-workspace-fnos-lan`
- Cloudflare Zero Trust Tunnel public hostname
- DNS hostname: `agent.mislw.cn`

**Interfaces:**
- Public app: `https://ai.mislw.cn/assistant`
- Protected Harness host: `https://agent.mislw.cn`

- [ ] **Step 1: Back up deployment configuration**

Create timestamped copies of the current Compose, Caddyfile and environment file inside the deployment directory. Do not copy database data or print environment values.

- [ ] **Step 2: Upload source contexts and deployment files**

Upload:

- AI Workspace app context including `services/harness-gateway` and relay files;
- current `F:\deepseek-harness` source snapshot including uncommitted Oasis UI source and `deploy/nas`;
- updated Compose, app Dockerfile and Caddyfile.

Verify file counts and required paths before rebuilding.

- [ ] **Step 3: Build new images without touching database containers**

Build `app`, `harness-gateway`, `harness-llm-relay`, and `harness`. Do not remove PostgreSQL volumes or rebuild unrelated Supabase services.

Expected: all four images build; the existing app remains available until cutover.

- [ ] **Step 4: Recreate only affected services**

Recreate `app`, `caddy`, `harness`, `harness-gateway`, and `harness-llm-relay`. Preserve `db`, PostgREST, Auth, Realtime and their volumes.

Expected: affected containers become healthy.

- [ ] **Step 5: Add the Cloudflare Tunnel hostname**

Create `agent.mislw.cn` on the existing tunnel and route it to the NAS Caddy HTTP origin while preserving the public Host header.

Expected: Cloudflare TLS is valid for the single-level wildcard hostname and WebSocket upgrades succeed.

- [ ] **Step 6: Run public acceptance**

Verify:

- `https://ai.mislw.cn/assistant` embeds Harness after the existing login;
- `https://agent.mislw.cn` without the embed session returns 401;
- prompt streaming, Stop, model selection, tool approval, file operation, subagent and workflow surfaces work;
- logout revokes both app and Harness sessions;
- NAS restart preserves Harness sessions and settings;
- direct NAS ports do not expose Harness, Gateway or relay.

- [ ] **Step 7: Roll back on any failed security gate**

If auth, WebSocket, credential isolation or filesystem boundary fails, restore the previous Caddy/Compose files and recreate only the previous `app` and `caddy`. Keep the new Harness volume detached for diagnosis; do not delete it during rollback.

- [ ] **Step 8: Record verified state**

Report separately:

- implemented source files;
- committed files;
- built images;
- deployed containers;
- Cloudflare hostname state;
- browser/WebSocket verification;
- remaining phase-two business-tool work.
