# Local Toolbox Archive Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `工具箱` page whose first tool, `解压小工具`, launches a Windows-only local helper for ordinary and special archive extraction without sending private files, paths, or passwords to the workspace server.

**Architecture:** The existing Next.js app receives only a navigation item, a toolbox page, and a read-only loopback health check. A separate TypeScript helper binds to `127.0.0.1`, serves its own compact local UI, opens native Windows pickers, and invokes WinRAR for normal archives, incorrect suffixes, numeric split archives, and nested extraction. Mutation APIs are same-origin to the helper page; the deployed workspace can only check health and open the local page.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Node.js HTTP/FS/child_process APIs, Windows PowerShell native pickers, WinRAR 5.20+.

**Spec:** `docs/superpowers/specs/2026-09-06-local-toolbox-archive-extractor-design.md`

## Global Constraints

- The workspace page is named `工具箱`; the tool is named `解压小工具`.
- Support ordinary ZIP, RAR, and 7z archives, both password-free and password-protected.
- Support incorrect suffix correction, `.7z.001/.002/.003` numeric splits, split parts in different child folders, and nested extraction up to depth 10.
- Bind the helper only to `127.0.0.1`; never upload archive bytes, extracted files, local paths, or passwords to the workspace/NAS origin.
- Do not delete source archives, split parts, filler files, or extracted output.
- Never overwrite an existing file or directory; create a timestamped alternative.
- Passwords are active-job-only values, cleared after completion, and excluded from application logs.
- Preserve all unrelated dirty-worktree changes. Do not commit or push without separate user authorization.
- Do not add a database table, Supabase dependency, knowledge-upload integration, Hermes tool, installer, or external archive library.

---

### Task 1: Archive Signatures, Names, And Split Contracts

**Files:**
- Create: `tools/local-toolbox/archive-core.ts`
- Create: `src/tests/local-toolbox-archive-core.test.ts`

**Interfaces:**
- Produces:
  - `type ArchiveKind = "7z" | "zip" | "rar"`
  - `type SplitPart = { path: string; baseName: string; index: number; width: number }`
  - `type SplitGroup = { baseName: string; parts: SplitPart[]; ambiguousIndexes: number[] }`
  - `detectArchiveKind(header: Uint8Array): ArchiveKind | null`
  - `preferredArchivePath(filePath: string, kind: ArchiveKind): string`
  - `parseSplitPart(filePath: string): SplitPart | null`
  - `groupSplitParts(paths: string[]): SplitGroup[]`
  - `firstMissingSplitIndex(group: SplitGroup): number | null`
  - `nextAvailablePath(preferredPath: string, exists: (path: string) => boolean, now?: Date): string`

- [ ] **Step 1: Write failing signature and suffix tests**

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectArchiveKind,
  preferredArchivePath,
} from "../../tools/local-toolbox/archive-core";

