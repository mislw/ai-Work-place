import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class KnowledgeStorageError extends Error {
  constructor(
    readonly code: "FILE_TOO_LARGE" | "INVALID_STORAGE_KEY",
    message: string,
  ) {
    super(message);
  }
}

export interface StoredKnowledgeFile {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}

export class KnowledgeStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async writeQuarantine(input: {
    ownerId: string;
    uploadId: string;
    originalName: string;
    stream: Readable;
    maxBytes: number;
  }): Promise<StoredKnowledgeFile> {
    const ownerId = safeSegment(input.ownerId);
    const uploadId = safeSegment(input.uploadId);
    const extension = safeExtension(input.originalName);
    const storageKey = `users/${ownerId}/quarantine/${uploadId}/upload${extension}`;
    const absolutePath = this.resolveKey(storageKey);
    const partialPath = `${absolutePath}.part`;
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const meter = new HashingLimitTransform(input.maxBytes);
    try {
      await pipeline(input.stream, meter, createWriteStream(partialPath, { flags: "wx" }));
      await rename(partialPath, absolutePath);
      return {
        storageKey,
        absolutePath,
        sizeBytes: meter.sizeBytes,
        sha256: meter.digest(),
      };
    } catch (error) {
      await rm(partialPath, { force: true });
      await rm(absolutePath, { force: true });
      throw error;
    }
  }

  async promote(input: {
    ownerId: string;
    assetId: string;
    originalName: string;
    sourceKey: string;
    now?: Date;
  }) {
    const ownerId = safeSegment(input.ownerId);
    const assetId = safeSegment(input.assetId);
    const now = input.now ?? new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const extension = safeExtension(input.originalName);
    const storageKey = `users/${ownerId}/assets/${year}/${month}/${assetId}/file${extension}`;
    const sourcePath = this.resolveKey(input.sourceKey);
    const absolutePath = this.resolveKey(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await rename(sourcePath, absolutePath);
    return { storageKey, absolutePath };
  }

  async openRead(
    storageKey: string,
    range?: { start: number; end: number },
  ) {
    const absolutePath = this.resolveKey(storageKey);
    const metadata = await stat(absolutePath);
    return {
      absolutePath,
      sizeBytes: metadata.size,
      stream: createReadStream(absolutePath, range),
    };
  }

  async remove(storageKey: string) {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  async exists(storageKey: string) {
    try {
      await access(this.resolveKey(storageKey));
      return true;
    } catch (error) {
      if (
        error instanceof KnowledgeStorageError ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      return false;
    }
  }

  private resolveKey(storageKey: string) {
    const segments = storageKey.split("/");
    if (
      path.isAbsolute(storageKey) ||
      storageKey.includes("\\") ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new KnowledgeStorageError(
        "INVALID_STORAGE_KEY",
        "存储路径无效",
      );
    }
    const absolutePath = path.resolve(this.root, ...segments);
    if (
      absolutePath !== this.root &&
      !absolutePath.startsWith(`${this.root}${path.sep}`)
    ) {
      throw new KnowledgeStorageError(
        "INVALID_STORAGE_KEY",
        "存储路径超出知识库目录",
      );
    }
    return absolutePath;
  }
}

class HashingLimitTransform extends Transform {
  private readonly hash = createHash("sha256");
  sizeBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.sizeBytes += chunk.length;
    if (this.sizeBytes > this.maxBytes) {
      callback(
        new KnowledgeStorageError(
          "FILE_TOO_LARGE",
          `文件不能超过 ${this.maxBytes} 字节`,
        ),
      );
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  digest() {
    return this.hash.digest("hex");
  }
}

function safeSegment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new KnowledgeStorageError("INVALID_STORAGE_KEY", "存储标识无效");
  }
  return value;
}

function safeExtension(filename: string) {
  const extension = path.extname(path.basename(filename)).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}
