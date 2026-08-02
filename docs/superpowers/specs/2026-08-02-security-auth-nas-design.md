# 安全、登录与 NAS 部署改造设计

## 目标与范围

本轮改造解决当前仓库中优先级最高的安全和可靠性问题，并让应用可以通过 Docker 部署到 NAS。范围包括：依赖安全升级、Supabase 登录会话修复、安全的登录后跳转、AI 请求校验与用户级限流、数据库错误处理、持续集成，以及 NAS 部署文件。

暂不改造业务列表分页和 Supabase 数据库迁移体系；这两项需要单独制定数据兼容策略。

## 部署架构

NAS 只运行 Next.js 应用容器，Supabase 继续提供托管的 Auth、PostgreSQL、RLS 和 Realtime。容器通过环境变量读取 Supabase URL、anon key、AI provider 配置与公开站点地址。镜像采用多阶段构建，最终运行 Next.js standalone 产物，使用非 root 用户并提供健康检查。

仓库新增通用 `Dockerfile`、`.dockerignore` 和 `docker-compose.yml`，不绑定群晖、威联通或 Unraid 的专有功能。NAS 只要支持 Docker Compose 或 Container Manager 即可运行。所有密钥只从 NAS 环境文件注入，不写入镜像或 Git。

## 登录与会话

根 middleware 使用 `@supabase/ssr` 创建服务端客户端，通过 `auth.getUser()` 验证并刷新会话 cookie，不再猜测固定 cookie 名。未登录用户访问应用页时跳转到 `/login?next=...`；已登录用户访问认证页时跳转到 `/workspace`。

登录页只接受站内绝对路径作为 `next`：必须以单个 `/` 开头，拒绝 `//`、协议 URL、反斜杠及控制字符。无效值统一回退到 `/workspace`。登录逻辑增加针对该行为的单元测试。

Supabase Dashboard 需要把 NAS 的 HTTPS 地址加入 Site URL 和 Redirect URLs。应用不会内置账号或绕过 Supabase；用户仍通过注册页创建账号，或使用 Supabase Dashboard 中已有账号登录。

## API 安全与错误处理

AI 请求 schema 按 action 限定可接受的 context 字段、数组数量和文本长度，客户端不能自行注入 system/assistant 消息。API 在调用模型前执行用户级限流，默认每用户每分钟 10 次；限流存储先使用进程内固定窗口，适用于单 NAS 单实例部署。响应包含标准 `429` 和 `Retry-After`。

AI 日志写入失败不应覆盖已经成功生成的模型响应，但必须写脱敏日志。主题设置等关键数据库写入必须检查 Supabase error，并在失败时返回 5xx，而不是错误地返回成功。

## 依赖与 PWA

Next.js 升级到兼容当前 React 18 代码的已修补受支持版本，并同步 `eslint-config-next`。停止使用维护停滞且带来高危依赖链的 `next-pwa`；改为保留 manifest，同时移除构建生成的 service worker 文件和 PWA webpack 包装。离线缓存不属于本轮目标，避免继续发布存在风险且容易陈旧的缓存代码。

## 测试与 CI

所有行为变更遵循测试优先：先为安全跳转、AI schema、限流和 API 错误转换写失败测试，再实现最小修复。GitHub Actions 在 Node LTS 上执行 `npm ci`、`npm run typecheck`、`npm run lint`、`npm run test`、`npm run build` 和生产依赖审计。

本地完成同一组检查，并使用 `docker compose config` 与镜像构建验证 NAS 部署文件。由于真实登录需要有效 Supabase 项目，自动化覆盖会话分支，最终登录联调通过 README 中的 NAS 验收步骤完成。

## 验收标准

- 使用有效 Supabase 账号可从 NAS 地址登录并进入 `/workspace`。
- 未登录访问受保护页面会跳转登录页，会话刷新后不会误判退出。
- 恶意或外部 `next` 参数不能触发站外跳转或脚本 URL。
- AI 请求超过用户级额度返回 429，异常 context 返回 400。
- 数据库写入失败不会返回成功。
- 生产依赖审计不再包含当前 Next.js/next-pwa 高危链。
- NAS 可用 `docker compose up -d` 启动，密钥不进入镜像和仓库。
- CI 的类型检查、lint、单测和生产构建全部通过。

## 明确假设

- NAS 支持 Docker Compose/Container Manager，并能对外提供 HTTPS 反向代理。
- 本轮不在 NAS 自托管 Supabase；数据库、Auth 和 Realtime 使用现有 Supabase 项目。
- NAS 运行单个应用实例，因此进程内 AI 限流满足当前需求；未来横向扩容时再切换 Redis/Upstash。
