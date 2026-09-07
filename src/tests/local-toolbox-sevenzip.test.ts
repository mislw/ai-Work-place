import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findSevenZip, runSevenZip } from "../../tools/local-toolbox/sevenzip";

describe("local toolbox 7-Zip adapter", () => {
  it("passes password and output directory without exposing them in the result", async () => {
    const spawnProcess = vi.fn().mockResolvedValue({ code: 0, output: "" });

    const result = await runSevenZip("extract", {
      executable: "7za.exe",
      archivePath: "D:/private/course.7z.001",
      destinationPath: "D:/private/course",
      password: "secret.",
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenCalledWith("7za.exe", [
      "x",
      "-y",
      "-bd",
      "-psecret.",
      `-oD:/private/course`,
      "D:/private/course.7z.001",
    ]);
    expect(result).toEqual({ ok: true, code: 0, reason: "success" });
    expect(JSON.stringify(result)).not.toContain("secret.");
  });

  it("maps encrypted data errors to a password request", async () => {
    const result = await runSevenZip("test", {
      executable: "7za.exe",
      archivePath: "D:/private/course.7z.001",
      password: "wrong",
      spawnProcess: vi.fn().mockResolvedValue({
        code: 2,
        output: "ERROR: Data Error in encrypted file. Wrong password?",
      }),
    });

    expect(result).toEqual({ ok: false, code: 2, reason: "wrong_password" });
  });

  it("prefers the explicitly bundled executable", async () => {
    const bundledPath = path.join(process.cwd(), "node_modules", "7zip-bin", "win", process.arch, "7za.exe");

    await expect(
      findSevenZip({
        NODE_ENV: "test",
        LOCAL_TOOLBOX_7ZIP_PATH: bundledPath,
      }),
    ).resolves.toBe(bundledPath);
  });

  it("finds a 7-Zip executable beside the bundled helper", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-sevenzip-"));
    const helperPath = path.join(root, "helper.mjs");
    const adjacentPath = path.join(root, "7za.exe");
    const previousEntry = process.argv[1];
    try {
      await writeFile(adjacentPath, "binary");
      process.argv[1] = helperPath;

      await expect(findSevenZip({ NODE_ENV: "test" })).resolves.toBe(
        adjacentPath,
      );
    } finally {
      if (previousEntry === undefined) {
        delete process.argv[1];
      } else {
        process.argv[1] = previousEntry;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