describe("local toolbox archive signatures", () => {
  it.each([
    [Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "7z"],
    [Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "zip"],
    [Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), "rar"],
  ] as const)("detects %s", (header, expected) => {
    expect(detectArchiveKind(header)).toBe(expected);
  });

  it("replaces a misleading suffix with the detected archive suffix", () => {
    expect(preferredArchivePath("D:/private/course.pdf", "7z")).toBe(
      path.normalize("D:/private/course.7z"),
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-archive-core.test.ts
```

Expected: FAIL because `tools/local-toolbox/archive-core.ts` does not exist.

- [ ] **Step 3: Implement minimal signature and suffix functions**

```ts
import path from "node:path";

export type ArchiveKind = "7z" | "zip" | "rar";

const signatures: Array<{ kind: ArchiveKind; bytes: number[] }> = [
  { kind: "7z", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { kind: "zip", bytes: [0x50, 0x4b] },
  { kind: "rar", bytes: [0x52, 0x61, 0x72, 0x21] },
];

export function detectArchiveKind(header: Uint8Array): ArchiveKind | null {
  return signatures.find(({ bytes }) =>
    bytes.every((byte, index) => header[index] === byte),
  )?.kind ?? null;
}

export function preferredArchivePath(
  filePath: string,
  kind: ArchiveKind,
): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${kind}`);
}
```

- [ ] **Step 4: Add failing split grouping and collision tests**

```ts
import {
  firstMissingSplitIndex,
  groupSplitParts,
  nextAvailablePath,
  parseSplitPart,
} from "../../tools/local-toolbox/archive-core";

it("parses and orders numeric split parts across directories", () => {
  const group = groupSplitParts([
    "D:/download/b/course.7z.002",
    "D:/download/a/course.7z.001",
    "D:/download/c/course.7z.003",
  ])[0]!;

  expect(group.baseName).toBe("course.7z");
  expect(group.parts.map((part) => part.index)).toEqual([1, 2, 3]);
  expect(group.ambiguousIndexes).toEqual([]);
  expect(firstMissingSplitIndex(group)).toBeNull();
  expect(parseSplitPart("D:/download/course.7z")).toBeNull();
});

it("reports a missing or duplicate split instead of guessing", () => {
  const missing = groupSplitParts([
    "D:/a/course.7z.001",
    "D:/c/course.7z.003",
  ])[0]!;
  const duplicate = groupSplitParts([
    "D:/a/course.7z.001",
    "D:/b/course.7z.001",
  ])[0]!;

  expect(firstMissingSplitIndex(missing)).toBe(2);
  expect(duplicate.ambiguousIndexes).toEqual([1]);
});

it("creates a timestamped path when the preferred path exists", () => {
  expect(
    nextAvailablePath(
      "D:/download/course",
      (candidate) => candidate === path.normalize("D:/download/course"),
      new Date("2026-09-06T08:09:10+08:00"),
    ),
  ).toBe(path.normalize("D:/download/course_20260906_080910"));
});
```

- [ ] **Step 5: Run the focused test and verify the new assertions fail**

Run the Task 1 focused command again.

Expected: signature tests PASS; split/collision tests FAIL because the new exports do not exist.

- [ ] **Step 6: Implement split grouping and collision-safe paths**

Use `/^(?<base>.+)\.(?<index>\d{3,})$/i` against `path.basename(filePath)`.
Group across the selected root by lowercase `baseName`, retain the original
base name from the first part, sort by numeric index, and list every duplicated
index in `ambiguousIndexes`. `firstMissingSplitIndex()` returns `1` when no
`.001` exists, otherwise the first gap through the highest supplied index.
`nextAvailablePath()` appends `_yyyyMMdd_HHmmss`, then `_2`, `_3`, and so on
until `exists()` returns false.

- [ ] **Step 7: Verify Task 1**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-archive-core.test.ts
```

Expected: PASS with no warnings.

---

### Task 2: Filesystem Discovery And Temporary Split Staging

**Files:**
- Create: `tools/local-toolbox/archive-discovery.ts`
- Create: `src/tests/local-toolbox-archive-discovery.test.ts`

**Interfaces:**
- Consumes: `SplitGroup`, `groupSplitParts()`, and `firstMissingSplitIndex()` from Task 1.
- Produces:
  - `type ArchiveCandidate = { kind: "regular"; path: string; outputParentPath: string } | { kind: "split"; firstPartPath: string; sourcePaths: string[]; outputParentPath: string; temporaryDirectory?: string }`
  - `listFilesRecursively(rootPath: string): Promise<string[]>`
  - `discoverArchiveCandidates(selectionPath: string): Promise<ArchiveCandidate[]>`
  - `stageSplitGroup(group: SplitGroup, temporaryRoot: string, outputParentPath: string): Promise<ArchiveCandidate>`
  - `cleanupTemporaryCandidate(candidate: ArchiveCandidate): Promise<void>`

- [ ] **Step 1: Write failing discovery tests using disposable directories**

```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupTemporaryCandidate,
  discoverArchiveCandidates,
  stageSplitGroup,
} from "../../tools/local-toolbox/archive-discovery";
import { groupSplitParts } from "../../tools/local-toolbox/archive-core";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("finds an ordinary archive and only the first part of a split archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-discovery-"));
  roots.push(root);
  await writeFile(path.join(root, "normal.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await writeFile(path.join(root, "course.7z.001"), Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
  await writeFile(path.join(root, "course.7z.002"), Buffer.from([0x00]));

  const candidates = await discoverArchiveCandidates(root);

  expect(candidates.map((item) => item.kind)).toEqual(["regular", "split"]);
  expect(candidates.filter((item) => item.kind === "split")).toHaveLength(1);
});

it("copies cross-directory parts into a helper-owned temporary directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-parts-"));
  const temp = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-stage-"));
  roots.push(root, temp);
  await mkdir(path.join(root, "a"));
  await mkdir(path.join(root, "b"));
  const first = path.join(root, "a", "course.7z.001");
  const second = path.join(root, "b", "course.7z.002");
  await writeFile(first, "one");
  await writeFile(second, "two");

  const candidate = await stageSplitGroup(
    groupSplitParts([first, second])[0]!,
    temp,
    root,
  );

  expect(candidate.kind).toBe("split");
  expect(candidate.temporaryDirectory).toBeTruthy();
  expect(candidate.outputParentPath).toBe(root);
  await expect(readFile(candidate.firstPartPath, "utf8")).resolves.toBe("one");
  await cleanupTemporaryCandidate(candidate);
  await expect(stat(candidate.temporaryDirectory!)).rejects.toThrow();
});
```

Add `readFile` and `stat` to the test imports.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-archive-discovery.test.ts
```

