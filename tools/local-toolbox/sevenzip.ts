import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WinRarInput, WinRarResult } from "./winrar";

type SevenZipProcessResult = { code: number; output: string };

export type SpawnSevenZipProcess = (
  executable: string,
  args: string[],
) => Promise<SevenZipProcessResult>;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findSevenZip(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const helperDirectory = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : null;
  const candidates = [
    environment.LOCAL_TOOLBOX_7ZIP_PATH,
    helperDirectory ? path.join(helperDirectory, "7za.exe") : undefined,
    path.join(
      process.cwd(),
      "node_modules",
      "7zip-bin",
      "win",
      process.arch,
      "7za.exe",
    ),
  ];
  const programFiles = environment.ProgramFiles ?? environment.PROGRAMFILES;
  const programFilesX86 =
    environment["ProgramFiles(x86)"] ?? environment["PROGRAMFILES(X86)"];
  if (programFiles) candidates.push(path.join(programFiles, "7-Zip", "7z.exe"));
  if (programFilesX86) candidates.push(path.join(programFilesX86, "7-Zip", "7z.exe"));
  const pathValue = environment.PATH ?? environment.Path;
  if (pathValue) {
    for (const directory of pathValue.split(path.delimiter)) {
      if (directory) candidates.push(path.join(directory, "7z.exe"));
    }
  }
  for (const candidate of candidates) {
    if (candidate && (await fileExists(candidate))) return candidate;
  }
  return null;
}

const defaultSpawnProcess: SpawnSevenZipProcess = (executable, args) =>
  new Promise((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      if (output.length < 64 * 1024) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", () => resolve({ code: -1, output }));
    child.once("close", (code) => resolve({ code: code ?? -1, output }));
  });

export async function runSevenZip(
  command: "test" | "extract",
  input: WinRarInput & { spawnProcess?: SpawnSevenZipProcess },
): Promise<WinRarResult> {
  const args = [command === "test" ? "t" : "x", "-y", "-bd"];
  if (input.password) args.push(`-p${input.password}`);
  if (command === "extract") {
    if (!input.destinationPath) {
      throw new Error("7-Zip extraction requires a destination path.");
    }
    args.push(`-o${input.destinationPath}`);
  }
  args.push(input.archivePath);
  const result = await (input.spawnProcess ?? defaultSpawnProcess)(
    input.executable,
    args,
  );
  if (result.code === 0) return { ok: true, code: 0, reason: "success" };
  if (/wrong password|data error in encrypted file/i.test(result.output)) {
    return { ok: false, code: result.code, reason: "wrong_password" };
  }
  return { ok: false, code: result.code, reason: "failed" };
}
