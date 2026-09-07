import { existsSync } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  detectArchiveKind,
  groupSplitParts,
  nextAvailablePath,
  preferredArchivePath,
} from "./archive-core";
import {
  cleanupTemporaryCandidate,
  discoverArchiveCandidates,
  stageSplitGroup,
  type ArchiveCandidate,
} from "./archive-discovery";
import {
  runWinRar as defaultRunWinRar,
  type WinRarInput,
  type WinRarResult,
} from "./winrar";
import { runSevenZip as defaultRunSevenZip } from "./sevenzip";

export type ArchiveJobStatus =
  | "queued"
  | "testing"
  | "extracting"
  | "needs_password"
  | "completed"
  | "failed";

export type ArchiveJobFailure = {
  code:
    | "ARCHIVE_DISCOVERY_FAILED"
    | "ARCHIVE_TEST_FAILED"
    | "ARCHIVE_EXTRACTION_FAILED"
    | "ARCHIVE_PROCESSING_FAILED"
    | "ARCHIVE_ENGINE_UNAVAILABLE"
    | "SPLIT_AMBIGUOUS"
    | "SPLIT_PART_MISSING"
    | "NESTED_DISCOVERY_FAILED"
    | "NESTED_DEPTH_EXCEEDED";
};

export type ArchiveJobSnapshot = {
  status: ArchiveJobStatus;
  progressPercent: number;
  processedArchives: number;
  successCount: number;
  failureCount: number;
  nonEmptyFileCount: number;
  failures: ArchiveJobFailure[];
  outputPaths: string[];
  primaryOutputPath: string | null;
};

type QueuedCandidate = { candidate: ArchiveCandidate; depth: number };

type RunWinRarDependency = (
  command: "test" | "extract",
  input: WinRarInput,
) => Promise<WinRarResult>;

export type ArchiveJobInput = {
  selectionPath: string;
  password: string;
  winRarPath: string | null;
  sevenZipPath?: string | null;
  temporaryRoot: string;
  discoverCandidates?: (selectionPath: string) => Promise<ArchiveCandidate[]>;
  discoverNested?: (input: {
    outputPath: string;
    depth: number;
  }) => Promise<ArchiveCandidate[]>;
  prepareCandidate?: (candidate: ArchiveCandidate) => Promise<ArchiveCandidate>;
  cleanupCandidate?: (candidate: ArchiveCandidate) => Promise<void>;
  runWinRar?: RunWinRarDependency;
  runSevenZip?: RunWinRarDependency;
  now?: () => Date;
};

export type ArchiveJob = {
  start(): Promise<void>;
  providePassword(password: string): Promise<void>;
  snapshot(): ArchiveJobSnapshot;
};

async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function archivePathOf(candidate: ArchiveCandidate): string {
  return candidate.kind === "regular" ? candidate.path : candidate.firstPartPath;
}

function preferredOutputName(candidate: ArchiveCandidate): string {
  const archivePath = archivePathOf(candidate);
  const parsed = path.parse(archivePath);
  if (candidate.kind === "split") {
    return path.parse(parsed.name).name;
  }
  return parsed.name;
}

async function countNonEmptyFiles(rootPath: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      count += await countNonEmptyFiles(entryPath);
    } else if (entry.isFile() && (await stat(entryPath)).size > 0) {
      count += 1;
    }
  }
  return count;
}

