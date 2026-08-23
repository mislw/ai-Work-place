import { executeWorkbenchAction } from "@/lib/assistant/action-executor";
import type { WorkbenchAction } from "@/lib/assistant/actions";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export async function executeIdempotentWorkbenchAction(
  userId: string,
  action: WorkbenchAction,
  requestId: string | undefined,
): Promise<{ result: unknown; replayed: boolean }> {
  if (!action.action.endsWith(".create")) {
    return {
      result: await executeWorkbenchAction(userId, action),
      replayed: false,
    };
  }
  if (!requestId) throw new Error("创建操作缺少 requestId");

  const supabase = await createRouteHandlerClient();
  const claim = await supabase
    .from("assistant_action_receipts")
    .insert({
      user_id: userId,
      request_id: requestId,
      action_name: action.action,
      status: "processing",
    })
    .select("request_id")
    .maybeSingle();

  if (claim.error) {
    const existing = await supabase
      .from("assistant_action_receipts")
      .select("status, result")
      .eq("request_id", requestId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.status === "completed") {
      return { result: existing.data.result, replayed: true };
    }
    throw new Error("该创建操作正在执行，请稍后刷新");
  }

  let result: unknown;
  try {
    result = await executeWorkbenchAction(userId, action);
  } catch (error) {
    await supabase
      .from("assistant_action_receipts")
      .delete()
      .eq("request_id", requestId);
    throw error;
  }

  await supabase
    .from("assistant_action_receipts")
    .update({ status: "completed", result })
    .eq("request_id", requestId);
  return { result, replayed: false };
}