Expected: FAIL because the discovery module does not exist.

- [ ] **Step 3: Implement recursive discovery**

Read at most the first 8 bytes from regular files. Treat a file as an ordinary
candidate when its extension is `.zip`, `.rar`, or `.7z`, or when
`detectArchiveKind()` recognizes its header. Parse numeric split files before
ordinary signature handling so only a group's `.001` becomes a candidate.
For a selected file, set `outputParentPath` to its parent directory. For a
selected directory, regular candidates use their own parent directory while
cross-directory split groups use the selected root as `outputParentPath`.
Reject a group with `ambiguousIndexes` or `firstMissingSplitIndex() !== null`
using stable error codes `SPLIT_AMBIGUOUS` and `SPLIT_PART_MISSING`.

- [ ] **Step 4: Implement safe staging and cleanup**

For parts already in one directory, return their real `.001` path without a
temporary directory. For cross-directory parts, create
`<temporaryRoot>/<randomUUID()>`, copy each part with `COPYFILE_EXCL`, and
return the copied `.001` path while preserving the supplied
`outputParentPath`. Cleanup may recursively remove only the exact resolved
temporary directory created beneath the supplied temporary root.

- [ ] **Step 5: Verify Task 2**

Run the Task 2 focused test. Expected: PASS and all helper-created temporary
test directories are removed.

---

### Task 3: WinRAR Adapter And Recursive Extraction Jobs

**Files:**
- Create: `tools/local-toolbox/winrar.ts`
- Create: `tools/local-toolbox/archive-jobs.ts`
- Create: `src/tests/local-toolbox-winrar.test.ts`
- Create: `src/tests/local-toolbox-archive-jobs.test.ts`

**Interfaces:**
- Consumes: archive candidates and safe naming from Tasks 1-2.
- Produces:
  - `findWinRar(environment?: NodeJS.ProcessEnv): Promise<string | null>`
  - `runWinRar(command: "test" | "extract", input: WinRarInput): Promise<WinRarResult>`
  - `type WinRarResult = { ok: boolean; code: number; reason: "success" | "wrong_password" | "failed" }`
  - `createArchiveJob(input: { selectionPath: string; password: string; winRarPath: string; temporaryRoot: string }): ArchiveJob`
  - `ArchiveJob.start(): Promise<void>`
  - `ArchiveJob.providePassword(password: string): Promise<void>`
  - `ArchiveJob.snapshot(): ArchiveJobSnapshot`

- [ ] **Step 1: Write failing WinRAR argument and result tests**

Use an injected `spawnProcess(executable, args, options)` dependency so tests
assert exact arguments without launching WinRAR:

```ts
it("omits the password argument for a password-free archive", async () => {
  const spawnProcess = vi.fn().mockResolvedValue(0);
  await runWinRar("test", {
    executable: "C:/Program Files/WinRAR/WinRAR.exe",
    archivePath: "D:/download/course.zip",
    password: "",
    spawnProcess,
  });
  expect(spawnProcess.mock.calls[0]![1]).toEqual([
    "t", "-ibck", "-inul", "-y", "D:/download/course.zip",
  ]);
});

it("maps WinRAR exit code 11 to a password request", async () => {
  const result = await runWinRar("test", {
    executable: "WinRAR.exe",
    archivePath: "D:/download/course.7z",
    password: "secret.",
    spawnProcess: vi.fn().mockResolvedValue(11),
  });
  expect(result).toEqual({ ok: false, code: 11, reason: "wrong_password" });
});
```

