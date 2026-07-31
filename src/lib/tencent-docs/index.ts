import {
  isTencentDocsConfigured,
  readTencentConfig,
  type TencentDocsProvider,
} from "./provider";
import { NoopTencentDocsProvider } from "./noop";

let cached: TencentDocsProvider | null = null;

/** 获取 Provider（已配置时返回真实实现；否则返回 Noop）。 */
export function getTencentDocsProvider(): TencentDocsProvider {
  if (cached) return cached;
  if (!isTencentDocsConfigured()) {
    cached = new NoopTencentDocsProvider();
    return cached;
  }
  // 第一版：仅暴露 Noop，避免在没有真实接口时伪造成功。
  // 后续阶段实现 OAuth / API Client 时，替换为具体实现。
  const _config = readTencentConfig();
  cached = new NoopTencentDocsProvider();
  return cached;
}
