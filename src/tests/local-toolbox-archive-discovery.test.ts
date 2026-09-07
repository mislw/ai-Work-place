import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groupSplitParts } from "../../tools/local-toolbox/archive-core";
import {
  cleanupTemporaryCandidate,
  discoverArchiveCandidates,
  listFilesRecursively,
  stageSplitGroup,
} from "../../tools/local-toolbox/archive-discovery";

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

describe("local toolbox archive discovery", () => {
  it("lists regular files recursively without returning directories", async () => {
    const root = await createRoot("local-toolbox-list-");
    const nested = path.join(root, "nested");
    await mkdir(nested);
    await writeFile(path.join(root, "first.txt"), "first");
    await writeFile(path.join(nested, "second.txt"), "second");

    const files = await listFilesRecursively(root);

    expect(files.sort()).toEqual(
      [path.join(root, "first.txt"), path.join(nested, "second.txt")].sort(),
    );
  });

  it("finds ordinary archives and emits only one candidate for a split", async () => {
    const root = await createRoot("local-toolbox-discovery-");
    await writeFile(
      path.join(root, "normal.zip"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    await writeFile(
      path.join(root, "disguised.pdf"),
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    );
    await writeFile(
      path.join(root, "course.7z.001"),
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    );
    await writeFile(path.join(root, "course.7z.002"), Buffer.from([0x00]));

    const candidates = await discoverArchiveCandidates(root);

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "regular",
      "regular",
      "split",
    ]);
    expect(candidates.filter((candidate) => candidate.kind === "split")).toHaveLength(
      1,
    );
    expect(
      candidates.every((candidate) => candidate.outputParentPath === root),
    ).toBe(true);
  });

  it("rejects a missing split part with a stable error code", async () => {
    const root = await createRoot("local-toolbox-missing-");
    await writeFile(path.join(root, "course.7z.001"), "one");
    await writeFile(path.join(root, "course.7z.003"), "three");

    await expect(discoverArchiveCandidates(root)).rejects.toMatchObject({
      code: "SPLIT_PART_MISSING",
    });
  });

  it("pairs a disguised 7z first volume with its numbered successors", async () => {
    const root = await createRoot("local-toolbox-disguised-split-");
    const disguisedFirstPart = path.join(root, "course.pdf");
    const secondPart = path.join(root, "course.7z.002");
    await writeFile(
      disguisedFirstPart,
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    );
    await writeFile(secondPart, Buffer.from([0x00]));

    const candidates = await discoverArchiveCandidates(root);
    const split = candidates.find((candidate) => candidate.kind === "split");

    expect(split).toMatchObject({
      kind: "split",
      firstPartPath: disguisedFirstPart,
      sourcePaths: [disguisedFirstPart, secondPart],
    });
    if (!split || split.kind !== "split") {
      throw new Error("Expected a disguised split archive candidate.");
    }

    const temporaryRoot = await createRoot("local-toolbox-disguised-stage-");
    const staged = await stageSplitGroup(
      split.splitGroup!,
      temporaryRoot,
      root,
    );

    if (staged.kind !== "split") {
      throw new Error("Expected a staged split archive candidate.");
    }
    expect(path.basename(staged.firstPartPath)).toBe("course.7z.001");
    expect(staged.sourcePaths.map((filePath) => path.basename(filePath))).toEqual([
      "course.7z.001",
      "course.7z.002",
    ]);
    await cleanupTemporaryCandidate(staged);
  });

  it("rejects duplicate split indexes across child directories", async () => {
    const root = await createRoot("local-toolbox-duplicate-");
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "b"));
    await writeFile(path.join(root, "a", "course.7z.001"), "one-a");
    await writeFile(path.join(root, "b", "course.7z.001"), "one-b");

    await expect(discoverArchiveCandidates(root)).rejects.toMatchObject({
      code: "SPLIT_AMBIGUOUS",
    });
  });
});

describe("local toolbox split staging", () => {
  it("copies cross-directory parts and preserves the selected output root", async () => {
    const root = await createRoot("local-toolbox-parts-");
    const temporaryRoot = await createRoot("local-toolbox-stage-");
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "b"));
    const first = path.join(root, "a", "course.7z.001");
    const second = path.join(root, "b", "course.7z.002");
    await writeFile(first, "one");
    await writeFile(second, "two");

    const candidate = await stageSplitGroup(
      groupSplitParts([first, second])[0]!,
      temporaryRoot,
      root,
    );

    expect(candidate.kind).toBe("split");
    if (candidate.kind !== "split") {
      throw new Error("Expected a split archive candidate.");
    }
    expect(candidate.temporaryDirectory).toBeTruthy();
    expect(candidate.outputParentPath).toBe(root);
    await expect(readFile(candidate.firstPartPath, "utf8")).resolves.toBe("one");
    await cleanupTemporaryCandidate(candidate);
    await expect(stat(candidate.temporaryDirectory!)).rejects.toThrow();
  });

  it("does not remove an unregistered directory from a forged candidate", async () => {
    const root = await createRoot("local-toolbox-preserve-");
    const marker = path.join(root, "keep.txt");
    await writeFile(marker, "keep");

    await cleanupTemporaryCandidate({
      kind: "split",
      firstPartPath: path.join(root, "course.7z.001"),
      sourcePaths: [],
      outputParentPath: root,
      temporaryDirectory: root,
    });

    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
  });
});
