import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArchiveJob } from "./archive-jobs";
import { findWinRar } from "./winrar";

const fixtureContents = "local-toolbox-smoke";
const protectedPassword = "local-toolbox-smoke-password";

async function runProcess(executable: string, args: string[]): Promise<void> {
  const code = await new Promise<number>((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(-1));
    child.once("close", (exitCode) => resolve(exitCode ?? -1));
  });
  if (code !== 0) throw new Error(`SMOKE_ARCHIVE_CREATE_FAILED_${code}`);
}

async function createZip(
  winRarPath: string,
  archivePath: string,
  fixturePath: string,
  password: string,
): Promise<void> {
  const args = ["a", "-afzip", "-ep1", "-ibck", "-inul", "-y"];
  if (password) args.push(`-p${password}`);
  args.push(archivePath, fixturePath);
  await runProcess(winRarPath, args);
}

async function runJob(
  archivePath: string,
  password: string,
  winRarPath: string,
  temporaryRoot: string,
): Promise<string> {
  const job = createArchiveJob({
    selectionPath: archivePath,
    password,
    winRarPath,
    temporaryRoot,
  });
  await job.start();
  const snapshot = job.snapshot();
  if (snapshot.status !== "completed" || snapshot.successCount !== 1) {
    throw new Error("SMOKE_EXTRACTION_FAILED");
  }
  if (!snapshot.primaryOutputPath) throw new Error("SMOKE_OUTPUT_MISSING");
  return snapshot.primaryOutputPath;
}

async function main(): Promise<void> {
  const winRarPath = await findWinRar();
  if (!winRarPath) throw new Error("SMOKE_WINRAR_NOT_FOUND");

  const root = await mkdtemp(path.join(os.tmpdir(), "local-toolbox-smoke-"));
  try {
    const fixturePath = path.join(root, "fixture.txt");
    const openArchive = path.join(root, "open.zip");
    const protectedArchive = path.join(root, "protected.zip");
    await writeFile(fixturePath, fixtureContents);
    await createZip(winRarPath, openArchive, fixturePath, "");
    await createZip(winRarPath, protectedArchive, fixturePath, protectedPassword);

    const openOutput = await runJob(
      openArchive,
      "",
      winRarPath,
      path.join(root, "temporary"),
    );
    const protectedOutput = await runJob(
      protectedArchive,
      protectedPassword,
      winRarPath,
      path.join(root, "temporary"),
    );

    const openContents = await readFile(path.join(openOutput, "fixture.txt"), "utf8");
    const protectedContents = await readFile(
      path.join(protectedOutput, "fixture.txt"),
      "utf8",
    );
    if (openContents !== fixtureContents || protectedContents !== fixtureContents) {
      throw new Error("SMOKE_CONTENT_MISMATCH");
    }
    await access(openArchive);
    await access(protectedArchive);
    process.stdout.write("LOCAL_TOOLBOX_SMOKE_OK\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "SMOKE_UNKNOWN_FAILURE";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
