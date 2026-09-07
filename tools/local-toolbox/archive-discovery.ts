import { randomUUID } from "node:crypto";
import {
  constants,
  copyFile,
  mkdir,
  open,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  detectArchiveKind,
  firstMissingSplitIndex,
  groupSplitParts,
  parseSplitPart,
  type SplitGroup,
} from "./archive-core";

export type ArchiveCandidate =
  | { kind: "regular"; path: string; outputParentPath: string }
  | {
      kind: "split";
      firstPartPath: string;
      sourcePaths: string[];
      outputParentPath: string;
      splitGroup?: SplitGroup;
      temporaryDirectory?: string;
    };

type ArchiveDiscoveryErrorCode = "SPLIT_AMBIGUOUS" | "SPLIT_PART_MISSING";

class ArchiveDiscoveryError extends Error {
  readonly code: ArchiveDiscoveryErrorCode;

  constructor(code: ArchiveDiscoveryErrorCode, message: string) {
    super(message);
    this.name = "ArchiveDiscoveryError";
    this.code = code;
  }
}

const archiveExtensions = new Set([".7z", ".zip", ".rar"]);
const stagedDirectories = new Map<string, string>();

function comparablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isStrictChild(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

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

function validateSplitGroup(group: SplitGroup): void {
  if (group.ambiguousIndexes.length > 0) {
    throw new ArchiveDiscoveryError(
      "SPLIT_AMBIGUOUS",
      `Split archive ${group.baseName} contains duplicate indexes.`,
    );
  }

  const missingIndex = firstMissingSplitIndex(group);
  if (missingIndex !== null) {
    throw new ArchiveDiscoveryError(
      "SPLIT_PART_MISSING",
      `Split archive ${group.baseName} is missing index ${missingIndex}.`,
    );
  }
}

export async function listFilesRecursively(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function discoverArchiveCandidates(
  selectionPath: string,
): Promise<ArchiveCandidate[]> {
  const selection = path.resolve(selectionPath);
  const selectionStat = await stat(selection);
  const selectedPart = selectionStat.isFile() ? parseSplitPart(selection) : null;
  const selectedKind = selectionStat.isFile()
    ? detectArchiveKind(await readHeader(selection))
    : null;
  const scanRoot = selectionStat.isDirectory() ? selection : path.dirname(selection);
  const scannedFiles = selectionStat.isDirectory()
    ? await listFilesRecursively(selection)
    : selectedPart || selectedKind
      ? await listFilesRecursively(scanRoot)
      : [selection];
  const files = scannedFiles.sort((left, right) => left.localeCompare(right));
  const splitPaths = files.filter((filePath) => parseSplitPart(filePath));
  let splitGroups = groupSplitParts(splitPaths);

  if (selectedPart) {
    splitGroups = splitGroups.filter(
      (group) => group.baseName.toLowerCase() === selectedPart.baseName.toLowerCase(),
    );
  } else if (selectionStat.isFile() && selectedKind === "7z") {
    const selectedBaseName = `${path.parse(selection).name}.7z`.toLowerCase();
    splitGroups = splitGroups.filter(
      (group) => group.baseName.toLowerCase() === selectedBaseName,
    );
  }

  const disguisedFirstParts = new Set<string>();
  for (const group of splitGroups) {
    if (firstMissingSplitIndex(group) !== 1) continue;
    const expectedStem = path.parse(group.baseName).name.toLowerCase();
    const candidates: string[] = [];
    for (const filePath of files) {
      if (parseSplitPart(filePath)) continue;
      if (path.dirname(filePath).toLowerCase() !== path.dirname(group.parts[0]!.path).toLowerCase()) {
        continue;
      }
      if (path.parse(filePath).name.toLowerCase() !== expectedStem) continue;
      if (detectArchiveKind(await readHeader(filePath)) === "7z") {
        candidates.push(filePath);
      }
    }
    if (candidates.length === 1) {
      const firstPart = candidates[0]!;
      group.parts.unshift({
        path: firstPart,
        baseName: group.baseName,
        index: 1,
        width: group.parts[0]?.width ?? 3,
      });
      disguisedFirstParts.add(comparablePath(firstPart));
    }
  }

  for (const group of splitGroups) {
    validateSplitGroup(group);
  }

  const splitPathSet = new Set(splitPaths.map(comparablePath));
  const regularCandidates: ArchiveCandidate[] = [];

  for (const filePath of files) {
    if (splitPathSet.has(comparablePath(filePath))) {
      continue;
    }
    if (disguisedFirstParts.has(comparablePath(filePath))) {
      continue;
    }
    if (selectionStat.isFile() && comparablePath(filePath) !== comparablePath(selection)) {
      continue;
    }

    const knownExtension = archiveExtensions.has(path.extname(filePath).toLowerCase());
    const detectedKind = detectArchiveKind(await readHeader(filePath));
    if (knownExtension || detectedKind) {
      regularCandidates.push({
        kind: "regular",
        path: filePath,
        outputParentPath: path.dirname(filePath),
      });
    }
  }

  const splitCandidates: ArchiveCandidate[] = splitGroups.map((group) => {
    const sourcePaths = group.parts.map((part) => part.path);
    const firstPart = group.parts.find((part) => part.index === 1)!;
    return {
      kind: "split",
      firstPartPath: firstPart.path,
      sourcePaths,
      outputParentPath: selectionStat.isDirectory() ? selection : path.dirname(selection),
      splitGroup: group,
    };
  });

  return [...regularCandidates, ...splitCandidates];
}

export async function stageSplitGroup(
  group: SplitGroup,
  temporaryRoot: string,
  outputParentPath: string,
): Promise<ArchiveCandidate> {
  validateSplitGroup(group);
  const sourcePaths = group.parts.map((part) => path.resolve(part.path));
  const firstPart = group.parts.find((part) => part.index === 1)!;
  const sourceDirectories = new Set(
    sourcePaths.map((filePath) => comparablePath(path.dirname(filePath))),
  );
  const desiredName = (part: SplitGroup["parts"][number]) =>
    `${part.baseName}.${String(part.index).padStart(part.width, "0")}`;
  const needsRenaming = group.parts.some(
    (part) => path.basename(part.path).toLowerCase() !== desiredName(part).toLowerCase(),
  );

  if (sourceDirectories.size === 1 && !needsRenaming) {
    return {
      kind: "split",
      firstPartPath: path.resolve(firstPart.path),
      sourcePaths,
      outputParentPath: path.resolve(outputParentPath),
    };
  }

  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  await mkdir(resolvedTemporaryRoot, { recursive: true });
  const temporaryDirectory = path.join(resolvedTemporaryRoot, randomUUID());
  await mkdir(temporaryDirectory);

  const comparableTemporaryDirectory = comparablePath(temporaryDirectory);
  const comparableTemporaryRoot = comparablePath(resolvedTemporaryRoot);
  if (!isStrictChild(comparableTemporaryDirectory, comparableTemporaryRoot)) {
    throw new Error("Temporary staging directory escaped its configured root.");
  }
  stagedDirectories.set(comparableTemporaryDirectory, comparableTemporaryRoot);

  try {
    for (const part of group.parts) {
      await copyFile(
        part.path,
        path.join(temporaryDirectory, desiredName(part)),
        constants.COPYFILE_EXCL,
      );
    }
  } catch (error) {
    stagedDirectories.delete(comparableTemporaryDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    kind: "split",
    firstPartPath: path.join(temporaryDirectory, desiredName(firstPart)),
    sourcePaths: group.parts.map((part) =>
      path.join(temporaryDirectory, desiredName(part)),
    ),
    outputParentPath: path.resolve(outputParentPath),
    temporaryDirectory,
  };
}

export async function cleanupTemporaryCandidate(
  candidate: ArchiveCandidate,
): Promise<void> {
  if (candidate.kind !== "split" || !candidate.temporaryDirectory) {
    return;
  }

  const temporaryDirectory = comparablePath(candidate.temporaryDirectory);
  const temporaryRoot = stagedDirectories.get(temporaryDirectory);
  if (!temporaryRoot || !isStrictChild(temporaryDirectory, temporaryRoot)) {
    return;
  }

  stagedDirectories.delete(temporaryDirectory);
  await rm(path.resolve(candidate.temporaryDirectory), {
    recursive: true,
    force: true,
  });
}
