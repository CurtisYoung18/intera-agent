# Intera — AI 客服产品

Intera 是一个以 AI Agent 为核心的智能客服 SaaS 平台。Next.js monorepo（`apps/console` + `packages/shared`），自托管 Ubuntu，服务 `demo.anytrans.ai`。

## 本地运行

需要 Node.js 18+ 和 npm。

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
cp apps/console/.env.example apps/console/.env.local
```

编辑根目录 `.env`，填入 `ANTHROPIC_AUTH_TOKEN`、`MINIMAX_API_KEY`、`DEEPSEEK_API_KEY`。

### 3. 初始化数据库

```bash
npm run db:push    # 建表（基于 prisma/schema.prisma）
npm run db:seed    # 写入默认 Customer / AgentConfig / Skills / Policies / CaseTypes
```

> `db:seed` 不是可选步骤。Customer 表需要 `id='default'` 记录，否则 Console admin 路由在首次写入时会撞外键。各 admin 路由内置兜底，但 seed 才能拿到完整演示数据。

### 4. 启动开发服务

```bash
npm run dev:console   # 管理控制台 (localhost:3001)
```

## 构建 & 部署

```bash
npm run build:console          # 生产构建
git push deploy main           # 推送到生产服务器（post-receive hook → deploy.sh）
```

## 项目结构

```
apps/console/             ← 唯一的应用（原 apps/chat 已删除）
  app/api/messages/       ← 主 SSE 入口（LiveChat + 外部 API）
  app/api/admin/          ← Console 管理 CRUD + agent-configs + playground
  app/api/auth/           ← 登录 / session / 切换 org
  lib/agent/              ← 核心 AI 引擎（AgentLoop, skills, policy, trace, memory）
  lib/livechat/           ← LiveChat bridge（webhook → /api/messages → SSE）
  middleware.ts           ← Edge gate（/admin /ops + 被保护的 /api/*）
  components/             ← React（sidebar, docked-preview, admin editors）

packages/shared/
  prisma/schema.prisma    ← ~21 models（Organization, AgentConfig, Case, ApiKey, …）
  types/index.ts          ← SSEEvent, SkillDefinition, AgentConfigData, …
  defaults/index.ts       ← 默认 system prompts, memory strategies, policy hooks
```

## 调试功能

### Debug Mode

在 Console 的 Agent Config 页面开启 `Debug Mode`，每次 LLM 调用的完整 request/response payload 写入 `debug-logs/<caseId>/`。无需重启，实时生效。

### Case 导出

```bash
curl http://localhost:3001/api/cases/{caseId}/export -o case-export.md
```

也可在 Console 的 Case 详情页找到导出入口。

## API 鉴权

外部 API 调用使用 Bearer token：

```bash
curl https://demo.anytrans.ai/api/messages \
  -H "Authorization: Bearer intera_sk_live_…" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","userId":"u_1"}'
```

在 Console `/admin/api-keys` 页面创建和管理 API keys。
