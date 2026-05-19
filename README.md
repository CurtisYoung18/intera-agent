# Intera — AI 客服产品

Intera 是一个以 AI Agent 为核心的智能客服 SaaS 平台。

## 本地运行

需要 Node.js 18+ 和 npm。

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

项目使用 env 分层：**根目录 `.env`** 存放共享变量（API keys 等），**各应用 `.env.local`** 仅覆盖 `DATABASE_URL`。

**macOS / Linux**

```bash
cp .env.example .env
cp apps/chat/.env.example apps/chat/.env.local
cp apps/console/.env.example apps/console/.env.local
```

**Windows (PowerShell)**

```powershell
copy .env.example .env
copy apps\chat\.env.example apps\chat\.env.local
copy apps\console\.env.example apps\console\.env.local
```

然后编辑根目录 `.env`，填入你的 `ANTHROPIC_AUTH_TOKEN`、`MINIMAX_API_KEY`、`DEEPSEEK_API_KEY`。

### 3. 初始化数据库

```bash
npm run db:push    # 建表（基于 prisma/schema.prisma）
npm run db:seed    # 写入默认 Customer / AgentConfig / Skills / Policies / CaseTypes / Routing
```

> `db:seed` 不是可选步骤。Customer 表里需要有 `id='default'` 这条记录，否则 Console 的 admin 路由在首次写入 AgentConfig / CaseType / Skill / Policy / Routing 时会撞外键（P2003）。
>
> 各 admin 路由内置了 `ensureDefaultCustomer` 兜底（即使没 seed 也不会 500），但 seed 才能拿到完整的演示数据（默认 Skills / Policies / Case 类型等），是预期的开发体验。

### 4. 启动开发服务

```bash
npm run dev:chat      # 客服 Chat 应用 (localhost:3000)
npm run dev:console   # 管理控制台
```

## 调试功能

### Debug Mode — 完整 API 请求/响应日志

在 Console 的 Agent Config 页面开启 `Debug Mode`，系统会将每次 LLM 调用的完整 request/response payload 写入文件。

日志目录：`debug-logs/<caseId>/`

```
debug-logs/abc123/
├── 001-req.json     # 第 1 轮请求
├── 001-resp.json    # 第 1 轮响应
├── 002-req.json
├── 002-resp.json
├── stage_eval_xxx.json  # 阶段评估等独立调用
└── ...
```

- 无需重启，实时生效
- 目录已在 `.gitignore` 中，不会被提交

### Case 导出

将 Case 的完整上下文导出为 Markdown 文件，包含元数据、对话记录、Action Trace、Case Memory、人工任务等。

```bash
# 浏览器访问或 curl 下载
curl http://localhost:3000/api/cases/{caseId}/export -o case-export.md
```

也可在 Console 的 Case 详情页找到导出入口。