- [ ] **Step 2: Run the WinRAR test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-winrar.test.ts
```

Expected: FAIL because `tools/local-toolbox/winrar.ts` does not exist.

- [ ] **Step 3: Implement the WinRAR adapter**

Search, in order:

```text
%ProgramFiles%\WinRAR\WinRAR.exe
%ProgramFiles(x86)%\WinRAR\WinRAR.exe
WinRAR.exe resolved through PATH
```

Use `spawn(executable, args, { windowsHide: true, stdio: "ignore" })`. Build
arguments as arrays, add `-p${password}` only when the password is non-empty,
and never log the array. Use `t` for test and
`x -ibck -inul -y <archive> <destination-with-trailing-separator>` for
extraction. Map code `0` to success and code `11` to `wrong_password`; all
other codes map to `failed`.

- [ ] **Step 4: Write failing job-state tests**

```ts
it("pauses for another password without discarding the selected job", async () => {
  const winRar = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 11, reason: "wrong_password" })
    .mockResolvedValueOnce({ ok: true, code: 0, reason: "success" })
    .mockResolvedValueOnce({ ok: true, code: 0, reason: "success" });
  const job = createArchiveJob(testJobInput({ runWinRar: winRar }));

  await job.start();
  expect(job.snapshot().status).toBe("needs_password");

  await job.providePassword("replacement.");
  expect(job.snapshot().status).toBe("completed");
});

it("stops nested discovery at depth ten", async () => {
  const job = createArchiveJob(
    testJobInput({
      discoverNested: vi.fn(async ({ depth }) =>
        depth < 11 ? [{ path: `nested-${depth}.7z` }] : [],
      ),
    }),
  );
  await job.start();
  expect(job.snapshot().failures).toContainEqual(
    expect.objectContaining({ code: "NESTED_DEPTH_EXCEEDED" }),
  );
});
```

`testJobInput()` supplies a disposable output root and injected filesystem,
discovery, staging, and WinRAR dependencies.

- [ ] **Step 5: Run the job test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-archive-jobs.test.ts
```

Expected: FAIL because the job module does not exist.

- [ ] **Step 6: Implement the job state machine**

Use these states:

```ts
type ArchiveJobStatus =
  | "queued"
  | "testing"
  | "extracting"
  | "needs_password"
  | "completed"
  | "failed";
```

Process candidates breadth-first with `{ candidate, depth }`. Before a normal
archive is tested, compare its current extension with its detected kind and
rename through `nextAvailablePath()` when required. Test before creating the
destination directory. Build the destination under
`candidate.outputParentPath`, never beside a staged temporary copy. On wrong
password, preserve the current queue and candidate, clear the stored password,
and enter `needs_password`. On success, extract to a unique sibling directory,
count its non-empty files, discover
nested candidates only inside that new directory, and enqueue them at
`depth + 1`. Always clean helper-owned split staging directories in `finally`.

