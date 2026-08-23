import path from "node:path";
import { Readable, Transform } from "node:stream";
import Busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import { SUPPORTED_KNOWLEDGE_MIME_TYPES } from "@/lib/knowledge/contracts";
import {
  KnowledgeStorage,
  KnowledgeStorageError,
  type StoredKnowledgeFile,
} from "@/lib/knowledge/storage";

export class KnowledgeUploadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code:
      | "BAD_MULTIPART"
      | "FILE_REQUIRED"
      | "MULTIPLE_FILES"
      | "FILE_TOO_LARGE"
      | "EMPTY_FILE"
      | "UNSUPPORTED_FILE"
      | "MIME_MISMATCH",
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedKnowledgeUpload extends StoredKnowledgeFile {
  originalName: string;
  mimeType: string;
}

export async function parseKnowledgeUpload(
  request: Request,
  options: {
    storage: KnowledgeStorage;
    ownerId: string;
    uploadId: string;
    maxFileBytes: number;
  },
): Promise<ParsedKnowledgeUpload> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new KnowledgeUploadError(
      400,
      "BAD_MULTIPART",
      "上传请求必须使用 multipart/form-data",
    );
  }
  if (!request.body) {
    throw new KnowledgeUploadError(400, "FILE_REQUIRED", "请选择文件");
  }

  return new Promise<ParsedKnowledgeUpload>((resolve, reject) => {
    let settled = false;
    let fileSeen = false;
    let fileTask: Promise<ParsedKnowledgeUpload> | null = null;
    const finishResolve = (value: ParsedKnowledgeUpload) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const finishReject = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(normalizeUploadError(error));
      }
    };

    let parser: Busboy.Busboy;
    try {
      parser = Busboy({
        headers: { "content-type": contentType },
        limits: { files: 1, fileSize: options.maxFileBytes, fields: 10 },
      });
    } catch {
      finishReject(
        new KnowledgeUploadError(400, "BAD_MULTIPART", "上传请求格式无效"),
      );
      return;
    }

    parser.on("file", (fieldName, file, info) => {
      if (fieldName !== "file" || fileSeen) {
        file.resume();
        finishReject(
          new KnowledgeUploadError(
            400,
            "MULTIPLE_FILES",
            "每次请求只能上传一个文件",
          ),
        );
        return;
      }
      fileSeen = true;
      const originalName = path.basename(info.filename || "upload").slice(0, 500);
      const peek = new PeekTransform(4_100);
      file.on("limit", () => {
        finishReject(
          new KnowledgeUploadError(
            413,
            "FILE_TOO_LARGE",
            "文件超过大小限制",
          ),
        );
      });
      fileTask = options.storage
        .writeQuarantine({
          ownerId: options.ownerId,
          uploadId: options.uploadId,
          originalName,
          stream: file.pipe(peek),
          maxBytes: options.maxFileBytes,
        })
        .then(async (stored) => {
          if (stored.sizeBytes === 0) {
            await options.storage.remove(stored.storageKey);
            throw new KnowledgeUploadError(400, "EMPTY_FILE", "文件内容为空");
          }
          try {
            const mimeType = await detectAcceptedMimeType(
              originalName,
              info.mimeType,
              peek.buffer(),
            );
            return { ...stored, originalName, mimeType };
          } catch (error) {
            await options.storage.remove(stored.storageKey);
            throw error;
          }
        });
    });
    parser.on("filesLimit", () => {
      finishReject(
        new KnowledgeUploadError(
          400,
          "MULTIPLE_FILES",
          "每次请求只能上传一个文件",
        ),
      );
    });
    parser.on("error", finishReject);
    parser.on("finish", () => {
      if (!fileSeen || !fileTask) {
        finishReject(
          new KnowledgeUploadError(400, "FILE_REQUIRED", "请选择文件"),
        );
        return;
      }
      void fileTask.then(finishResolve, finishReject);
    });

    const source = Readable.fromWeb(request.body as never);
    source.on("error", finishReject);
    source.pipe(parser);
  });
}

async function detectAcceptedMimeType(
  originalName: string,
  declaredMime: string,
  head: Buffer,
) {
  const detected = await fileTypeFromBuffer(head);
  if (detected) {
    if (!SUPPORTED_KNOWLEDGE_MIME_TYPES.has(detected.mime)) {
      throw new KnowledgeUploadError(
        415,
        "UNSUPPORTED_FILE",
        "不支持这种文件格式",
      );
    }
    if (
      declaredMime &&
      declaredMime !== "application/octet-stream" &&
      declaredMime !== detected.mime
    ) {
      throw new KnowledgeUploadError(
        415,
        "MIME_MISMATCH",
        "文件内容与声明格式不一致",
      );
    }
    return detected.mime;
  }

  const extension = path.extname(originalName).toLowerCase();
  if (!looksLikeText(head)) {
    throw new KnowledgeUploadError(
      415,
      "UNSUPPORTED_FILE",
      "无法识别文件格式",
    );
  }
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".txt") return "text/plain";
  throw new KnowledgeUploadError(
    415,
    "UNSUPPORTED_FILE",
    "仅支持 PDF、DOCX、Markdown、文本和常见图片",
  );
}

function looksLikeText(buffer: Buffer) {
  return !buffer.some(
    (byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13,
  );
}

function normalizeUploadError(error: unknown) {
  if (error instanceof KnowledgeUploadError) return error;
  if (
    error instanceof KnowledgeStorageError &&
    error.code === "FILE_TOO_LARGE"
  ) {
    return new KnowledgeUploadError(413, "FILE_TOO_LARGE", error.message);
  }
  return error;
}

class PeekTransform extends Transform {
  private readonly chunks: Buffer[] = [];
  private capturedBytes = 0;

  constructor(private readonly maximumBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    if (this.capturedBytes < this.maximumBytes) {
      const remaining = this.maximumBytes - this.capturedBytes;
      const captured = chunk.subarray(0, remaining);
      this.chunks.push(Buffer.from(captured));
      this.capturedBytes += captured.length;
    }
    callback(null, chunk);
  }

  buffer() {
    return Buffer.concat(this.chunks, this.capturedBytes);
  }
}
