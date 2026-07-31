# Personal AI Workspace — 开发计划

> 个人 AI 工作台，基于 Next.js 14（App Router）+ Supabase + Tailwind + shadcn/ui + PWA。
> 黑白灰极简风格，电脑/平板/手机三端实时同步，AI 整理 + 腾讯文档适配层。

---

## 1. 功能拆分（按用户验收 15 条对应）

| # | 验收项 | 拆分到的模块 | 状态 |
|---|---|---|---|
| 1 | 注册登录 | `auth/*` 页面 + Supabase Auth + 中间件 | ✅ 第一版 |
| 2 | 多端访问 | 响应式 + PWA | ✅ |
| 3 | 数据自动同步 | Supabase Realtime 订阅 | ✅ |
| 4 | 今日待办管理 | `todos` 表 + `todos` 页面 + 乐观更新 | ✅ |
| 5 | 日历与日程 | `calendar_events` 表 + `calendar` 页面 | ✅ |
| 6 | 笔记 CRUD + 搜索 | `notes` 表 + `notes` 页面 + 自动保存 | ✅ |
| 7 | 笔记自动保存 | debounce 1200ms + 状态指示 | ✅ |
| 8 | 首页当日信息 | 工作台 4 概览卡片 + 问候语 | ✅ |
| 9 | AI 总结/提取 | `AIProvider` + 工作台 AI 助手 | ✅ |
| 10 | AI 待办需确认 | `ai_suggestions` 中间态 + 用户确认 | ✅ |
| 11 | 腾讯文档链接 | `document_links` 表 + `/documents` | ✅ |
| 12 | 笔记导出 | Markdown/TXT/复制 | ✅ |
| 13 | 未配置降级 | `isAIConfigured` / `isTencentDocsConfigured` 降级 | ✅ |
| 14 | 三端布局 | 桌面侧边栏 + 平板折叠 + 手机底部 nav | ✅ |
| 15 | 数据隔离 | RLS Policy + 中间件 + Zod | ✅ |

---

## 2. 页面结构（路由）

```
公开路由（middleware 不拦截已登录）：
  /login                    邮箱密码登录
  /register                 注册账号
  /forgot-password          忘记密码入口

受保护路由（middleware 强制登录）：
  /                         重定向到 /workspace
  /workspace                工作台首页
  /calendar                 日历月视图 + 当日详情
  /todos                    今日待办 + 全部待办
  /notes                    笔记列表
  /notes/[id]               笔记编辑
  /documents                腾讯文档链接管理
  /settings                 个人设置（主题、AI 配置提示、安全退出）
```

---

## 3. 数据库结构（Supabase PostgreSQL）

| 表 | 关键字段 | RLS |
|---|---|---|
| `profiles` | id (=auth.uid), display_name, avatar_url, created_at | 读写自己的 |
| `user_settings` | user_id, theme (light/dark/system), updated_at | 读写自己的 |
| `todos` | id, user_id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at | 读写自己的 |
| `calendar_events` | id, user_id, title, description, event_date, start_time, end_time, is_all_day, created_at, updated_at | 读写自己的 |
| `notes` | id, user_id, title, content, summary, tags[], is_pinned, version, last_edited_at, created_at, updated_at | 读写自己的 |
| `document_links` | id, user_id, title, document_url, note, last_opened_at, created_at, updated_at | 读写自己的 |
| `ai_action_logs` | id, user_id, action_type, model, success, prompt_tokens, completion_tokens, duration_ms, error_code, created_at | 写自己 + 读自己 |

> 全部使用 `uuid` + `gen_random_uuid()`，全部启用 RLS，索引覆盖 `user_id` / `due_date` / `event_date` / `updated_at`，`updated_at` 由触发器自动维护。
> 笔记额外存 `version` 字段用于冲突检测；不保存 AI 完整对话内容，仅元数据。

---

## 4. 文件目录