- [ ] **Step 7: Verify Task 3**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-winrar.test.ts src/tests/local-toolbox-archive-jobs.test.ts
```

Expected: PASS. Inspect failure snapshots to confirm they expose stable codes
but not injected passwords.

---

### Task 4: Loopback Helper Server And Native Windows Picker

**Files:**
- Create: `tools/local-toolbox/native-picker.ts`
- Create: `tools/local-toolbox/archive-helper.ts`
- Create: `src/tests/local-toolbox-helper.test.ts`

**Interfaces:**
- Consumes: `findWinRar()` and `ArchiveJob` from Task 3.
- Produces:
  - `pickWindowsPath(mode: "file" | "folder"): Promise<string | null>`
  - `createLocalToolboxServer(dependencies): http.Server`
  - `GET /health`
  - `POST /api/selections`
  - `POST /api/jobs`
  - `GET /api/jobs/:id`
  - `POST /api/jobs/:id/password`
  - `POST /api/jobs/:id/reveal`

- [ ] **Step 1: Write failing protocol-security tests**

Start the server on an ephemeral loopback port with injected picker/job
dependencies:

```ts
it("exposes only non-private helper health to the workspace origin", async () => {
  const response = await fetch(`${origin}/health`, {
    headers: { Origin: "https://ai.mislw.cn" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(
    "https://ai.mislw.cn",
  );
  expect(await response.json()).toEqual({
    ok: true,
    version: 1,
    winRarAvailable: true,
  });
});

it("rejects cross-origin job creation", async () => {
  const response = await fetch(`${origin}/api/jobs`, {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
      "X-Local-Toolbox": "1",
    },
    body: JSON.stringify({ selectionId: "selection-1", password: "secret" }),
  });
  expect(response.status).toBe(403);
});

it("stores an opaque selection id instead of accepting a client path", async () => {
  const response = await helperPost("/api/selections", { mode: "folder" });
  const body = await response.json();
  expect(body).toEqual({
    selectionId: expect.any(String),
    displayName: "语文950",
  });
  expect(JSON.stringify(body)).not.toContain("D:\\\\private");
});
```

- [ ] **Step 2: Run the helper test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-helper.test.ts
```

Expected: FAIL because the helper server does not exist.

- [ ] **Step 3: Implement the native picker**

Spawn `powershell.exe` with `-NoProfile -Sta -Command`. File mode uses
`System.Windows.Forms.OpenFileDialog`; folder mode uses
`System.Windows.Forms.FolderBrowserDialog`. Write only the selected absolute
path to stdout, trim it, and return `null` on cancel. The PowerShell command is
constant; do not interpolate a client-supplied path.

- [ ] **Step 4: Implement the loopback server**

Bind with:

```ts
server.listen(port, "127.0.0.1");
```

Allow health-read CORS only for:

```ts
new Set(["http://localhost:3000", "https://ai.mislw.cn"])
```

All `/api/*` mutation requests require the helper page origin, JSON content
type, and `X-Local-Toolbox: 1`. Keep selected paths in a private in-memory map
keyed by `randomUUID()`. Return only `selectionId` plus `path.basename(path)`.
Reject any request body containing `path`. Keep jobs in memory, clear job
passwords when completed/failed, and expire selections/jobs after 30 minutes.

- [ ] **Step 5: Implement reveal-output safely**

The reveal endpoint accepts only a completed job id and launches:

```ts
spawn("explorer.exe", [job.snapshot().primaryOutputPath], {
  detached: true,
  windowsHide: true,
  stdio: "ignore",
}).unref();
```

Never accept an output path from the browser.

- [ ] **Step 6: Verify Task 4**

Run the focused helper test. Expected: PASS, with the test server listening
only on an ephemeral loopback port and closing in `afterEach`.

---

### Task 5: Local Helper Interface And Launcher

**Files:**
- Create: `tools/local-toolbox/public/index.html`
- Create: `tools/local-toolbox/public/styles.css`
- Create: `tools/local-toolbox/public/app.js`
- Create: `tools/local-toolbox/启动本地工具箱.cmd`
- Modify: `package.json`
- Create: `src/tests/local-toolbox-helper-ui.test.ts`

**Interfaces:**
- Consumes: helper endpoints from Task 4.
- Produces:
  - local page at `http://127.0.0.1:37654/`
  - `npm run toolbox:local`
  - double-click Windows launcher

- [ ] **Step 1: Write failing local-UI source tests**

```ts
it("provides separate file and folder selection commands", () => {
  const html = readHelperAsset("index.html");
  expect(html).toContain('data-action="pick-file"');
  expect(html).toContain('data-action="pick-folder"');
  expect(html).toContain('type="password"');
  expect(html).toContain("解压小工具");
});

it("never sends jobs to the workspace origin", () => {
  const script = readHelperAsset("app.js");
  expect(script).toContain('fetch("/api/jobs"');
  expect(script).not.toContain("ai.mislw.cn");
  expect(script).not.toContain("localhost:3000");
});
```

- [ ] **Step 2: Run the UI test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-helper-ui.test.ts
```

Expected: FAIL because the helper assets do not exist.

- [ ] **Step 3: Build the compact local UI**

Use one unframed page with a small toolbar and one extraction panel. Use
buttons with Lucide-equivalent Unicode-free text/icon styling only where no
icon package is available in this static helper. Provide stable status rows
for:

```text
未选择 -> 已选择 -> 检查压缩包 -> 解压中 -> 需要新密码 -> 已完成/失败
```

Disable start until a selection exists. Submit passwords only to relative
`/api/jobs` or `/api/jobs/:id/password`. Clear the password input immediately
after each accepted request. Poll the current job every 500 ms only while it
is active.

- [ ] **Step 4: Add launch scripts**

Add to `package.json`:

```json
"toolbox:local": "node --import tsx tools/local-toolbox/archive-helper.ts"
```

Create `启动本地工具箱.cmd`:

```bat
@echo off
setlocal
cd /d "%~dp0\..\.."
node --import tsx tools\local-toolbox\archive-helper.ts
if errorlevel 1 pause
```

On helper startup, open `http://127.0.0.1:37654/` through
`Start-Process`/`explorer.exe` only after the listener is ready. If port 37654
is already occupied by a healthy helper, open the existing page and exit.

- [ ] **Step 5: Verify Task 5**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-helper-ui.test.ts
npm run toolbox:local
```

Expected: test PASS; helper opens locally, reports the installed WinRAR, and
does not require the Next.js app to be running. Stop the helper after this
manual smoke check.

---

### Task 6: Workspace Toolbox Page And Navigation

**Files:**
- Create: `src/lib/local-toolbox/client.ts`
- Create: `src/components/toolbox/archive-extractor-tool.tsx`
- Create: `src/app/(app)/toolbox/page.tsx`
- Modify: `src/components/layout/nav.tsx:4-35`
- Modify: `src/tests/navigation-performance.test.tsx`
- Create: `src/tests/toolbox-page.test.tsx`

**Interfaces:**
- Consumes: helper `GET /health` and local page URL from Tasks 4-5.
- Produces:
  - `LOCAL_TOOLBOX_ORIGIN = "http://127.0.0.1:37654"`
  - `getLocalToolboxHealth(signal?: AbortSignal): Promise<LocalToolboxHealth>`
  - `/toolbox` page and `工具箱` navigation entry

- [ ] **Step 1: Write failing client and page tests**

```tsx
it("shows the local extractor as offline without offering an upload fallback", async () => {
  vi.mocked(getLocalToolboxHealth).mockRejectedValue(new Error("offline"));
  render(<ToolboxPage />);
  expect(await screen.findByText("本机助手未启动")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重试连接" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开解压小工具" })).toBeInTheDocument();
  expect(screen.queryByText(/上传/)).not.toBeInTheDocument();
});

