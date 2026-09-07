import path from "node:path";

export type ArchiveKind = "7z" | "zip" | "rar";

export type SplitPart = {
  path: string;
  baseName: string;
  index: number;
  width: number;
};

export type SplitGroup = {
  baseName: string;
  parts: SplitPart[];
  ambiguousIndexes: number[];
};

const signatures: Array<{ kind: ArchiveKind; bytes: number[] }> = [
  { kind: "7z", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { kind: "zip", bytes: [0x50, 0x4b] },
  { kind: "rar", bytes: [0x52, 0x61, 0x72, 0x21] },
];

export function detectArchiveKind(header: Uint8Array): ArchiveKind | null {
  return (
    signatures.find(({ bytes }) =>
      bytes.every((byte, index) => header[index] === byte),
    )?.kind ?? null
  );
}

export function preferredArchivePath(
  filePath: string,
  kind: ArchiveKind,
): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${kind}`);
}

export function parseSplitPart(filePath: string): SplitPart | null {
  const match = /^(.+)\.(\d{3,})$/i.exec(path.basename(filePath));
  const baseName = match?.[1];
  const indexText = match?.[2];
  if (!baseName || !indexText) {
    return null;
  }

  return {
    path: filePath,
    baseName,
    index: Number(indexText),
    width: indexText.length,
  };
}

export function groupSplitParts(paths: string[]): SplitGroup[] {
  const groups = new Map<string, SplitGroup>();

  for (const filePath of paths) {
    const part = parseSplitPart(filePath);
    if (!part) {
      continue;
    }

    const key = part.baseName.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.parts.push(part);
    } else {
      groups.set(key, {
        baseName: part.baseName,
        parts: [part],
        ambiguousIndexes: [],
      });
    }
  }

  return Array.from(groups.values(), (group) => {
    group.parts.sort((left, right) => left.index - right.index);

    const indexCounts = new Map<number, number>();
    for (const part of group.parts) {
      indexCounts.set(part.index, (indexCounts.get(part.index) ?? 0) + 1);
    }

    group.ambiguousIndexes = Array.from(indexCounts)
      .filter(([, count]) => count > 1)
      .map(([index]) => index)
      .sort((left, right) => left - right);

    return group;
  });
}

export function firstMissingSplitIndex(group: SplitGroup): number | null {
  const indexes = new Set(group.parts.map((part) => part.index));
  if (!indexes.has(1)) {
    return 1;
  }

  const highestIndex = Math.max(0, ...indexes);

  for (let index = 1; index <= highestIndex; index += 1) {
    if (!indexes.has(index)) {
      return index;
    }
  }

  return null;
}

export function nextAvailablePath(
  preferredPath: string,
  exists: (path: string) => boolean,
  now: Date = new Date(),
): string {
  const normalizedPath = path.normalize(preferredPath);
  if (!exists(normalizedPath)) {
    return normalizedPath;
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const timestampedPath = `${normalizedPath}_${timestamp}`;

  if (!exists(timestampedPath)) {
    return timestampedPath;
  }

  let suffix = 2;
  while (exists(`${timestampedPath}_${suffix}`)) {
    suffix += 1;
  }
  return `${timestampedPath}_${suffix}`;
}