export function createArchiveJob(input: ArchiveJobInput): ArchiveJob {
  const discoverCandidates = input.discoverCandidates ?? discoverArchiveCandidates;
  const discoverNested =
    input.discoverNested ??
    (async ({ outputPath }: { outputPath: string; depth: number }) =>
      discoverArchiveCandidates(outputPath));
  const prepareCandidate =
    input.prepareCandidate ??
    (async (candidate: ArchiveCandidate) => {
      if (candidate.kind !== "split") {
        return candidate;
      }
      const group = candidate.splitGroup ?? groupSplitParts(candidate.sourcePaths)[0];
      if (!group) {
        throw new Error("Split archive group is unavailable.");
      }
      return stageSplitGroup(group, input.temporaryRoot, candidate.outputParentPath);
    });
  const cleanupCandidate = input.cleanupCandidate ?? cleanupTemporaryCandidate;
  const executeWinRar = input.runWinRar ?? defaultRunWinRar;
  const executeSevenZip = input.runSevenZip ?? defaultRunSevenZip;
  const now = input.now ?? (() => new Date());

  let status: ArchiveJobStatus = "queued";
  let password = input.password;
  let initialized = false;
  let queue: QueuedCandidate[] = [];
  let processedArchives = 0;
  let totalArchives = 0;
  let currentArchiveProgress = 0;
  let successCount = 0;
  let nonEmptyFileCount = 0;
  const failures: ArchiveJobFailure[] = [];
  const outputPaths: string[] = [];

  const addFailure = (code: ArchiveJobFailure["code"]) => {
    failures.push({ code });
  };

  const progressPercent = (): number => {
    if (status === "completed") return 100;
    if (totalArchives === 0) return 0;
    return Math.min(
      99,
      Math.round(((processedArchives + currentArchiveProgress) / totalArchives) * 100),
    );
  };

  const correctRegularSuffix = async (
    candidate: ArchiveCandidate,
  ): Promise<ArchiveCandidate> => {
    if (candidate.kind !== "regular") {
      return candidate;
    }
    const detectedKind = detectArchiveKind(await readHeader(candidate.path));
    if (!detectedKind || path.extname(candidate.path).toLowerCase() === `.${detectedKind}`) {
      return candidate;
    }
    const correctedPath = nextAvailablePath(
      preferredArchivePath(candidate.path, detectedKind),
      existsSync,
      now(),
    );
    await rename(candidate.path, correctedPath);
    return { ...candidate, path: correctedPath };
  };

  const runQueue = async (): Promise<void> => {
    while (queue.length > 0) {
      let work = queue.shift()!;
      let preparedCandidate: ArchiveCandidate | null = null;
      try {
        work = { ...work, candidate: await correctRegularSuffix(work.candidate) };
        preparedCandidate = await prepareCandidate(work.candidate);
        const archivePath = archivePathOf(preparedCandidate);
        const archiveKind =
          preparedCandidate.kind === "split"
            ? "7z"
            : detectArchiveKind(await readHeader(archivePath));
        const useSevenZip = archiveKind === "7z" || preparedCandidate.kind === "split";
        const executable = useSevenZip ? input.sevenZipPath : input.winRarPath;
        const executeArchive = useSevenZip ? executeSevenZip : executeWinRar;
        if (!executable) {
          processedArchives += 1;
          currentArchiveProgress = 0;
          addFailure("ARCHIVE_ENGINE_UNAVAILABLE");
          continue;
        }

        status = "testing";
        currentArchiveProgress = Math.max(currentArchiveProgress, 0.15);
        const testResult = await executeArchive("test", {
          executable,
          archivePath,
          password,
        });
        if (testResult.reason === "wrong_password") {
          queue.unshift(work);
          password = "";
          status = "needs_password";
          return;
        }
        if (!testResult.ok) {
          processedArchives += 1;
          currentArchiveProgress = 0;
          addFailure("ARCHIVE_TEST_FAILED");
          continue;
        }

        const preferredOutputPath = path.join(
          preparedCandidate.outputParentPath,
          preferredOutputName(preparedCandidate),
        );
        const outputPath = nextAvailablePath(preferredOutputPath, existsSync, now());
        await mkdir(outputPath, { recursive: false });

        status = "extracting";
        currentArchiveProgress = Math.max(currentArchiveProgress, 0.5);
        const extractResult = await executeArchive("extract", {
          executable,
          archivePath,
          destinationPath: outputPath,
          password,
        });
        if (extractResult.reason === "wrong_password") {
          await rm(outputPath, { recursive: true, force: true });
          queue.unshift(work);
          password = "";
          status = "needs_password";
          return;
        }
        processedArchives += 1;
        currentArchiveProgress = 0;
        if (!extractResult.ok) {
          addFailure("ARCHIVE_EXTRACTION_FAILED");
          continue;
        }

        successCount += 1;
        outputPaths.push(outputPath);
        nonEmptyFileCount += await countNonEmptyFiles(outputPath);

        if (work.depth >= 10) {
          addFailure("NESTED_DEPTH_EXCEEDED");
          continue;
        }

        let nestedCandidates: ArchiveCandidate[] = [];
        try {
          nestedCandidates = await discoverNested({
            outputPath,
            depth: work.depth + 1,
          });
        } catch {
          addFailure("NESTED_DISCOVERY_FAILED");
          continue;
        }
        queue.push(
          ...nestedCandidates.map((candidate) => ({
            candidate,
            depth: work.depth + 1,
          })),
        );
        totalArchives += nestedCandidates.length;
      } finally {
        if (preparedCandidate) {
          await cleanupCandidate(preparedCandidate);
        }
      }
    }

    password = "";
    currentArchiveProgress = 0;
    status = successCount === 0 && failures.length > 0 ? "failed" : "completed";
  };

  const runQueueSafely = async (): Promise<void> => {
    try {
      await runQueue();
    } catch {
      password = "";
      addFailure("ARCHIVE_PROCESSING_FAILED");
      status = "failed";
    }
  };

  return {
    async start() {
      if (initialized || status !== "queued") {
        return;
      }
      initialized = true;
      try {
        queue = (await discoverCandidates(input.selectionPath)).map((candidate) => ({
          candidate,
          depth: 0,
        }));
        totalArchives = queue.length;
      } catch (error) {
        password = "";
        currentArchiveProgress = 0;
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        addFailure(
          code === "SPLIT_AMBIGUOUS" || code === "SPLIT_PART_MISSING"
            ? code
            : "ARCHIVE_DISCOVERY_FAILED",
        );
        status = "failed";
        return;
      }
      await runQueueSafely();
    },

    async providePassword(replacementPassword: string) {
      if (status !== "needs_password") {
        throw new Error("Archive job is not waiting for a password.");
      }
      password = replacementPassword;
      await runQueueSafely();
    },

    snapshot() {
      return {
        status,
        progressPercent: progressPercent(),
        processedArchives,
        successCount,
        failureCount: failures.length,
        nonEmptyFileCount,
        failures: failures.map((failure) => ({ ...failure })),
        outputPaths: [...outputPaths],
        primaryOutputPath: outputPaths[0] ?? null,
      };
    },
  };
}
