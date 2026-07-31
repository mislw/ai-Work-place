/**
 * 腾讯文档 Provider 接口。
 * 第一版仅定义接口；未配置时由 noop 实现保证基础功能可用。
 * 所有凭证仅保留在服务端环境变量。
 */

export interface DocumentItem {
  externalId: string;
  title: string;
  url: string;
  updatedAt?: string;
}

export interface CreateDocumentParams {
  title: string;
  content: string;
  folderId?: string;
}

export interface TencentDocsProvider {
  readonly isConfigured: boolean;
  createDocument(params: CreateDocumentParams): Promise<DocumentItem>;
  appendContent(externalId: string, content: string): Promise<DocumentItem>;
  getDocument(externalId: string): Promise<DocumentItem | null>;
  searchDocuments(query: string, limit?: number): Promise<DocumentItem[]>;
}

export function readTencentConfig() {
  const baseURL = process.env.TENCENT_DOCS_BASE_URL;
  const token = process.env.TENCENT_DOCS_ACCESS_TOKEN;
  const clientId = process.env.TENCENT_DOCS_CLIENT_ID;
  const clientSecret = process.env.TENCENT_DOCS_CLIENT_SECRET;
  if (!baseURL || !token || !clientId || !clientSecret) {
    return null;
  }
  return { baseURL, token, clientId, clientSecret };
}

export function isTencentDocsConfigured(): boolean {
  return readTencentConfig() !== null;
}
