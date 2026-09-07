# Personal AI Workspace Desktop

这是现有在线工作台的 Windows Tauri 客户端。它不保存第二套业务数据，也不提供离线编辑；Supabase、NAS、Hermes 和知识库服务必须处于可访问状态。

## 开发运行

```powershell
npm install
npm --prefix apps/desktop install
npm run desktop:dev
```

默认连接 `https://ai.mislw.cn`。需要构建到其他工作台时，在启动构建命令前设置编译期环境变量：

```powershell
$env:AI_WORKSPACE_DESKTOP_URL = "https://your-workspace.example.com"
npm run desktop:build
```

Release URL 只接受 HTTPS。

## 验证与打包

```powershell
npm run desktop:check
npm run desktop:build
```

NSIS 安装包输出到：

```text
apps/desktop/target/release/bundle/nsis/
```

桌面壳没有为远程网页注册 Tauri command，也没有启用 Shell、Filesystem 或 Process 插件。跨域 HTTPS 链接由系统默认浏览器打开。
