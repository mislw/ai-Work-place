# Local Toolbox Archive Extractor Design

## Goal

Add a small "工具箱" area to the existing Personal AI Workspace. The first
tool is named "解压小工具" and is a Windows-only local archive extractor that:

- accepts a file or folder selected through a native Windows picker;
- asks for a password for the current extraction job;
- handles normal ZIP, RAR, and 7z archives, with or without a password;
- detects archives hidden behind incorrect suffixes such as `.pdf`;
- handles `.7z.001/.002/.003` split archives, including parts found in
  different child folders;
- continues through nested archives that require more than one extraction;
- never uploads archive bytes, extracted files, file paths, or passwords to
  the workspace server or NAS.

## Existing Constraints

- The workspace is a Next.js website/PWA and is also deployed in a Linux
  container.
- The current browser and Hermes web bridges can select browser files, but
  they cannot expose real Windows paths or execute WinRAR locally.
- The existing knowledge upload flow sends file bytes to the server and has a
  50 MB-oriented browser contract, so it must not be reused for large private
  archives.
- The repository currently has unrelated uncommitted work. This feature must
  touch only its own files plus the shared navigation and focused tests.

## User Experience

### Workspace

- Add a sidebar and mobile-menu entry named `工具箱` at `/toolbox`.
- The page uses the existing compact workbench layout and contains individual
  tool rows rather than a marketing landing page.
- The first row is `解压小工具`, with local-helper status and one clear launch
  action. Keep the launch action available even when the health check reports
  offline because direct loopback navigation may still succeed.
- When the helper is unavailable, show the local start command and a retry
  button. Do not present server upload as a fallback.

### Local Helper

- `启动本地工具箱.cmd` starts a loopback-only helper and opens its local page.
- The local page provides:
  - `选择文件` and `选择文件夹` buttons;
  - a password input that is cleared after the job;
  - a start button;
  - current stage, processed archive, success/failure counts, and output path;
  - an icon button to open the output folder after completion.
- The workspace tool row opens the helper page in a separate small browser
  window. This works from both `http://localhost:3000` and the deployed
  workspace without sending private values through the deployed page.

## Architecture

### Workspace UI

- `src/app/(app)/toolbox/page.tsx`
  renders the toolbox page and helper availability state.
- `src/components/toolbox/archive-extractor-tool.tsx`
  owns the `解压小工具` row, loopback health check, launch action, and
  unavailable state.
- `src/lib/local-toolbox/client.ts`
  contains the fixed loopback origin and validates helper health responses.
- `src/components/layout/nav.tsx`
  adds the `工具箱` navigation item. It is available in the desktop sidebar
  and mobile menu, but not added to the four-item mobile bottom bar.

### Windows Helper

- `tools/local-toolbox/archive-helper.ts`
  runs an HTTP server bound only to `127.0.0.1`.
- `tools/local-toolbox/archive-core.ts`
  contains archive signature detection, suffix correction, split-part
  grouping, output naming, nested-work discovery, and WinRAR invocation.
- `tools/local-toolbox/public/`
  contains a small local HTML/CSS/JavaScript interface served by the helper.
- `tools/local-toolbox/启动本地工具箱.cmd`
  starts the helper through the Node runtime available on this Windows machine.
- `package.json`
  adds `toolbox:local` for development and direct launch.

The helper opens native file/folder pickers through Windows PowerShell. The
browser never supplies an arbitrary filesystem path to the helper.

## Local Protocol And Security

- Bind only to `127.0.0.1`; never listen on LAN interfaces.
- `GET /health` returns only helper version and WinRAR availability.
- Job endpoints accept requests only from the helper's own local page.
- Reject cross-origin mutation requests and requests without JSON content
  type plus the helper-specific header.
- Do not serve directory listings or arbitrary local files.
- Do not accept a client-provided filesystem path; paths must come from the
  native picker opened by the helper.
- Passwords are held only for the active job and are not written to files or
  logs. WinRAR receives the password transiently for extraction.
- Logs contain stages and sanitized error codes, not passwords or private
  filenames.

## Extraction Rules

1. Read only the leading bytes needed to identify 7z, ZIP, or RAR.
2. Extract normal ZIP, RAR, and 7z archives directly, including archives that
   do not require a password.
3. If a regular file has the wrong suffix, rename it to the detected archive
   suffix. Generate a timestamped name instead of overwriting an existing
   file.
4. Recognize numeric split parts and require a continuous sequence beginning
   at `.001`.
5. If matching parts are spread across child folders, copy them into a
   helper-owned temporary directory. Preserve all source files.
6. Test the archive before extraction.
7. Extract to a same-name sibling directory. Generate a timestamped directory
   when the preferred target already exists.
8. Scan only the newly created output for nested archives and repeat, with a
   maximum depth of 10.
9. If a nested archive rejects the current password, pause the job and allow
   the local page to submit a replacement password.
10. Keep archives, split parts, filler files, and extracted output. Delete only
   helper-created temporary copies after the job ends.

## Error Handling

- Missing WinRAR: show its expected install location and do not start a job.
- Wrong password: keep existing output untouched and request another password.
- Missing split part: report the missing number before extraction.
- Corrupt archive: stop that archive, preserve all source files, and continue
  only when doing so cannot confuse nested output ownership.
- Existing destination: create a unique destination; never overwrite.
- Helper unavailable: the workspace page remains usable and reports the local
  tool as offline.

## Testing

- Vitest tests cover toolbox navigation, page states, health-response
  validation, and launch behavior.
- Node tests cover signature detection, suffix naming, split grouping,
  continuity checks, nested depth, and collision-safe destinations.
- Integration tests create disposable, non-private archives and verify:
  - incorrect suffix correction;
  - ordinary password-free ZIP, RAR, and 7z extraction;
  - password-protected extraction;
  - same-folder and cross-folder split parts;
  - two-level nested extraction;
  - source preservation and temporary-copy cleanup.
- Manual acceptance verifies the local helper from both the local workspace
  and the deployed toolbox entry, with browser developer tools confirming
  that archive bytes, paths, and passwords are not sent to the workspace
  origin.

## Out Of Scope

- Uploading archives to the knowledge base.
- Running extraction on NAS or Linux.
- Public multi-user archive processing.
- Deleting source archives automatically.
- Packaging a signed Windows installer in the first delivery.
