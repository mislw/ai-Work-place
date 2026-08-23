import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { getKnowledgeConfig } from "@/lib/knowledge/config";
import { getKnowledgeRepository } from "@/lib/knowledge/repository";
import { KnowledgeStorage } from "@/lib/knowledge/storage";
import {
  KnowledgeUploadError,
  parseKnowledgeUpload,
} from "@/lib/knowledge/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const config = getKnowledgeConfig();
    const storage = new KnowledgeStorage(config.storageRoot);
    const repository = getKnowledgeRepository();
    const uploadId = randomUUID();
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || uploadId;
    if (idempotencyKey.length > 300) {
      return errorResponse(400, "BAD_IDEMPOTENCY_KEY", "上传请求标识无效");
    }

    const upload = await parseKnowledgeUpload(request, {
      storage,
      ownerId: owner.id,
      uploadId,
      maxFileBytes: config.maxFileBytes,
    });

    let registered;
    try {
      registered = await repository.registerUpload(
        owner.id,
        upload,
        idempotencyKey,
      );
    } catch (error) {
      await storage.remove(upload.storageKey).catch(() => undefined);
      throw error;
    }

    if (registered.reusedAsset) {
      await storage.remove(upload.storageKey);
    } else {
      let promotedKey: string | null = null;
      try {
        const promoted = await storage.promote({
          ownerId: owner.id,
          assetId: registered.assetId,
          originalName: upload.originalName,
          sourceKey: upload.storageKey,
        });
        promotedKey = promoted.storageKey;
        await repository.activateAsset(
          owner.id,
          registered.assetId,
          promoted.storageKey,
        );
      } catch (error) {
        await storage
          .remove(promotedKey ?? upload.storageKey)
          .catch(() => undefined);
        await repository
          .markAssetRejected(owner.id, registered.assetId)
          .catch(() => undefined);
        throw error;
      }
    }

    return NextResponse.json(
      {
        assetId: registered.assetId,
        documentId: registered.documentId,
        jobId: registered.jobId,
        status: "queued",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AssistantAuthError || error instanceof KnowledgeUploadError) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(
      500,
      "UPLOAD_FAILED",
      error instanceof Error ? error.message : "知识文件上传失败",
    );
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
