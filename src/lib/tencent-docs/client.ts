/**
 * 客户端可见的腾讯文档"是否已配置"判断。
 * 服务端凭证永不暴露到客户端。
 */
export function isTencentDocsConfiguredClient(): boolean {
  if (typeof window === "undefined") return false;
  // 通过 /api/health 获取
  return Boolean((window as unknown as { __paiw_caps?: { tencentDocs?: boolean } }).__paiw_caps?.tencentDocs);
}
