import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findWinRar,
  runWinRar,
} from "../../tools/local-toolbox/winrar";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local toolbox WinRAR adapter", () => {
  it("omits the password argument for a password-free archive", async () => {
    const spawnProcess = vi.fn().mockResolvedValue(0);

    await runWinRar("test", {
      executable: "C:/Program Files/WinRAR/WinRAR.exe",
      archivePath: "D:/download/course.zip",
      password: "",
      spawnProcess,
    });

    expect(spawnProcess.mock.calls[0]![1]).toEqual([
      "t",
      "-ibck",
      "-inul",
      "-y",
      "D:/download/course.zip",
    ]);
  });

  it("passes a password and a trailing separator for extraction", async () => {
    const spawnProcess = vi.fn().mockResolvedValue(0);

    await runWinRar("extract", {
      executable: "WinRAR.exe",
      archivePath: "D:/download/course.7z",
      destinationPath: "D:/download/course",
      password: "secret.",
      spawnProcess,
    });

    expect(spawnProcess.mock.calls[0]![1]).toEqual([
      "x",
      "-ibck",
      "-inul",
      "-y",
      "-psecret.",
      "D:/download/course.7z",
      `D:/download/course${path.sep}`,
    ]);
  });

  it("maps WinRAR exit code 11 to a password request", async () => {
    const result = await runWinRar("test", {
      executable: "WinRAR.exe",
      archivePath: "D:/download/course.7z",
      password: "secret.",
      spawnProcess: vi.fn().mockResolvedValue(11),
    });

    expect(result).toEqual({
      ok: false,
      code: 11,
      reason: "wrong_password",
    });
  });

  it("maps unexpected process failures without exposing arguments", async () => {
    const result = await runWinRar("test", {
      executable: "WinRAR.exe",
      archivePath: "D:/download/course.rar",
      password: "do-not-log-this",
      spawnProcess: vi.fn().mockResolvedValue(3),
    });

    expect(result).toEqual({ ok: false, code: 3, reason: "failed" });
    expect(JSON.stringify(result)).not.toContain("do-not-log-this");
  });

  it("prefers Program Files before Program Files (x86) and PATH", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-winrar-"));
    roots.push(root);
    const programFiles = path.join(root, "Program Files");
    const programFilesX86 = path.join(root, "Program Files (x86)");
    const pathDirectory = path.join(root, "bin");
    await Promise.all([
      mkdir(path.join(programFiles, "WinRAR"), { recursive: true }),
      mkdir(path.join(programFilesX86, "WinRAR"), { recursive: true }),
      mkdir(pathDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(programFiles, "WinRAR", "WinRAR.exe"), ""),
      writeFile(path.join(programFilesX86, "WinRAR", "WinRAR.exe"), ""),
      writeFile(path.join(pathDirectory, "WinRAR.exe"), ""),
    ]);

    await expect(
      findWinRar({
        NODE_ENV: "test",
        ProgramFiles: programFiles,
        "ProgramFiles(x86)": programFilesX86,
        PATH: pathDirectory,
      }),
    ).resolves.toBe(path.join(programFiles, "WinRAR", "WinRAR.exe"));
  });
});
