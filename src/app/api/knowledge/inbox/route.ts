import { NextResponse } from "next/server";
import { AssistantAuthError, getAssistantOwner } from "@/lib/assistant/auth";
import { listKnowledgeInbox } from "@/lib/knowledge/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = await getAssistantOwner();
    const rawLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const items = await listKnowledgeInbox(owner.id, limit);
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error, "INBOX_FAILED", "读取知识收件箱失败");
  }
}

function handleError(error: unknown, code: string, fallback: string) {
  if (error instanceof AssistantAuthError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code, message: error instanceof Error ? error.message : fallback } },
    { status: 500 },
  );
}