it("opens the local helper without forwarding a password or file", async () => {
  vi.mocked(getLocalToolboxHealth).mockResolvedValue({
    ok: true,
    version: 1,
    winRarAvailable: true,
  });
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  render(<ToolboxPage />);
  fireEvent.click(await screen.findByRole("button", { name: "打开解压小工具" }));
  expect(open).toHaveBeenCalledWith(
    "http://127.0.0.1:37654/",
    "local-toolbox",
    expect.any(String),
  );
});
```

- [ ] **Step 2: Update the navigation test first and verify RED**

Add `toolbox/page.tsx` to `appPages`, then assert:

```ts
expect(screen.getByRole("link", { name: "工具箱" })).toHaveAttribute(
  "href",
  "/toolbox",
);
expect(labels).toEqual(["工作台", "日历", "待办", "笔记"]);
```

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/toolbox-page.test.tsx src/tests/navigation-performance.test.tsx
```

Expected: FAIL because the page, client, and navigation item do not exist.

- [ ] **Step 3: Implement the health client**

Fetch `${LOCAL_TOOLBOX_ORIGIN}/health` with `cache: "no-store"` and a 1500 ms
AbortController timeout. Validate exact fields:

```ts
type LocalToolboxHealth = {
  ok: true;
  version: 1;
  winRarAvailable: boolean;
};
```

Treat any non-200 response or malformed body as offline. Do not add cookies,
authorization headers, user ids, or workspace data.

- [ ] **Step 4: Implement the toolbox page**

Use the existing `PageHeader`, `Button`, and one individual `Card` for the
`解压小工具` item. Use `PackageOpen`, `RefreshCw`, `ExternalLink`, and
`ShieldCheck` from `lucide-react`. Show these states:

```text
正在检查本机助手
本机助手未启动
本机助手已连接
未检测到 WinRAR
```

The primary action is always `打开解压小工具`; offline state additionally
exposes `重试连接` and the code-formatted local command
`npm run toolbox:local`. Do not place password or file controls in the
workspace page.

- [ ] **Step 5: Add the navigation item**

Import `Wrench` from `lucide-react` and insert:

```ts
{ href: "/toolbox", label: "工具箱", icon: Wrench, iconClass: "text-[#64a85c]" },
```

before `设置`. Keep `BOTTOM_NAV_HREFS` unchanged.

- [ ] **Step 6: Verify Task 6**

Run the focused UI tests. Expected: PASS with `工具箱` present in desktop and
mobile menus and absent from the four-item bottom navigation.

---

