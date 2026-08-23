import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { getKnowledgeConfig } from "@/lib/knowledge/config";
import { getKnowledgeRepository } from "@/lib/knowledge/repository";
import { KnowledgeStorage } from "@/lib/knowledge/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await getAssistantOwner();
    const repository = getKnowledgeRepository();
    const asset = await repository.findAsset(owner.id, context.params.id);
    if (!asset) return errorResponse(404, "ASSET_NOT_FOUND", "文件不存在");

    const storage = new KnowledgeStorage(getKnowledgeConfig().storageRoot);
    const range = parseByteRange(request.headers.get("range"), asset.sizeBytes);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: commonHeaders(asset.originalName, asset.mimeType, asset.sizeBytes, {
          "Content-Range": `bytes */${asset.sizeBytes}`,
        }),
      });
    }

    const opened = await storage.openRead(asset.storageKey, range ?? undefined);
    const contentLength = range
      ? range.end - range.start + 1
      : opened.sizeBytes;
    const headers = commonHeaders(
      asset.originalName,
      asset.mimeType,
      contentLength,
      range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${asset.sizeBytes}` }
        : undefined,
    );
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return handleError(error, "ASSET_READ_FAILED", "读取知识文件失败");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const owner = await getAssistantOwner();
    const repository = getKnowledgeRepository();
    const asset = await repository.findAsset(owner.id, context.params.id);
    if (!asset) return errorResponse(404, "ASSET_NOT_FOUND", "文件不存在");

    const relationCount = await repository.countAssetRelations(owner.id, asset.id);
    const confirmed = new URL(request.url).searchParams.get("confirmed") === "true";
    if (relationCount > 0 && !confirmed) {
      return NextResponse.json(
        { requiresConfirmation: true, relationCount },
        { status: 409 },
      );
    }

    await repository.markAssetDeleted(owner.id, asset.id);
    const storage = new KnowledgeStorage(getKnowledgeConfig().storageRoot);
    await storage.remove(asset.storageKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, "ASSET_DELETE_FAILED", "删除知识文件失败");
  }
}

function parseByteRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return "invalid" as const;

  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return "invalid" as const;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid" as const;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return "invalid" as const;
  }
  return { start, end: Math.min(end, size - 1) };
}

function commonHeaders(
  originalName: string,
  mimeType: string,
  contentLength: number,
  extra?: Record<string, string>,
) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="download"; filename*=UTF-8''${encodeFilename(originalName)}`,
    "Content-Length": String(contentLength),
    "Content-Type": mimeType,
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function encodeFilename(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function handleError(error: unknown, code: string, fallback: string) {
  if (error instanceof AssistantAuthError) {
    return errorResponse(error.status, error.code, error.message);
  }
  return errorResponse(
    500,
    code,
    error instanceof Error ? error.message : fallback,
  );
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
