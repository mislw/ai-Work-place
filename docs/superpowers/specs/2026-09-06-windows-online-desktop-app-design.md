# Windows Online Desktop App Design

## Goal

把现有 Personal AI Workspace 封装为仅供本人使用的 Windows 桌面 App。桌面 App 与网页继续使用同一个账号、Supabase 数据、NAS 服务、Hermes Runtime 和知识库 Worker；服务开启时可用，服务关闭时明确显示未连接，不提供离线业务编辑。

## Scope

首期包含：

- Windows x64 桌面窗口、应用图标和安装包。
- 启动时检测工作台 `/api/health`。
- 服务正常后加载现有 HTTPS 工作台。
- 服务不可达时显示内置离线页并自动重试，也允许手动重试。
- 只允许 WebView 在配置的工作台 HTTPS Origin 内导航。
- 外部 HTTPS 链接交给 Windows 默认浏览器。
- 复用现有网页登录状态、Supabase Realtime、Hermes、知识库和文件上传接口。

首期不包含：

- 离线数据库、离线编辑或冲突合并。
- 第二套 Supabase、NAS、Hermes 或知识库服务。
- 自动更新桌面壳。
- 开机自启、系统托盘、全局快捷键或原生通知。
- 向远程网页开放 Tauri IPC、Shell、文件系统或任意本机命令。

## Architecture

桌面端位于 `apps/desktop/`，使用 Tauri 2 和 Windows WebView2。Rust 启动层读取编译期工作台 URL，强制其为 HTTPS，并构造固定的健康检查地址。应用先显示打包在二进制中的本地状态页；后台健康检查成功后，原生层把主 WebView 导航至工作台 URL。

远程工作台仍是唯一 UI 和业务实现。Todos、Calendar、Notes、Documents 和设置继续写入现有 Supabase；Realtime 负责网页与桌面 App 的同步。Hermes、Intake 和 Knowledge 功能继续通过现有线上 API/NAS 服务工作。

## Security Boundary

- Release 构建只接受 `https://` 工作台 URL。
- 主 WebView 只允许工作台同 Origin 页面留在 App 内。
- `http://`、不同 Origin、`mailto:` 等导航不会在 App 内获得页面环境；允许的外部 HTTPS 地址交给系统浏览器。
- 不注册供远程页面调用的 Tauri command。
- 不启用 Shell、Filesystem、Process 或 Upload 等 Tauri 插件。
- 本地状态页只显示连接状态，不接触账号和业务数据。
- Supabase Session 由 WebView Cookie/Storage 持有，仍由现有服务端鉴权和 RLS 保护。

## Startup And Failure Flow

1. App 启动并显示“正在连接个人工作台”。
2. Rust 对 `<workspace-origin>/api/health` 发起短超时 GET。
3. HTTP 2xx 时导航到工作台首页。
4. 网络失败、超时或非 2xx 时显示“服务未连接”，并按固定间隔重试。
5. 用户可点击“立即重试”，触发本地页面重新加载；后台检查仍持续进行。
6. 已进入工作台后若服务中断，WebView 可能先显示网络错误；原生健康监控检测失败后回到本地状态页，恢复后再次进入工作台。

## Configuration

- 默认工作台 URL：`https://ai.mislw.cn`。
- 构建时可通过 `AI_WORKSPACE_DESKTOP_URL` 覆盖。
- URL 在编译期写入应用，不从远程页面或普通用户输入读取。
- Product Name：`Personal AI Workspace`。
- Bundle Identifier：`cn.mislw.personal-ai-workspace`。

## Packaging

使用 Tauri Windows NSIS Bundle 输出 x64 安装程序。安装包只包含桌面壳和本地状态页，不包含 Supabase 密钥、AI Key、NAS 凭据、Hermes Secret 或用户业务数据。网页业务更新后无需重打桌面安装包；只有壳层配置、安全策略或图标变化时才需更新。

## Verification

- Rust 单元测试：URL 校验、同 Origin 导航、健康地址生成、外部链接判断。
- Rust 集成构建：`cargo test`、`cargo check`、`cargo tauri build`。
- 安装包静态检查：生成 `.exe`，文件可读取且体积非零。
- 本机运行检查：状态页出现、在线时进入工作台、关闭服务时进入未连接状态、恢复后重连。
- 业务验收：使用同一账号在网页和 PC App 分别创建/修改待办、日历、笔记，确认另一端通过现有 Realtime 更新；再检查 Hermes 和知识库上传。

## Acceptance Boundary

`cargo test` 和安装包生成只证明桌面壳代码与打包成功。只有实际启动安装后的 App、读取在线/离线状态，并完成真实跨端业务操作，才能称为运行验收和数据同步验收完成。
