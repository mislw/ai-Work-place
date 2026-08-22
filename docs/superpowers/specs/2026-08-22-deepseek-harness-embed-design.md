# DeepSeek Harness 完整嵌入设计

## 目标

将 `F:\deepseek-harness` 提供的完整 Web 表层嵌入个人 AI 工作站，作为导航栏中的独立全屏“AI 助手”页面。保留 Harness 的会话、流式输出、模型选择、停止生成、工具调用、审批、文件操作、计划、目标、子代理和工作流能力，同时复用 AI 工作站现有登录，不向公网直接暴露无认证的 Harness 服务。

最终还要通过受控工具让 Harness 读取和操作 AI 工作站的待办、笔记与日历。该业务联动在嵌入和权限边界稳定后上线，但属于同一完整接入方案。

## 非目标

- 不在第一步重写 Harness 的 React UI。
- 不把 Harness 源码并入 Next.js 构建。
- 不让浏览器直接连接 NAS 内部 Harness 容器。
- 不向 Harness 或工具容器挂载 Docker Socket、NAS 根目录、Supabase Service Role Key 或其他无关密钥。
- 不用 AI 模型的文字承诺代替权限检查、写入确认或运行时验收。

## 总体架构

```text
浏览器
  |
  | https://ai.mislw.cn/assistant
  v
Next.js AI 工作站（Supabase 登录）
  |
  | 短时、单次使用的嵌入凭据
  v
https://agent.mislw.cn/auth/bootstrap
  |
  v
Harness Auth Gateway
  |
  | HTTP + WebSocket 反向代理
  v
DeepSeek Harness Web Host :3080
  |
  +-- 持久化 DSH_HOME
  +-- 专用工作目录
  +-- DeepSeek API
```

使用 `agent.mislw.cn` 而不是 `ai.mislw.cn/harness`。Harness Web 使用根路径资源、`/api` 和 WebSocket；使用独立子域可以避免与 Next.js 的 `/api`、静态资源和路由发生冲突，也更适合 Cloudflare Tunnel 和 CSP 隔离。

Harness 固定到当前验证版本 `0.1.0-rc.5`。它处于开发者预览阶段，升级必须先在测试环境验证协议、页面和持久化兼容性。

## 页面集成

AI 工作站增加 `/assistant` 页面和“AI 助手”导航项。该页面保留现有侧边栏和顶栏，剩余可用区域由 iframe 完整占用，不使用卡片容器，不在小尺寸工作台组件中嵌套完整 Harness。

iframe 指向一次性 bootstrap URL。完成认证后 Gateway 立即重定向到 Harness 根页面并从地址中移除 token。iframe 允许 Harness 所需的剪贴板和下载能力，但通过响应头限制只能被 `https://ai.mislw.cn` 嵌入：

```text
Content-Security-Policy: frame-ancestors https://ai.mislw.cn
Referrer-Policy: no-referrer
```

加载、认证失败、Harness 不健康和连接断开分别显示明确状态，并提供重试按钮。移动端使用整页布局，不显示工作台底部导航，避免遮挡 Harness 输入区。

## 单点登录

Harness Web 本身没有认证层，因此公网入口只能到达 Auth Gateway。

1. 用户访问 `/assistant`，Next.js 服务端先执行现有 `requireUser()`。
2. Next.js 为当前用户生成最长 60 秒有效、单次使用的 HMAC bootstrap token，包含用户 ID、过期时间、nonce 和目标路径。
3. Gateway 校验签名、过期时间、nonce 和唯一允许的站点 owner 用户。
4. Gateway 设置短时 `HttpOnly; Secure` 会话 Cookie，并 302 到 Harness 页面。
5. Gateway 对后续 HTTP 请求和 WebSocket upgrade 都校验 Cookie；会话过期后关闭流并要求 iframe 重新 bootstrap。
6. 主站退出登录时同时调用 Gateway logout，清除嵌入 Cookie。即使清理失败，Gateway 会话也必须在短时有效期结束后失效。

bootstrap token 不写入日志，不进入 Harness，不作为长期 Cookie 保存。nonce 需要防重放存储；单 NAS 单实例可先使用进程内 TTL Map，Gateway 重启只会使未使用 token 失效。

## 网络与域名

Cloudflare Tunnel 新增 `agent.mislw.cn` 路由，只指向 Harness Auth Gateway。Harness 容器不映射 NAS 主机端口，仅在 Compose 私有网络监听。

Gateway 保留外部 `Host` 和 `Origin` 语义，将 HTTP、WebSocket、状态码和流式帧透明代理到 Harness。Harness 的 `trustedHosts` 只包含实际公开 authority 和必要的内部健康检查 authority。

不得用 `0.0.0.0:3080` 直接发布 NAS 端口。Harness 若需要在 Compose 网络内监听 `0.0.0.0`，必须由 Cordis 部署 patch 设置，并由 Gateway 作为唯一入口。

## 容器与持久化

Compose 增加：

- `harness`: Node `22.19+`，运行固定版本 Harness Web Host。
- `harness-gateway`: 承担 SSO、HTTP/WebSocket 代理、CSP 和健康检查。
- `harness-home` volume: 保存会话、设置、凭据引用、附件和投影缓存。
- `harness-workspace` volume: 模型可以工作的专用目录。

