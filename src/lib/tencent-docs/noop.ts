import type { CreateDocumentParams, TencentDocsProvider } from "./provider";

/**
 * 未配置时的降级实现。所有操作抛出明确错误，前端展示"未连接"提示，
 * 不允许伪造同步成功结果。
 */
export class NoopTencentDocsProvider implements TencentDocsProvider {
  readonly isConfigured = false;
  async createDocument(_params: CreateDocumentParams): Promise<never> {
    throw new Error("TENCENT_DOCS_NOT_CONFIGURED");
  }
  async appendContent(_externalId: string, _content: string): Promise<never> {
    throw new Error("TENCENT_DOCS_NOT_CONFIGURED");
  }
  async getDocument(_externalId: string): Promise<null> {
    return null;
  }
  async searchDocuments(_query: string, _limit?: number): Promise<never[]> {
    return [];
  }
}
