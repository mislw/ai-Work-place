import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicRoot = path.resolve(__dirname, "../../tools/local-toolbox/public");

function readHelperAsset(fileName: string): string {
  return fs.readFileSync(path.join(publicRoot, fileName), "utf8");
}

describe("local toolbox helper UI", () => {
  it("provides separate file and folder selection commands", () => {
    const html = readHelperAsset("index.html");

    expect(html).toContain('data-action="pick-file"');
    expect(html).toContain('data-action="pick-folder"');
    expect(html).toContain('type="password"');
    expect(html).toContain("解压小工具");
  });

  it("uses only relative helper API requests", () => {
    const script = readHelperAsset("app.js");

    expect(script).toContain('request("/api/jobs"');
    expect(script).not.toContain("ai.mislw.cn");
    expect(script).not.toContain("localhost:3000");
    expect(script).not.toContain("127.0.0.1:37654");
  });

  it("clears passwords and polls only active jobs", () => {
    const script = readHelperAsset("app.js");

    expect(script).toContain('passwordInput.value = ""');
    expect(script).toContain("window.setTimeout(pollJob, 500)");
    expect(script).toContain('activeStatuses.has(snapshot.status)');
  });

  it("has stable controls for status and output actions", () => {
    const html = readHelperAsset("index.html");

    expect(html).toContain('data-role="status"');
    expect(html).toContain('data-role="processed"');
    expect(html).toContain('data-role="output"');
    expect(html).toContain('data-action="reveal-output"');
  });

  it("renders numeric job progress in a native progress bar", () => {
    const html = readHelperAsset("index.html");
    const script = readHelperAsset("app.js");

    expect(html).toContain('data-role="progress"');
    expect(html).toContain('data-role="progress-value"');
    expect(script).toContain("progressBar.value = snapshot.progressPercent");
    expect(script).toContain('progressValue.textContent = `${snapshot.progressPercent}%`');
  });

  it("renders actionable archive failure messages", () => {
    const script = readHelperAsset("app.js");

    expect(script).toContain("failureLabels");
    expect(script).toContain("SPLIT_PART_MISSING");
    expect(script).toContain("ARCHIVE_ENGINE_UNAVAILABLE");
    expect(script).toContain("snapshot.failures");
  });
});
