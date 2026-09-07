import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (filePath: string) =>
  readFileSync(path.join(root, filePath), "utf8");

describe("desktop local toolbox bundle", () => {
  it("prepares and bundles a private helper runtime before desktop builds", () => {
    const desktopPackage = JSON.parse(read("apps/desktop/package.json"));
    const tauriConfig = read("apps/desktop/tauri.conf.json");
    const prepareScript = read("apps/desktop/scripts/prepare-local-toolbox.mjs");

    expect(desktopPackage.scripts.build).toContain("npm run prepare:toolbox");
    expect(desktopPackage.scripts["prepare:toolbox"]).toContain(
      "prepare-local-toolbox.mjs",
    );
    expect(tauriConfig).toContain('"resources/local-toolbox/**/*"');
    expect(prepareScript).toContain("esbuild");
    expect(prepareScript).toContain("process.execPath");
    expect(prepareScript).toContain("archive-helper.ts");
    expect(prepareScript).toContain("7zip-bin");
    expect(prepareScript).toContain("7za.exe");
  });

  it("starts the bundled helper and injects its dynamic origin", () => {
    const main = read("apps/desktop/src/main.rs");

    expect(main).toContain("--port");
    expect(main).toContain("--parent-pid");
    expect(main).toContain('.env("LOCAL_TOOLBOX_ORIGIN"');
    expect(main).toContain(
      "__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__",
    );
    expect(main).toContain(".on_page_load(");
    expect(main).toContain("retryButton.click()");
  });
});
