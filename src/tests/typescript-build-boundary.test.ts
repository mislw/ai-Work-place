import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "../..");

describe("application TypeScript build boundary", () => {
  it("does not typecheck the independently built Harness Gateway service", () => {
    const configPath = path.join(projectRoot, "tsconfig.json");
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      projectRoot,
      undefined,
      configPath,
    );
    const gatewaySources = parsed.fileNames
      .map((fileName) => path.relative(projectRoot, fileName).replaceAll("\\", "/"))
      .filter((fileName) =>
        fileName.startsWith("services/harness-gateway/src/"),
      );

    expect(configFile.error).toBeUndefined();
    expect(gatewaySources).toEqual([]);
  });
});
