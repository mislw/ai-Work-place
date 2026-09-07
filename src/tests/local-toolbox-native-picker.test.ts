import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockedSpawn = vi.fn();
  return {
    ...actual,
    spawn: mockedSpawn,
    default: { ...actual, spawn: mockedSpawn },
  };
});

import { spawn } from "node:child_process";
import { pickWindowsPath } from "../../tools/local-toolbox/native-picker";

describe("local toolbox native picker", () => {
  it("decodes a Unicode path from the ASCII-safe picker protocol", async () => {
    const selectedPath = "D:\\xxzl\\新建文件夹-260906-110310545";
    const encodedPath = Buffer.from(selectedPath, "utf16le").toString("base64");
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout });
    vi.mocked(spawn).mockReturnValue(
      child as unknown as ReturnType<typeof spawn>,
    );

    const result = pickWindowsPath("folder");
    stdout.end(encodedPath);
    await new Promise<void>((resolve) => stdout.once("end", resolve));
    child.emit("close", 0);

    await expect(result).resolves.toBe(selectedPath);
  });
});
