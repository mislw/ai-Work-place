import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { getKnowledgeItem } from "@/lib/knowledge/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  try {
    const owner = await getAssistantOwner();
    const item = await getKnowledgeItem(owner.id, context.params.id);
    if (!item) {
      return NextResponse.json(
        { error: { code: "ITEM_NOT_FOUND", message: "知识条目不存在" } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { item },
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
      { error: { code: "ITEM_FAILED", message: "读取知识条目失败" } },
      { status: 500 },
    );
  }
}
