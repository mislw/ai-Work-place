import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("local toolbox privacy boundary", () => {
  it("keeps file and password controls out of the workspace page", () => {
    const workspaceSource = [
      read("src/app/(app)/toolbox/page.tsx"),
      read("src/components/toolbox/archive-extractor-tool.tsx"),
      read("src/lib/local-toolbox/client.ts"),
    ].join("\n");

    expect(workspaceSource).not.toMatch(
      /selectionPath|FormData|FileReader|type=["']password["']/,
    );
  });

  it("keeps helper mutations relative and binds only to loopback", () => {
    const helperClientSource = read("tools/local-toolbox/public/app.js");
    const helperServerSource = read("tools/local-toolbox/archive-helper.ts");

    expect(helperClientSource).not.toContain("ai.mislw.cn/api");
    expect(helperClientSource).not.toContain("localhost:3000");
    expect(helperServerSource).toContain('server.listen(port, "127.0.0.1"');
    expect(helperServerSource).not.toMatch(/listen\([^)]*0\.0\.0\.0/);
  });

  it("never exposes an API that accepts a browser path", () => {
    const helperServerSource = read("tools/local-toolbox/archive-helper.ts");

    expect(helperServerSource).toContain("CLIENT_PATH_REJECTED");
    expect(helperServerSource).toContain("selectionId");
    expect(helperServerSource).not.toContain("body.outputPath");
  });
});