```
personal-ai-workspace/
├─ .env.example
├─ .gitignore
├─ README.md
├─ PLAN.md
├─ package.json
├─ next.config.mjs
├─ tsconfig.json
├─ tailwind.config.ts
├─ postcss.config.mjs
├─ components.json
├─ middleware.ts
├─ public/
│  ├─ manifest.json
│  ├─ icons/icon-192.png / icon-512.png / icon-maskable.png
│  └─ sw.js (或由 next-pwa 注入)
├─ supabase/
│  └─ init.sql
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ globals.css
│  │  ├─ page.tsx                       (重定向 → /workspace)
│  │  ├─ (auth)/
│  │  │  ├─ login/page.tsx
│  │  │  ├─ register/page.tsx
│  │  │  └─ forgot-password/page.tsx
│  │  ├─ (app)/                         (受保护布局)
│  │  │  ├─ layout.tsx                  侧边栏 + 顶部栏 + 主题
│  │  │  ├─ workspace/page.tsx
│  │  │  ├─ calendar/page.tsx
│  │  │  ├─ todos/page.tsx
│  │  │  ├─ notes/page.tsx
│  │  │  ├─ notes/[id]/page.tsx
│  │  │  ├─ documents/page.tsx
│  │  │  └─ settings/page.tsx
│  │  └─ api/
│  │     ├─ ai/route.ts                 POST { action, payload } → AI
│  │     └─ health/route.ts
│  ├─ components/
│  │  ├─ ui/                            shadcn 原子组件
│  │  ├─ layout/                        AppShell / Sidebar / TopBar / MobileNav
│  │  ├─ workspace/                     Greeting / OverviewCards / TodayTodos / QuickNote / WeekStrip / AiAssistant / RecentDocs
│  │  ├─ todos/                         TodoList / TodoItem / TodoForm / FilterBar
│  │  ├─ calendar/                      MonthGrid / DayDetail / EventForm
│  │  ├─ notes/                         NoteList / NoteEditor / NoteTags / ConflictDialog
│  │  ├─ documents/                     DocumentList / DocumentForm
│  │  ├─ ai/                            AiSuggestionDialog
│  │  └─ common/                        EmptyState / ErrorState / ConfirmDialog / Toast
│  ├─ lib/
│  │  ├─ supabase/
│  │  │  ├─ client.ts                   浏览器端
│  │  │  ├─ server.ts                   服务端 (cookies)
│  │  │  └─ middleware.ts               中间件 refresh
│  │  ├─ ai/
│  │  │  ├─ provider.ts                 AIProvider 接口 + factory
│  │  │  ├─ openai-compatible.ts        OpenAI 兼容实现
│  │  │  └─ prompts.ts                  提示词模板
│  │  ├─ tencent-docs/
│  │  │  ├─ provider.ts                 TencentDocsProvider 接口
│  │  │  └─ noop.ts                     未配置时的降级实现
│  │  ├─ data/                          todos/notes/events/docs 数据访问层
│  │  ├─ realtime/                      订阅 hooks (useTodosRealtime / useNotesRealtime …)
│  │  ├─ stores/                        Zustand stores
│  │  ├─ schemas/                       Zod schemas
│  │  ├─ theme.ts                       主题切换
│  │  ├─ date.ts                        星期/问候/格式化
│  │  └─ logger.ts                      脱敏日志
│  ├─ hooks/                            useAuth / useDebounce / useMediaQuery / useRealtimeChannel
│  ├─ types/                            database.ts (Supabase types) + domain.ts
│  └─ tests/                            vitest 单元/集成测试
```

---

## 5. 开发顺序（严格按用户 9 步走）

1. **阶段 0**：本计划文档 ✅
2. **阶段 1**：项目骨架 + 依赖 + 主题/全局样式
3. **阶段 2**：`supabase/init.sql` + Supabase 客户端 + 登录/注册/忘记密码
4. **阶段 3**：工作台 + 待办 + 日历 + 笔记（核心业务）
5. **阶段 4**：Realtime 订阅 + 乐观更新 + 冲突检测
6. **阶段 5**：AI Provider + 工作台 AI 助手 + 笔记 AI + 待办确认
7. **阶段 6**：腾讯文档链接 + 笔记导出 + 适配层
8. **阶段 7**：PWA + 响应式 + 主题
9. **阶段 8**：README + 测试 + 错误处理收尾

---

## 6. 潜在风险与对策

| 风险 | 对策 |
|---|---|
| Supabase RLS 写错导致越权 | 默认 `auth.uid() = user_id`；服务端 API Route 二次校验；提供 SQL 测试 |
| 自动保存产生大量写 | debounce 1200ms + 远端 `version` 变更检测；离开页面前 flush |
| 笔记冲突覆盖 | 远端 version > 本地 version → 冲突弹窗（保留本地/加载云端） |
| AI 接口未配置 | 服务端 `isAIConfigured` 标志；前端明确降级提示，禁止伪造成功 |
| API Key 泄露 | 强制只在 `process.env` (Node) 读取；前端 bundle 中不存在；`NEXT_PUBLIC_` 前缀禁用 |
| 腾讯文档 Token 泄露 | Token 仅服务端；`document_links` 不存 token；未配置时禁用同步入口 |
| Realtime 重复插入 | 使用 `id` 主键去重；列表 Map 合并而非 push |
| 移动端键盘遮挡保存 | 编辑器固定底部"保存"条，置于 safe-area 之上 |
| 大笔记 Markdown 渲染卡顿 | 服务端轻量 markdown-it + 简单字符限制（单篇 ≤ 200KB） |
| shadcn 组件与暗色主题冲突 | 全部基于 CSS 变量 + 主题 token 化；手写 `globals.css` 调色板 |
| PWA Service Worker 缓存策略错乱 | 仅缓存静态资源 + 已访问页面壳；不缓存 `/api/*` 与 Supabase 数据 |

---

## 7. 安全设计

- 服务端 API Route 必须用 `createServerClient` 拿到 `auth.uid()`，所有 DB 写入带 `user_id`。
- 前端 Supabase client 使用 `anon` key + RLS；Service Role Key 仅在服务端 `.env`。
- Zod 校验所有 API body / 表单输入。
- 标题/笔记内容做长度上限与基础 HTML 剥离（react 不渲染 raw HTML 即可）。
- 链接校验：必须 `https://docs.qq.com/...` 或 `https://*.qq.com/...` 之类白名单。
- 日志：仅记 action/result/error code，不记 token / 笔记全文。
- 退出登录：清空 Zustand 内存 + Supabase session + localStorage 中草稿。

---

## 8. 验收对照（用户 15 条）

每条对应阶段 3–8 中的具体实现点；测试用例见 `src/tests/`。