### Task 7: Integration Smoke Tests And Final Verification

**Files:**
- Create: `tools/local-toolbox/integration-smoke.ts`
- Create: `src/tests/local-toolbox-privacy-boundary.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a disposable local smoke command and documented launch workflow.

- [ ] **Step 1: Write failing privacy-boundary assertions**

Read the workspace toolbox component/client and helper client script as text.
Assert:

```ts
expect(workspaceSource).not.toMatch(/password|selectionPath|FormData|FileReader/);
expect(helperClientSource).not.toContain("ai.mislw.cn/api");
expect(helperServerSource).toContain('"127.0.0.1"');
expect(helperServerSource).not.toMatch(/listen\\([^)]*0\\.0\\.0\\.0/);
```

- [ ] **Step 2: Run the privacy test and verify RED**

```powershell
.\node_modules\.bin\vitest.cmd run src/tests/local-toolbox-privacy-boundary.test.ts
```

Expected: FAIL until every expected final source file exists.

- [ ] **Step 3: Add a disposable ordinary-archive smoke script**

The smoke script:

1. Finds WinRAR.
2. Creates a temporary text fixture containing only `local-toolbox-smoke`.
3. Uses WinRAR to create one password-free ZIP and one password-protected ZIP.
4. Runs the real archive job engine against both archives.
5. Verifies extracted bytes match the fixture.
6. Verifies source archives still exist.
7. Removes only the smoke test's own temporary root in `finally`.

Never point this script at `D:\xxzl` or other user data.

- [ ] **Step 4: Document local launch and privacy behavior**

Add a concise README section:

```markdown
## 本地工具箱

运行 `npm run toolbox:local`，或双击
`tools/local-toolbox/启动本地工具箱.cmd`。工作台的“工具箱”只负责检查和打开
本机页面；压缩文件、输出路径和密码不会上传到工作台、NAS 或云端。
```

Also document that WinRAR is required and that original archives are kept.

- [ ] **Step 5: Run focused verification**

```powershell
.\node_modules\.bin\vitest.cmd run `
  src/tests/local-toolbox-archive-core.test.ts `
  src/tests/local-toolbox-archive-discovery.test.ts `
  src/tests/local-toolbox-winrar.test.ts `
  src/tests/local-toolbox-archive-jobs.test.ts `
  src/tests/local-toolbox-helper.test.ts `
  src/tests/local-toolbox-helper-ui.test.ts `
  src/tests/toolbox-page.test.tsx `
  src/tests/local-toolbox-privacy-boundary.test.ts `
  src/tests/navigation-performance.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 6: Run integration smoke**

```powershell
node --import tsx tools/local-toolbox/integration-smoke.ts
```

Expected: both disposable ZIP jobs complete, extracted bytes match, source
archives remain, and the temporary root is removed.

- [ ] **Step 7: Run repository verification**

```powershell
npm run typecheck
npm test
npm run build
```

Expected: all commands exit `0`. Record any unrelated baseline failure
separately instead of modifying unrelated files.

- [ ] **Step 8: Perform local browser acceptance**

1. Start `npm run toolbox:local`.
2. Start the workspace on an unused local port if port 3000 is occupied.
3. Open `/toolbox` in desktop and mobile-sized browser viewports.
4. Confirm no overlap, clipped labels, nested cards, or bottom-nav changes.
5. Open the local helper from the tool row.
6. Verify ordinary ZIP, incorrect-suffix 7z, numeric split 7z, and a nested
   archive using local test data or user-authorized data.
7. In browser network tools, confirm no archive bytes, local paths, or
   passwords are sent to the workspace origin.
8. Stop all helper/dev-server sessions started for validation.

- [ ] **Step 9: Review the final diff without committing**

```powershell
git status --short
git diff -- `
  package.json `
  README.md `
  src/app/(app)/toolbox/page.tsx `
  src/components/toolbox `
  src/lib/local-toolbox `
  src/components/layout/nav.tsx `
  src/tests/local-toolbox-* `
  src/tests/toolbox-page.test.tsx `
  src/tests/navigation-performance.test.tsx `
  tools/local-toolbox `
  docs/superpowers/specs/2026-09-06-local-toolbox-archive-extractor-design.md `
  docs/superpowers/plans/2026-09-06-local-toolbox-archive-extractor.md
```

Expected: only the approved toolbox scope is included. Leave all changes
uncommitted and unpushed.
