import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("crayon post-login theme", () => {
  it("mounts the shared crayon shell only in the authenticated layout", () => {
    const appLayout = readSource("src/app/(app)/layout.tsx");
    const loginPage = readSource("src/app/(auth)/login/login-form.tsx");

    expect(appLayout).toContain("crayon-shell");
    expect(loginPage).not.toContain("crayon-shell");
  });

  it("defines the paper surface and primary crayon color tokens", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toContain("--crayon-red");
    expect(css).toContain("--crayon-blue");
    expect(css).toContain(".crayon-paper");
  });

  it.each([
    ["workspace", "src/app/(app)/workspace/page.tsx"],
    ["assistant", "src/components/assistant/native-assistant.tsx"],
    ["calendar", "src/app/(app)/calendar/page.tsx"],
    ["todos", "src/app/(app)/todos/page.tsx"],
    ["notes", "src/app/(app)/notes/page.tsx"],
    ["documents", "src/app/(app)/documents/page.tsx"],
    ["settings", "src/app/(app)/settings/page.tsx"],
  ])("marks the %s scene for visual QA", (scene, relativePath) => {
    expect(readSource(relativePath)).toContain(`data-crayon-page=\"${scene}\"`);
  });

  it("uses project-local decorative assets instead of remote image hotlinks", () => {
    const relativePath = "src/components/common/crayon-decoration.tsx";
    expect(fs.existsSync(path.join(projectRoot, relativePath))).toBe(true);
    const decoration = readSource(relativePath);

    expect(decoration).toContain('src={`/crayon/${asset}`}');
    expect(decoration).not.toMatch(/https?:\/\//);
  });
});
