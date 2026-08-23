// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStorage } from "@/lib/knowledge/storage";
import {
  KnowledgeUploadError,
  parseKnowledgeUpload,
} from "@/lib/knowledge/upload";

describe("KnowledgeStorage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "knowledge-storage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a traversal filename inside the configured storage root", async () => {
    const storage = new KnowledgeStorage(root);
    const result = await storage.writeQuarantine({
      ownerId: "owner-1",
      uploadId: "upload-1",
      originalName: "../../secret.txt",
      stream: Readable.from("hello"),
      maxBytes: 100,
    });

    expect(result.absolutePath.startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(result.storageKey).toBe(
      "users/owner-1/quarantine/upload-1/upload.txt",
    );
    expect(result.sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(await readFile(result.absolutePath, "utf8")).toBe("hello");
  });

  it("removes partial data when a stream exceeds the byte limit", async () => {
    const storage = new KnowledgeStorage(root);

    await expect(
      storage.writeQuarantine({
        ownerId: "owner-1",
        uploadId: "upload-2",
        originalName: "large.txt",
        stream: Readable.from("too large"),
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

    const uploadDirectory = path.join(
      root,
      "users",
      "owner-1",
      "quarantine",
      "upload-2",
    );
    await expect(readdir(uploadDirectory)).resolves.toEqual([]);
  });

  it("promotes a quarantined file into an immutable asset path", async () => {
    const storage = new KnowledgeStorage(root);
    const written = await storage.writeQuarantine({
      ownerId: "owner-1",
      uploadId: "upload-3",
      originalName: "notes.md",
      stream: Readable.from("# Notes"),
      maxBytes: 100,
    });

    const promoted = await storage.promote({
      ownerId: "owner-1",
      assetId: "asset-1",
      originalName: "notes.md",
      sourceKey: written.storageKey,
      now: new Date("2026-08-22T00:00:00.000Z"),
    });

    expect(promoted.storageKey).toBe(
      "users/owner-1/assets/2026/08/asset-1/file.md",
    );
    expect(await storage.exists(written.storageKey)).toBe(false);
    expect(await readFile(promoted.absolutePath, "utf8")).toBe("# Notes");
  });

  it("rejects storage keys that escape the root", async () => {
    const storage = new KnowledgeStorage(root);
    await expect(storage.openRead("../outside.txt")).rejects.toMatchObject({
      code: "INVALID_STORAGE_KEY",
    });
  });
});

describe("parseKnowledgeUpload", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "knowledge-upload-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("streams one Markdown file into quarantine and normalizes its MIME type", async () => {
    const storage = new KnowledgeStorage(root);
    const body = new FormData();
    body.set(
      "file",
      new File(["# Harness\n方案"], "harness.md", { type: "text/plain" }),
    );

    const result = await parseKnowledgeUpload(
      new Request("http://localhost/upload", { method: "POST", body }),
      {
        storage,
        ownerId: "owner-1",
        uploadId: "upload-1",
        maxFileBytes: 1_024,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        originalName: "harness.md",
        mimeType: "text/markdown",
        sizeBytes: 16,
      }),
    );
    expect(await readFile(result.absolutePath, "utf8")).toBe("# Harness\n方案");
  });

  it("rejects an executable even when the declared type is plain text", async () => {
    const executable = path.join(root, "fake.exe");
    await writeFile(executable, Buffer.from("4d5a900003000000", "hex"));
    const body = new FormData();
    body.set(
      "file",
      new File([await readFile(executable)], "notes.txt", { type: "text/plain" }),
    );

    await expect(
      parseKnowledgeUpload(
        new Request("http://localhost/upload", { method: "POST", body }),
        {
          storage: new KnowledgeStorage(root),
          ownerId: "owner-1",
          uploadId: "upload-2",
          maxFileBytes: 1_024,
        },
      ),
    ).rejects.toBeInstanceOf(KnowledgeUploadError);
  });

  it("removes a truncated quarantine file when multipart upload exceeds the limit", async () => {
    const storage = new KnowledgeStorage(root);
    const body = new FormData();
    body.set(
      "file",
      new File(["12345"], "large.txt", { type: "text/plain" }),
    );

    await expect(
      parseKnowledgeUpload(
        new Request("http://localhost/upload", { method: "POST", body }),
        {
          storage,
          ownerId: "owner-1",
          uploadId: "upload-large",
          maxFileBytes: 4,
        },
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", status: 413 });

    await expect(
      storage.exists("users/owner-1/quarantine/upload-large/upload.txt"),
    ).resolves.toBe(false);
  });

  it("rejects requests without a file", async () => {
    const body = new FormData();
    body.set("note", "missing");

    await expect(
      parseKnowledgeUpload(
        new Request("http://localhost/upload", { method: "POST", body }),
        {
          storage: new KnowledgeStorage(root),
          ownerId: "owner-1",
          uploadId: "upload-3",
          maxFileBytes: 1_024,
        },
      ),
    ).rejects.toMatchObject({ code: "FILE_REQUIRED", status: 400 });
  });
});
