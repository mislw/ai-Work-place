# Windows Online Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Windows Tauri client that loads the existing online workspace and shares its synchronized data.

**Architecture:** A small Tauri 2 shell owns connectivity checks and navigation policy while the existing HTTPS Next.js application remains the only business UI and data client. The shell exposes no native commands to remote content and bundles only a local connection-status page.

**Tech Stack:** Rust 1.97, Tauri 2, Windows WebView2, reqwest, url, existing Next.js/Supabase service.

**Spec:** `docs/superpowers/specs/2026-09-06-windows-online-desktop-app-design.md`

## Global Constraints

- Release workspace URL must use HTTPS.
- Default workspace URL is `https://ai.mislw.cn`.
- Do not create an offline business database or a second synchronization path.
- Do not expose Tauri IPC, shell, filesystem, process, or arbitrary native commands to remote content.
- Keep all implementation under `apps/desktop/` except optional root package scripts and documentation.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Desktop URL And Navigation Policy

**Files:**
- Create: `apps/desktop/Cargo.toml`
- Create: `apps/desktop/build.rs`
- Create: `apps/desktop/src/lib.rs`
- Test: inline Rust unit tests in `apps/desktop/src/lib.rs`

**Interfaces:**
- Produces: `DesktopConfig::from_workspace_url(&str) -> Result<DesktopConfig, ConfigError>`.
- Produces: `DesktopConfig::health_url() -> Url`.
- Produces: `DesktopConfig::classify_navigation(&Url) -> NavigationDecision`.

- [ ] Write tests that reject HTTP release URLs, produce `/api/health`, keep same-origin navigation internal, and classify other HTTPS origins as external.
- [ ] Run `cargo test --manifest-path apps/desktop/Cargo.toml` and confirm the tests fail because the types do not exist.
- [ ] Implement the minimal URL and navigation policy.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Connectivity Monitor And Tauri Window

**Files:**
- Create: `apps/desktop/src/main.rs`
- Create: `apps/desktop/src/connectivity.rs`
- Create: `apps/desktop/tauri.conf.json`
- Create: `apps/desktop/capabilities/default.json`
- Create: `apps/desktop/frontend/index.html`
- Create: `apps/desktop/frontend/app.js`
- Create: `apps/desktop/frontend/styles.css`
- Test: inline Rust unit tests in `apps/desktop/src/connectivity.rs`

**Interfaces:**
- Consumes: `DesktopConfig` and `NavigationDecision` from Task 1.
- Produces: `ConnectivityState::from_status(Result<StatusCode, Error>)`.
- Produces: one Tauri main window that starts locally and navigates online only after a successful health check.

- [ ] Write tests for healthy 2xx, unhealthy non-2xx, and request failure state mapping.
- [ ] Run the tests and confirm the new tests fail.
- [ ] Implement the connection-state mapper and background monitor.
- [ ] Add the local status UI with connecting, offline, and retry states.
- [ ] Configure an empty remote capability set and no privileged plugins.
- [ ] Run `cargo test` and `cargo check` for the desktop manifest.

### Task 3: Icons, Scripts, And Windows Bundle

**Files:**
- Create: `apps/desktop/icons/*`
- Create: `apps/desktop/README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run desktop:dev`, `npm run desktop:build`, and a Windows NSIS `.exe` bundle.

- [ ] Generate the required Tauri icon set from the existing project icon.
- [ ] Add root scripts that call Tauri with `apps/desktop/tauri.conf.json`.
- [ ] Document build URL override, local development, packaging, and the online-only boundary.
- [ ] Run `npm run desktop:build`.
- [ ] Verify the generated NSIS installer exists and is non-empty.

### Task 4: Final Verification

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: the completed desktop client and installer.
- Produces: verified test/build evidence and an explicit list of runtime checks completed or still pending.

- [ ] Run `cargo fmt --manifest-path apps/desktop/Cargo.toml --check`.
- [ ] Run `cargo test --manifest-path apps/desktop/Cargo.toml`.
- [ ] Run `cargo check --manifest-path apps/desktop/Cargo.toml`.
- [ ] Launch the unpackaged App and confirm the local state window renders.
- [ ] With the configured service reachable, confirm navigation to the workspace.
- [ ] Record whether real login, cross-client Realtime, Hermes, and knowledge upload were exercised; do not infer them from build success.
