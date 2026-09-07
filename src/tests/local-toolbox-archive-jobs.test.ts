import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveCandidate } from "../../tools/local-toolbox/archive-discovery";
import {
  createArchiveJob,
  type ArchiveJobInput,
} from "../../tools/local-toolbox/archive-jobs";

type RegularArchiveCandidate = Extract<ArchiveCandidate, { kind: "regular" }>;

const roots: string[] = [];

async function createRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createRegularCandidate(
  root: string,
  name = "course.zip",
): Promise<RegularArchiveCandidate> {
  const archivePath = path.join(root, name);
  await writeFile(archivePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return { kind: "regular", path: archivePath, outputParentPath: root };
}

function testJobInput(
  input: Partial<ArchiveJobInput> & Pick<ArchiveJobInput, "selectionPath">,
): ArchiveJobInput {
  const sharedArchiveRunner = input.runWinRar;
  return {
    password: "initial.",
    winRarPath: "WinRAR.exe",
    sevenZipPath: "7za.exe",
    temporaryRoot: path.join(path.dirname(input.selectionPath), "temporary"),
    ...(sharedArchiveRunner ? { runSevenZip: sharedArchiveRunner } : {}),
    ...input,
  };
}

describe("local toolbox archive jobs", () => {
  it("reports extraction progress and reaches one hundred percent", async () => {
    const root = await createRoot("local-toolbox-job-progress-");
    const candidate = await createRegularCandidate(root);
    let finishExtraction!: () => void;
    const extractionPending = new Promise<void>((resolve) => {
      finishExtraction = resolve;
    });
    const runWinRar = vi.fn(async (command: "test" | "extract") => {
      if (command === "extract") await extractionPending;
      return { ok: true, code: 0, reason: "success" as const };
    });
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        discoverNested: vi.fn().mockResolvedValue([]),
        runWinRar,
      }),
    );

    const started = job.start();
    await vi.waitFor(() => expect(runWinRar).toHaveBeenCalledTimes(2));

    expect(job.snapshot()).toMatchObject({
      status: "extracting",
      progressPercent: 50,
    });

    finishExtraction();
    await started;

    expect(job.snapshot()).toMatchObject({
      status: "completed",
      progressPercent: 100,
    });
  });

  it("pauses for another password without discarding the selected job", async () => {
    const root = await createRoot("local-toolbox-job-password-");
    const candidate = await createRegularCandidate(root);
    const runWinRar = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 11, reason: "wrong_password" })
      .mockResolvedValueOnce({ ok: true, code: 0, reason: "success" })
      .mockImplementationOnce(async (_command, input) => {
        await writeFile(path.join(input.destinationPath, "lesson.txt"), "content");
        return { ok: true, code: 0, reason: "success" };
      });
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        discoverNested: vi.fn().mockResolvedValue([]),
        runWinRar,
      }),
    );

    await job.start();
    expect(job.snapshot()).toMatchObject({
      status: "needs_password",
      progressPercent: 15,
    });
    expect(JSON.stringify(job.snapshot())).not.toContain("initial.");

    await job.providePassword("replacement.");
    expect(job.snapshot()).toMatchObject({
      status: "completed",
      successCount: 1,
      processedArchives: 1,
    });
    expect(runWinRar.mock.calls[1]![1].password).toBe("replacement.");
    expect(JSON.stringify(job.snapshot())).not.toContain("replacement.");
  });

  it("removes only the job-created output when extraction rejects the password", async () => {
    const root = await createRoot("local-toolbox-job-extract-password-");
    const candidate = await createRegularCandidate(root);
    const existingDirectory = path.join(root, "existing-output");
    await mkdir(existingDirectory);
    await writeFile(path.join(existingDirectory, "keep.txt"), "keep");
    const runWinRar = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, code: 0, reason: "success" })
      .mockImplementationOnce(async (_command, input) => {
        await writeFile(path.join(input.destinationPath, "partial.txt"), "partial");
        return { ok: false, code: 11, reason: "wrong_password" };
      })
      .mockResolvedValueOnce({ ok: true, code: 0, reason: "success" })
      .mockImplementationOnce(async (_command, input) => {
        await writeFile(path.join(input.destinationPath, "lesson.txt"), "content");
        return { ok: true, code: 0, reason: "success" };
      });
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        discoverNested: vi.fn().mockResolvedValue([]),
        runWinRar,
      }),
    );

    await job.start();
    expect(job.snapshot()).toMatchObject({
      status: "needs_password",
      progressPercent: 50,
    });
    expect(await readdir(root)).toEqual(
      expect.arrayContaining(["course.zip", "existing-output"]),
    );
    expect(await readdir(root)).not.toContain("course");

    await job.providePassword("replacement.");

    expect(job.snapshot()).toMatchObject({
      status: "completed",
      outputPaths: [path.join(root, "course")],
      successCount: 1,
    });
    await expect(readFile(path.join(existingDirectory, "keep.txt"), "utf8")).resolves.toBe(
      "keep",
    );
    expect(await readdir(root)).toEqual(
      expect.arrayContaining(["course.zip", "course", "existing-output"]),
    );
  });

  it("renames a disguised archive and preserves an existing destination", async () => {
    const root = await createRoot("local-toolbox-job-disguised-");
    const candidate = await createRegularCandidate(root, "course.pdf");
    await writeFile(
      candidate.path,
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    );
    await mkdir(path.join(root, "course"));
    const runWinRar = vi.fn().mockImplementation(async (command, input) => {
      if (command === "extract") {
        await writeFile(path.join(input.destinationPath, "lesson.txt"), "content");
      }
      return { ok: true, code: 0, reason: "success" };
    });
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        discoverNested: vi.fn().mockResolvedValue([]),
        runWinRar,
        now: () => new Date(2026, 8, 6, 8, 9, 10),
      }),
    );

    await job.start();

    const snapshot = job.snapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.outputPaths[0]).toBe(
      path.join(root, "course_20260906_080910"),
    );
    await expect(readFile(path.join(root, "course.7z"))).resolves.toBeTruthy();
    await expect(readFile(path.join(root, "course.pdf"))).rejects.toThrow();
    expect(runWinRar.mock.calls[0]![1].archivePath).toBe(
      path.join(root, "course.7z"),
    );
  });

  it("uses 7-Zip for a 7z archive when the dedicated engine is available", async () => {
    const root = await createRoot("local-toolbox-job-sevenzip-");
    const candidate = await createRegularCandidate(root, "course.7z");
    await writeFile(
      candidate.path,
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    );
    const runWinRar = vi.fn();
    const runSevenZip = vi.fn().mockImplementation(async (command, input) => {
      if (command === "extract") {
        await writeFile(path.join(input.destinationPath, "lesson.txt"), "content");
      }
      return { ok: true, code: 0, reason: "success" as const };
    });
    const input = testJobInput({
      selectionPath: candidate.path,
      discoverCandidates: vi.fn().mockResolvedValue([candidate]),
      discoverNested: vi.fn().mockResolvedValue([]),
      runWinRar,
    }) as ArchiveJobInput & {
      sevenZipPath: string;
      runSevenZip: typeof runSevenZip;
    };
    input.sevenZipPath = "7za.exe";
    input.runSevenZip = runSevenZip;

    const job = createArchiveJob(input);
    await job.start();

    expect(job.snapshot()).toMatchObject({ status: "completed", successCount: 1 });
    expect(runSevenZip).toHaveBeenCalledTimes(2);
    expect(runWinRar).not.toHaveBeenCalled();
  });

  it("stops nested discovery at depth ten without scanning depth eleven", async () => {
    const root = await createRoot("local-toolbox-job-depth-");
    const first = await createRegularCandidate(root);
    const runWinRar = vi.fn().mockImplementation(async (command, input) => {
      if (command === "extract") {
        await writeFile(path.join(input.destinationPath, "content.txt"), "content");
      }
      return { ok: true, code: 0, reason: "success" };
    });
    const discoverNested = vi.fn(async ({ outputPath, depth }) => {
      const nestedPath = path.join(outputPath, `nested-${depth}.7z`);
      await writeFile(nestedPath, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
      return [
        { kind: "regular", path: nestedPath, outputParentPath: outputPath },
      ] satisfies ArchiveCandidate[];
    });
    const job = createArchiveJob(
      testJobInput({
        selectionPath: first.path,
        discoverCandidates: vi.fn().mockResolvedValue([first]),
        discoverNested,
        runWinRar,
      }),
    );

    await job.start();

    expect(job.snapshot().failures).toContainEqual(
      expect.objectContaining({ code: "NESTED_DEPTH_EXCEEDED" }),
    );
    expect(discoverNested).toHaveBeenCalledTimes(10);
    expect(job.snapshot().successCount).toBe(11);
  });

  it("reports a processing failure truthfully during the initial run", async () => {
    const root = await createRoot("local-toolbox-job-processing-");
    const candidate = await createRegularCandidate(root);
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        prepareCandidate: vi.fn().mockRejectedValue(new Error("staging failed")),
      }),
    );

    await job.start();

    expect(job.snapshot()).toMatchObject({
      status: "failed",
      failures: [{ code: "ARCHIVE_PROCESSING_FAILED" }],
    });
  });

  it("clears the replacement password when resumed processing fails", async () => {
    const root = await createRoot("local-toolbox-job-resume-failure-");
    const candidate = await createRegularCandidate(root);
    const runWinRar = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 11, reason: "wrong_password" })
      .mockRejectedValueOnce(new Error("process failed"));
    const job = createArchiveJob(
      testJobInput({
        selectionPath: candidate.path,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        runWinRar,
      }),
    );

    await job.start();
    await expect(job.providePassword("replacement.")).resolves.toBeUndefined();

    expect(job.snapshot()).toMatchObject({
      status: "failed",
      progressPercent: 15,
      failures: [{ code: "ARCHIVE_PROCESSING_FAILED" }],
    });
    expect(JSON.stringify(job.snapshot())).not.toContain("replacement.");
  });

  it("cleans staged split copies after a password pause", async () => {
    const root = await createRoot("local-toolbox-job-split-");
    const temporaryDirectory = path.join(root, "temporary", "staged");
    await mkdir(temporaryDirectory, { recursive: true });
    const sourcePath = path.join(root, "course.7z.001");
    const stagedPath = path.join(temporaryDirectory, "course.7z.001");
    await Promise.all([writeFile(sourcePath, "source"), writeFile(stagedPath, "copy")]);
    const candidate: ArchiveCandidate = {
      kind: "split",
      firstPartPath: sourcePath,
      sourcePaths: [sourcePath],
      outputParentPath: root,
    };
    const stagedCandidate: ArchiveCandidate = {
      ...candidate,
      firstPartPath: stagedPath,
      temporaryDirectory,
    };
    const cleanupCandidate = vi.fn().mockResolvedValue(undefined);
    const job = createArchiveJob(
      testJobInput({
        selectionPath: sourcePath,
        discoverCandidates: vi.fn().mockResolvedValue([candidate]),
        prepareCandidate: vi.fn().mockResolvedValue(stagedCandidate),
        cleanupCandidate,
        runWinRar: vi
          .fn()
          .mockResolvedValue({ ok: false, code: 11, reason: "wrong_password" }),
      }),
    );

    await job.start();

    expect(job.snapshot().status).toBe("needs_password");
    expect(cleanupCandidate).toHaveBeenCalledWith(stagedCandidate);
  });
});
