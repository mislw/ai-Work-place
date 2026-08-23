import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { searchKnowledge } from "@/lib/knowledge/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const parameters = new URL(request.url).searchParams;
    const query = parameters.get("q")?.trim() ?? "";
    if (!query || query.length > 300) {
      return NextResponse.json(
        { error: { code: "BAD_QUERY", message: "请输入有效的检索内容" } },
        { status: 400 },
      );
    }
    const rawLimit = Number.parseInt(parameters.get("limit") ?? "10", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 20) : 10;
    const results = await searchKnowledge({
      ownerId: owner.id,
      query,
      collectionId: parameters.get("collectionId")?.trim() || null,
      limit,
    });
    return NextResponse.json(
      {
        results: results.map((result) => ({
          ...result,
          assetUrl: result.assetId
            ? `/api/knowledge/assets/${result.assetId}`
            : null,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AssistantAuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: { code: "SEARCH_FAILED", message: "知识检索失败" } },
      { status: 500 },
    );
  }
}
