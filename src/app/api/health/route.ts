import { NextResponse } from "next/server";
import { isAIConfigured } from "@/lib/ai/provider";
import { isTencentDocsConfigured } from "@/lib/tencent-docs/provider";

export const runtime = "nodejs";

/** GET /api/health - 检查 AI / Tencent Docs 配置状态。 */
export async function GET() {
  return NextResponse.json({
    ai: isAIConfigured(),
    tencentDocs: isTencentDocsConfigured(),
    time: new Date().toISOString(),
  });
}
