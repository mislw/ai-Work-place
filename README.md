# Personal AI Workspace · Personal AI 工作站

> 简洁、私密、支持多端同步的个人工作管理平台。
> Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase + Realtime + PWA + AI + 腾讯文档链接。

![status](https://img.shields.io/badge/status-v0.1-black) ![license](https://img.shields.io/badge/license-MIT-black)

---

## 功能

- ✅ 邮箱 + 密码注册/登录、忘记密码、退出登录
- ✅ 工作台首页：问候语、4 个概览卡片、今日待办、快速笔记、本周日历、AI 助手、最近文档
- ✅ 今日待办：增删改查、优先级、日期/时间、按状态/优先级/时间筛选、乐观更新
- ✅ 日历：月视图、当日详情、新建/编辑/删除、全天
- ✅ 笔记：列表、标签、置顶、搜索、Markdown、自动保存（1200ms debounce）、版本冲突检测、导出 Markdown/TXT
- ✅ 腾讯文档：链接管理（白名单校验）、最近使用、未配置时降级提示
- ✅ AI 助手：OpenAI 兼容接口、支持总结笔记/提取待办/生成日报/安排任务/笔记内总结/润色/提取行动项
- ✅ AI 创建待办前需用户确认（不会自动写入）
- ✅ Supabase Realtime 多端同步：todos / events / notes / documents
- ✅ 主题：明亮 / 暗色 / 跟随系统，持久化到 `user_settings`
- ✅ PWA：manifest、添加到主屏幕、安全区适配
- ✅ 响应式：电脑侧边栏 / 手机底部导航 / 平板折叠
- ✅ 安全：RLS 全表启用、Zod 校验、脱敏日志、API Key 仅服务端

---

## 一、本地启动

### 1. 安装依赖

```bash
cd personal-ai-workspace
npm install
# 或 pnpm install / yarn
```

### 2. 创建 Supabase 项目

1. 打开 https://supabase.com/dashboard 并新建项目
2. 等待项目就绪后，在 **SQL Editor** 中打开 `supabase/init.sql` 并执行
3. 进入 **Authentication → Providers → Email**，按需启用"Confirm email"（关闭可立即登录）
4. 进入 **Project Settings → API**：
   - 复制 **Project URL** 到 `NEXT_PUBLIC_SUPABASE_URL`
   - 复制 **anon public** key 到 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - 复制 **service_role** key 到 `SUPABASE_SERVICE_ROLE_KEY`（**仅服务端使用**）

### 3. 配置环境变量

```bash
cp .env.example .env
```

填入以下最小必需项（AI / 腾讯文档可不填）：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### 4. 启动开发服务器

```bash
npm run dev
# 打开 http://localhost:3000
```

### 5. 创建第一个账号

公开注册已关闭，仅允许现有账号登录。
如果开启了邮箱验证，请先在邮箱中点击确认链接。

---

## 二、Supabase 配置说明

### 启用 Realtime

`init.sql` 末尾已经执行了：

```sql
alter publication supabase_realtime add table public.todos;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.document_links;
```

如未生效，请在 Supabase Dashboard → **Database → Replication** 中手动勾选以上 4 张表。

### 验证 RLS

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public';
-- 全部应为 true

select * from pg_policies where schemaname = 'public';
-- 业务表至少 4 条策略 (select/insert/update/delete)
```

### 自动创建 profile / user_settings

`init.sql` 中的 `handle_new_user()` 触发器会在用户注册时自动创建 `profiles` 和 `user_settings` 行（包含默认主题 `system`）。

---

## 三、AI 接口配置

### OpenAI 官方

```
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

### 兼容 OpenAI 的国产 / 私有部署

只要端点符合 `POST {baseURL}/chat/completions` 即可，例如：

| 提供方 | 示例 BASE_URL | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OneAPI | `http://localhost:3001/v1` | 自定义 |

### 未配置时

- 工作台 AI 助手、笔记内 AI 按钮显示"未配置"并禁用
- `/api/health` 返回 `{ "ai": false, ... }`
- 普通功能（待办、日历、笔记、文档）**完全可用**

---

## 四、个人知识收件箱

助手页支持上传 PDF、DOCX、Markdown/TXT 和 PNG/JPEG/WebP。文件先写入私有隔离区，注册到 PostgreSQL 队列后由独立 Worker 完成：

```text
上传 -> MIME 校验/SHA-256 -> 文本提取或 OCR -> 结构分块
     -> PostgreSQL 全文索引 -> AI 摘要和归档/笔记/待办/日程建议
     -> 用户逐项确认 -> 工作台数据 + 来源关系
```

必须配置：

```dotenv
KNOWLEDGE_STORAGE_ROOT=/data/knowledge
KNOWLEDGE_MAX_FILE_BYTES=52428800
KNOWLEDGE_OCR_LANGUAGES=chi_sim+eng
KNOWLEDGE_WORKER_POLL_MS=1500
SUPABASE_SERVICE_ROLE_KEY=server-only
```

开发环境启动 Worker：

```bash
npm run knowledge:worker
```

- `KNOWLEDGE_STORAGE_ROOT` 必须是 Web App 和 Worker 都能访问的持久化私有目录。
- `SUPABASE_SERVICE_ROLE_KEY` 仅限 Route Handler / Worker，严禁使用 `NEXT_PUBLIC_` 前缀。
- Worker 未启动时上传会停留在队列；AI 未配置时仍会完成提取、分块和全文检索，并标记为需要人工确认。
- Phase 1 只提供 PostgreSQL 全文检索。Obsidian Vault 连接、pgvector、Embedding、混合召回和重排尚未实现。
- `supabase/init.sql` 的知识库表和 RPC 必须单独应用后，真实上传链路才能使用；本地构建成功不代表数据库迁移已执行。

---

## 五、腾讯文档适配层说明

### 第一版实现

- `TencentDocsProvider` 接口已定义（`createDocument / appendContent / getDocument / searchDocuments`）
- 默认提供 `NoopTencentDocsProvider`：所有操作明确报错，**不伪造同步成功**
- 当未配置 `TENCENT_DOCS_*` 环境变量时：
  - 文档页面显示"尚未连接腾讯文档"
  - 仍然可以保存、打开、备注腾讯文档链接
  - 不影响笔记导出

### 启用真实 API（待后续实现）

在 `.env` 中配置：

```
TENCENT_DOCS_BASE_URL=https://docs.qq.com/openapi
TENCENT_DOCS_ACCESS_TOKEN=...
TENCENT_DOCS_CLIENT_ID=...
TENCENT_DOCS_CLIENT_SECRET=...
```

实现 `src/lib/tencent-docs/real.ts`（参考 `provider.ts` 接口），并在 `index.ts` 工厂中按配置切换。

### 明确不做（第一版）

- 双向实时同步
- 自动监听远端变化 / 冲突合并
- 多人协作权限、自动删除同步
- 笔记 → 腾讯文档的直接推送

---

## 六、Vercel 部署

1. 推送到 GitHub 仓库
2. 在 Vercel 中点击 **Import Project**
3. 框架预设选择 **Next.js**
4. 填入环境变量（同 `.env`），特别注意：
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 仍由 Vercel 注入到浏览器
   - `SUPABASE_SERVICE_ROLE_KEY` / `AI_*` / `TENCENT_DOCS_*` 仅在 Server Runtime 可见
5. 部署完成后访问生成的域名即可

> Supabase + Vercel 默认跨域可访问。如遇 CORS 报错，在 Supabase **Authentication → URL Configuration** 中把 Vercel 域名加进 *Site URL* 和 *Additional Redirect URLs*。

---

## 七、PWA 安装

### iOS Safari
1. 用 Safari 打开部署后的网址
2. 点击底部分享按钮 → "添加到主屏幕"
3. 主屏幕会出现 "AI 工作站" 图标，点击像 App 一样启动

### Android Chrome
1. Chrome 打开网站
2. 右上角菜单 → "添加到主屏幕" / "安装应用"
3. 桌面出现图标

桌面浏览器（Chrome/Edge）地址栏右侧也会出现"安装"按钮。

---

## 八、数据库表结构

| 表 | 说明 | 关键字段 |
|---|---|---|
| `profiles` | 用户资料（1:1 with auth.users） | display_name, avatar_url |
| `user_settings` | 主题 | theme (`light/dark/system`) |
| `todos` | 待办 | title, status, priority, due_date, due_time |
| `calendar_events` | 日程 | title, event_date, start_time, end_time, is_all_day |
| `notes` | 笔记 | title, content, summary, tags[], is_pinned, **version** |
| `document_links` | 腾讯文档链接 | title, document_url, note, last_opened_at |
| `ai_action_logs` | AI 操作日志 | action_type, model, success, prompt_tokens, completion_tokens, duration_ms |
| `file_assets` | 私有源文件元数据 | storage_key, mime_type, size_bytes, sha256, status |
| `knowledge_documents` | 知识条目与分析摘要 | asset_id, collection_id, status, stage, summary |
| `document_versions` / `document_chunks` | 版本、正文与全文检索分块 | content_hash, parser, content, page_start, heading_path |
| `knowledge_proposals` / `knowledge_relations` | 待确认建议与来源关系 | kind, payload, status, source_id, target_id |
| `ingestion_jobs` | Worker 队列、租约和进度 | status, stage, progress, attempt_count, lease_expires_at |

- 所有业务表启用 RLS：`auth.uid() = user_id`
- `updated_at` 由 `set_updated_at()` 触发器自动维护
- `notes.version` 每次内容变更 +1，用于冲突检测
- `ai_action_logs` **不**保存 AI 对话全文，仅元数据

---

## 九、测试方法

```bash
npm run typecheck    # TypeScript 严格检查
npm run lint         # ESLint
npm run test         # vitest 单元测试
npm run build        # 生产构建（含 RSC 类型检查）
```

### 已覆盖的测试

- `schemas.test.ts`：登录/注册/待办/文档链接表单校验
- `date.test.ts`：问候语、中文日期、星期、周范围、HH:mm
- `tencent-docs.test.ts`：未配置降级、链接白名单
- `ai.test.ts`：AI 配置探测
- `logger.test.ts`：脱敏日志
- `data-store.test.ts`：Realtime upsert/remove 路径无重复
- `knowledge-*.test.ts(x)`：私有上传、MIME 校验、PDF/DOCX/OCR、分块、Worker、分析、检索、确认和助手上传交互

### 手工验证（对照验收 15 条）

1. 使用现有账号登录 → 登录后跳到 `/workspace`
2. 直接访问 `/workspace` 未登录会跳到 `/login`
3. 创建一条待办 → 打开第二个浏览器登录同一账号 → 应在 1 秒内出现
4. 在手机尺寸打开 → 侧边栏隐藏、底部 4 项导航出现
5. 添加一篇笔记 → 停笔 1.2 秒 → 状态显示"已保存"
6. 故意关掉 AI 环境变量 → 助手卡片显示"未配置"且不可点
7. 添加一条腾讯文档链接 → 故意填非 qq.com 链接 → 提示"仅支持 docs.qq.com / *.qq.com"
8. 用 2 个浏览器同时编辑同一篇笔记 → 后保存的一端会显示"远端版本更新"冲突弹窗

---

## 十、第一版已完成 vs 暂未完成

### ✅ 已完成

- 注册 / 登录 / 退出 / 忘记密码
- 工作台首页（问候语、4 卡片、今日待办、快速笔记、本周日历、AI 助手、最近文档）
- 待办 CRUD + 筛选 + 排序 + 乐观更新 + 删除确认 + Toast
- 日历月视图 + 日程 CRUD
- 笔记列表 / 编辑器 / 搜索 / 标签 / 置顶 / 自动保存 / 冲突检测 / 导出
- 多端实时同步（4 张业务表）
- AI 工作助手（4 个快捷动作 + 自由问答）
- 笔记内 AI（总结 / 润色 / 提取行动项）
- AI 创建待办前用户确认
- 腾讯文档链接管理 + 链接白名单校验 + 未配置降级
- 笔记导出 Markdown / TXT / 复制
- 主题切换（明 / 暗 / 跟随系统）持久化
- PWA manifest + safe-area
- 响应式（电脑 / 平板 / 手机）
- RLS 全表启用 + Zod 校验 + 脱敏日志
- Supabase 触发器自动维护 `updated_at` / 笔记 version
- TypeScript 严格模式 + ESLint + Vitest
- 助手知识收件箱：多文件上传、双并发队列、PDF/DOCX/图片提取、OCR、全文索引、归档与工作台建议确认

### ⏳ 暂未完成 / 后续路线图

- 腾讯文档 OAuth 接入与双向同步（接口已就位，等你提供账号）
- 笔记富文本编辑器（当前是基础 Markdown 文本）
- 拖拽修改日程 / 重复事件
- 离线写队列（offline → online 自动同步）
- 多账号工作区共享
- 拖拽排序待办
- 邮件 / 推送通知
- 移动端原生 App 打包（Capacitor / Tauri）
- Obsidian Vault 双向连接与冲突安全插件
- pgvector Embedding、混合检索、重排与引用评测

---

## 十一、目录结构

```
personal-ai-workspace/
├─ PLAN.md                  # 开发计划
├─ README.md                # 本文件
├─ package.json
├─ tsconfig.json            # 严格模式
├─ next.config.mjs          # 含 next-pwa
├─ tailwind.config.ts
├─ components.json          # shadcn 配置
├─ middleware.ts            # 登录态拦截
├─ .env.example
├─ public/
│  ├─ manifest.json
│  └─ icons/icon.svg
├─ supabase/init.sql        # 一次性建表 + RLS + 触发器
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ globals.css        # 主题变量 / 滚动条 / safe-area
│  │  ├─ page.tsx           # 重定向到 /workspace
│  │  ├─ (auth)/            # 登录/注册/忘记密码
│  │  ├─ (app)/             # 受保护布局
│  │  │  ├─ layout.tsx      # 侧边栏 + 顶部栏 + 底部导航
│  │  │  ├─ workspace/
│  │  │  ├─ calendar/
│  │  │  ├─ todos/
│  │  │  ├─ notes/
│  │  │  ├─ notes/[id]/
│  │  │  ├─ documents/
│  │  │  └─ settings/
│  │  └─ api/
│  │     ├─ ai/route.ts     # AI 入口
│  │     ├─ health/route.ts # 能力探测
│  │     ├─ user-settings/  # 主题持久化
│  │     └─ notes/flush/    # 离开页面前最后一次保存
│  ├─ components/
│  │  ├─ ui/                # 16 个 shadcn 基础组件
│  │  ├─ common/            # EmptyState / ErrorState / ConfirmDialog / ThemeScript
│  │  ├─ layout/            # Sidebar / TopBar / PageHeader
│  │  ├─ workspace/         # Greeting / OverviewCards / TodayTodos / QuickNote / WeekStrip / AiAssistant / RecentDocs
│  │  ├─ todos/             # TodoFormDialog
│  │  ├─ calendar/          # EventFormDialog
│  │  ├─ notes/             # NewNoteDialog
│  │  ├─ documents/         # useDocumentOpen
│  │  └─ ai/                # AiSuggestionDialog
│  ├─ hooks/                # useAuth / useRequireAuth / useDebounce / useMediaQuery / useRealtime / useBootstrapData
│  ├─ lib/
│  │  ├─ ai/                # provider / openai-compatible / prompts
│  │  ├─ tencent-docs/      # provider / noop / client
│  │  ├─ supabase/          # client / server / middleware / guards
│  │  ├─ data/              # todos / notes / events / documents 数据访问
│  │  ├─ stores/            # Zustand 数据/能力 store
│  │  ├─ schemas.ts         # Zod
│  │  ├─ date.ts            # 中文日期 / 问候语
│  │  ├─ theme.ts           # 主题切换（不闪烁）
│  │  ├─ logger.ts          # 脱敏日志
│  │  └─ utils.ts
│  ├─ types/domain.ts
│  └─ tests/                # vitest 单元测试
```

---

## 本地工具箱

运行 `npm run toolbox:local`，或双击
`tools/local-toolbox/启动本地工具箱.cmd`。工作台的“工具箱”只负责检查和打开
本机页面；压缩文件、输出路径和密码不会上传到工作台、NAS 或云端。

“解压小工具”需要本机安装 WinRAR，支持普通 ZIP、RAR、7z、数字分卷、
伪装后缀和嵌套压缩包。原始压缩包和分卷会保留，已有输出不会被覆盖。

---

## License

MIT — 自由用于个人与商用。
