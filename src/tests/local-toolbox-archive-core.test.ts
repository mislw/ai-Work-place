import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectArchiveKind,
  firstMissingSplitIndex,
  groupSplitParts,
  nextAvailablePath,
  parseSplitPart,
  preferredArchivePath,
} from "../../tools/local-toolbox/archive-core";

describe("local toolbox archive signatures", () => {
  it.each([
    [Uint8Array.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), "7z"],
    [Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "zip"],
    [Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), "rar"],
  ] as const)("detects %s", (header, expected) => {
    expect(detectArchiveKind(header)).toBe(expected);
  });

  it("replaces a misleading suffix with the detected archive suffix", () => {
    expect(preferredArchivePath("D:/private/course.pdf", "7z")).toBe(
      path.normalize("D:/private/course.7z"),
    );
  });
});

it("parses and orders numeric split parts across directories", () => {
  const group = groupSplitParts([
    "D:/download/b/course.7z.002",
    "D:/download/a/course.7z.001",
    "D:/download/c/course.7z.003",
  ])[0]!;

  expect(group.baseName).toBe("course.7z");
  expect(group.parts.map((part) => part.index)).toEqual([1, 2, 3]);
  expect(group.ambiguousIndexes).toEqual([]);
  expect(firstMissingSplitIndex(group)).toBeNull();
  expect(parseSplitPart("D:/download/course.7z")).toBeNull();
});

it("reports a missing or duplicate split instead of guessing", () => {
  const missing = groupSplitParts([
    "D:/a/course.7z.001",
    "D:/c/course.7z.003",
  ])[0]!;
  const duplicate = groupSplitParts([
    "D:/a/course.7z.001",
    "D:/b/course.7z.001",
  ])[0]!;

  expect(firstMissingSplitIndex(missing)).toBe(2);
  expect(duplicate.ambiguousIndexes).toEqual([1]);
});

it("reports index 1 missing when only split index 0 exists", () => {
  const group = groupSplitParts(["D:/download/course.7z.000"])[0]!;

  expect(firstMissingSplitIndex(group)).toBe(1);
});

it("creates a timestamped path when the preferred path exists", () => {
  expect(
    nextAvailablePath(
      "D:/download/course",
      (candidate) => candidate === path.normalize("D:/download/course"),
      new Date(2026, 8, 6, 8, 9, 10),
    ),
  ).toBe(path.normalize("D:/download/course_20260906_080910"));
});

it("uses suffix 3 when the timestamped path and suffix 2 are occupied", () => {
  const occupiedPaths = new Set([
    path.normalize("D:/download/course"),
    path.normalize("D:/download/course_20260906_080910"),
    path.normalize("D:/download/course_20260906_080910_2"),
  ]);

  expect(
    nextAvailablePath(
      "D:/download/course",
      (candidate) => occupiedPaths.has(candidate),
      new Date(2026, 8, 6, 8, 9, 10),
    ),
  ).toBe(path.normalize("D:/download/course_20260906_080910_3"));
});
