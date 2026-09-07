import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type WinRarResult = {
  ok: boolean;
  code: number;
  reason: "success" | "wrong_password" | "failed";
};

export type SpawnProcess = (
  executable: string,
  args: string[],
  options: { windowsHide: boolean; stdio: "ignore" },
) => Promise<number>;

export type WinRarInput = {
  executable: string;
  archivePath: string;
  destinationPath?: string;
  password: string;
  spawnProcess?: SpawnProcess;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findWinRar(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const candidates: string[] = [];
  const programFiles = environment.ProgramFiles ?? environment.PROGRAMFILES;
  const programFilesX86 =
    environment["ProgramFiles(x86)"] ?? environment["PROGRAMFILES(X86)"];

  if (programFiles) {
    candidates.push(path.join(programFiles, "WinRAR", "WinRAR.exe"));
  }
  if (programFilesX86) {
    candidates.push(path.join(programFilesX86, "WinRAR", "WinRAR.exe"));
  }

  const pathValue = environment.PATH ?? environment.Path;
  if (pathValue) {
    for (const directory of pathValue.split(path.delimiter)) {
      if (directory) {
        candidates.push(path.join(directory, "WinRAR.exe"));
      }
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

const defaultSpawnProcess: SpawnProcess = (executable, args, options) =>
  new Promise((resolve) => {
    const child = spawn(executable, args, options);
    child.once("error", () => resolve(-1));
    child.once("close", (code) => resolve(code ?? -1));
  });

export async function runWinRar(
  command: "test" | "extract",
  input: WinRarInput,
): Promise<WinRarResult> {
  const args = [command === "test" ? "t" : "x", "-ibck", "-inul", "-y"];
  if (input.password) {
    args.push(`-p${input.password}`);
  }
  args.push(input.archivePath);

  if (command === "extract") {
    if (!input.destinationPath) {
      throw new Error("WinRAR extraction requires a destination path.");
    }
    const destination = input.destinationPath.endsWith(path.sep)
      ? input.destinationPath
      : `${input.destinationPath}${path.sep}`;
    args.push(destination);
  }

  const code = await (input.spawnProcess ?? defaultSpawnProcess)(
    input.executable,
    args,
    { windowsHide: true, stdio: "ignore" },
  );
  if (code === 0) {
    return { ok: true, code, reason: "success" };
  }
  if (code === 11) {
    return { ok: false, code, reason: "wrong_password" };
  }
  return { ok: false, code, reason: "failed" };
}
