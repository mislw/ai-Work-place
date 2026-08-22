import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "../..");

describe("NAS production build configuration", () => {
  it("exports standalone output for the runtime Docker image", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'const { default: config } = await import("./next.config.mjs");',
          "process.stdout.write(JSON.stringify({ output: config.output }));",
        ].join(" "),
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ output: "standalone" });
  });
});