不得把现有 AI 工作站应用目录、Supabase 数据目录、Compose 目录或整个 NAS 目录默认挂给 Harness。后续需要操作真实文件时，每个目录必须单独声明挂载范围和读写模式。

容器使用非 root 用户，设置 CPU、内存和进程数限制，并限制日志大小。资源上限先保守配置，再根据真实长会话、工具和子代理负载调整；不以一次 HTTP 200 代替持续运行验收。

## Harness 能力与权限

完整表层保留模型选择、会话、历史、取消、审批、工具展示、计划、目标、子代理和工作流。默认 Agent preset 不能直接沿用无限制权限：

- 默认使用 `workspace-write` 和 `ask`。
- Shell、文件修改、网络访问和高风险工具遵循 Harness 审批面板。
- `danger-full-access` 即使启用，也只能获得 Harness 容器和明确挂载目录的权限，不能突破到 NAS 主机。
- 不挂载 Docker Socket，不授予 privileged，不使用 host network。
- 工具子进程必须验证凭据环境清理。若无法证明 Shell 无法读取 DeepSeek Key 或其他宿主凭据，Shell 上线必须失败关闭，改用无凭据执行 sidecar 后再开放。
- 子代理继承相同或更严格的目录与审批边界，不能通过子代理绕过主会话权限。

## AI 工作站业务工具

嵌入稳定后增加独立的 `ai-workspace-tools` Harness 插件或 MCP 服务，提供：

- 待读取：列出和搜索待办、笔记、日历。
- 草稿操作：生成待办、笔记和日程建议。
- 受控写入：创建、修改、完成或删除业务数据。

工具只调用 AI 工作站内部 API，不直接持有 Supabase Service Role Key。内部 API 根据短时服务凭据固定映射到唯一 owner 用户，并继续依赖数据库约束和 RLS 语义。

所有写操作必须返回结构化预览，并由 Harness 审批或 AI 工作站确认界面明确确认后执行。批量删除、覆盖笔记和修改日程属于高风险操作，不允许静默执行。现有“提取待办”确认弹窗在业务工具完成替代前继续保留。

## 故障处理

- Harness 未启动：`/assistant` 显示服务不可用，不循环刷新 iframe。
- Gateway 认证失败：返回 401/403，不把 Harness 错误页伪装成登录成功。
- WebSocket 断线：Harness UI 按现有协议重连；Gateway 不缓存或重排帧。
- Harness 升级失败：回滚镜像版本，保留 `harness-home` 备份，不自动迁移后覆盖唯一副本。
- 模型 API 不可用：保留会话和输入，不影响工作站其他页面。
- 工具审批未回答：保持待处理状态，不默认允许。
- 业务工具写入失败：返回明确错误，不把模型生成内容当作数据库已写入。

## 分阶段交付

### 阶段一：完整 Harness 表层

- 部署 Harness 和 Auth Gateway。
- 配置 `agent.mislw.cn`、Cloudflare Tunnel 和 SSO。
- 增加 `/assistant` 全屏嵌入页与导航。
- 验证会话、历史、流式输出、停止、模型选择、审批、工具、子代理、工作流和重启持久化。
- 完成容器权限、挂载和凭据隔离验收。

### 阶段二：AI 工作站业务联动

- 增加待办、笔记和日历的只读工具。
- 增加带预览和确认的写入工具。
- 将现有快捷 AI 操作逐项迁移或保留为确定性备用路径。
- 验证用户隔离、错误回滚、重复提交和审计日志。

阶段一可独立上线使用，但“完整接入”只有在阶段二业务工具验收后才整体完成。

## 测试与验收

自动化测试覆盖：

- bootstrap token 签名、过期、nonce 重放和错误用户。
- 未登录用户无法获得 iframe URL。
- Gateway HTTP 与 WebSocket 都拒绝无 Cookie 请求。
- CSP 只允许 `ai.mislw.cn` 嵌入。
- `/assistant` 的加载、失败、重试和移动端布局。
- logout 后 Gateway 会话失效。
- 业务工具的 owner 固定、输入校验、确认和重复请求幂等性。

NAS 实机验收覆盖：

- 从 `https://ai.mislw.cn/assistant` 无二次登录进入 Harness。
- 直接访问 `https://agent.mislw.cn` 未认证时被拒绝。
- 流式消息、停止生成、刷新恢复和 NAS 重启恢复正常。
- WebSocket 经 Cloudflare Tunnel 长时间稳定。
- 文件和 Shell 只能访问专用 workspace，无法读取宿主目录、Compose 文件、Supabase 密钥或 Docker Socket。
- 工具审批拒绝后没有副作用。
- 待办、笔记和日历写入必须经过确认，且数据库实际结果与界面一致。

构建成功、容器 healthy、页面 HTTP 200 和模型自述均不是完整验收；必须完成对应浏览器、WebSocket、文件权限和数据库结果检查。

## 实施边界

两个仓库当前都有用户未提交修改。实施时只修改明确列入计划的文件，不回退、覆盖或顺手整理其他改动。密钥只进入 NAS 环境配置，不写入 Git、构建上下文、日志、设计文档或测试快照。
