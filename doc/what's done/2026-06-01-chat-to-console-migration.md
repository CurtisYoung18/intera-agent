# 迁移计划：舍弃 apps/chat，Console 作为唯一 SaaS 应用

## 一、决策与影响范围

### 方案

**Console 作为唯一 SaaS 应用。** `apps/chat` 整体废弃删除，所有 Agent 运行时 API + 引擎迁移到 `apps/console`。一个 Next.js 应用承载：管理后台 UI + 全部 API + Agent 引擎 + LiveChat Bridge + 多渠道渲染。

### 当前数据模型（chatId 为主键）

`3406dbb` refactor 后，数据模型是 **chat 优先**：

```
ChatSession（会话级）
  └── Case（工单 #1）── ChatMemory ── Messages / Traces
  └── Case（工单 #2）── ChatMemory ── Messages / Traces
  └── ...
```

- **`chatId`** 是顶层分组键，一个 Chat 下可以有多个并行 Case（如用户同时报告充值问题和账号问题）
- **`ChatSession`** 存跨 Case 的共享记忆（chat 级别的 confirmedFacts、summary、keyEvents）
- **`Case`** 仍然是独立的工单实体，每个 Case 有自己的 Agent Loop、ChatMemory、Messages
- API routes 现状：Chat 侧仍用 `caseId` 作为 URL 路径参数，`chatId` 作为 query 参数传入；Console 侧已有 `chats/[chatId]` 风格的聊天级路由

**迁移后应统一为 chatId 优先的 API 设计**（见第二节）。

### 废弃 vs 保留

| 层 | 动作 | 说明 |
|---|---|---|
| Chat UI（widget/聊天页/组件） | **删除** | `app/chat/`, `app/livechat-widget/`, `components/chat/`, `components/ui/` |
| Agent 引擎（`lib/agent/`） | **完整搬迁** | 40+ 文件，零业务逻辑修改 |
| API Routes | **搬迁 + 合并 + 路径对齐** | 搬入 `apps/console/app/api/`，统一为 chatId 优先命名 |
| LiveChat Bridge | **完整搬迁** | `lib/livechat/` 全量 |
| Channels 渲染器 | **完整搬迁** | `channels/` 全量 |
| 数据库 Schema | **不变** | `packages/shared/prisma/schema.prisma` 共享，0 变更 |
| `packages/shared` | **不变** | 继续作为共享库 |

### 当前 Console 到 Chat 的代理关系（迁移后消除）

```
console/next.config.js 当前 rewrites:
  /api/admin/config-changed  →  http://localhost:3000/api/admin/config-changed
  /api/composer-assist/:path* → http://localhost:3000/api/composer-assist/:path*
```

迁移后这两个路由变成 Console 原生路由，`CHAT_API_BASE` 环境变量和 rewrites 配置一并移除。

---

## 二、文件迁移详细清单

### 2.1 Agent 引擎 → `apps/console/lib/agent/`

**源路径：** `apps/chat/lib/agent/`
**目标路径：** `apps/console/lib/agent/`
**原则：** 完整搬迁，目录结构 1:1 保留，仅修正 import 路径

#### 2.1.1 核心引擎文件

| 源文件 | 目标文件 | 外部依赖变更 |
|---|---|---|
| `loop.ts` | `loop.ts` | `@/lib/utils` → 需确认 console 下存在 |
| `case-agent-loop.ts` | `case-agent-loop.ts` | 无外部依赖变更（仅引用 `@intera/shared` 和相对路径） |
| `stage-executor.ts` | `stage-executor.ts` | 同上 |
| `orchestrator.ts` | `orchestrator.ts` | 同上 |
| `sub-agent.ts` | `sub-agent.ts` | 同上 |
| `conversation-loop.ts` | `conversation-loop.ts` | 同上 |
| `memory.ts` | `memory.ts` | 同上 |
| `compact.ts` | `compact.ts` | 同上 |
| `microCompact.ts` | `microCompact.ts` | 同上 |
| `sessionMemoryCompact.ts` | `sessionMemoryCompact.ts` | 同上 |
| `policy.ts` | `policy.ts` | 同上 |
| `skills.ts` | `skills.ts` | 同上 |
| `trace.ts` | `trace.ts` | 同上 |
| `profiler.ts` | `profiler.ts` | 同上 |
| `stream-handler.ts` | `stream-handler.ts` | 同上 |
| `streaming-tool-executor.ts` | `streaming-tool-executor.ts` | 同上 |
| `session-store.ts` | `session-store.ts` | 同上 |
| `prompt-resolver.ts` | `prompt-resolver.ts` | 同上 |
| `config-cache.ts` | `config-cache.ts` | 同上 |
| `consultation-agent.ts` | `consultation-agent.ts` | 同上 |
| `composer-assist-config.ts` | `composer-assist-config.ts` | 同上 |
| `deepseek-prefix-chat.ts` | `deepseek-prefix-chat.ts` | 同上 |
| `debug-logger.ts` | `debug-logger.ts` | 同上 |
| `identity.ts` | `identity.ts` | 同上 |
| `tool-result-invariant.ts` | `tool-result-invariant.ts` | 同上 |
| `case-type-slugs.ts` | `case-type-slugs.ts` | 同上 |
| `spinner-verbs.ts` | `spinner-verbs.ts` | 同上 |

#### 2.1.2 API 子模块

| 源文件 | 目标文件 |
|---|---|
| `api/provider-config.ts` | `api/provider-config.ts` |
| `api/error-classifier.ts` | `api/error-classifier.ts` |
| `api/with-retry.ts` | `api/with-retry.ts` |

#### 2.1.3 策略模块

| 源文件 | 目标文件 |
|---|---|
| `strategies/types.ts` | `strategies/types.ts` |
| `strategies/stage-strategy.ts` | `strategies/stage-strategy.ts` |
| `strategies/discovery-strategy.ts` | `strategies/discovery-strategy.ts` |
| `strategies/checklist-strategy.ts` | `strategies/checklist-strategy.ts` |

#### 2.1.4 内置工具

| 源文件 | 目标文件 |
|---|---|
| `tools/builtin/create-case.ts` | `tools/builtin/create-case.ts` |
| `tools/builtin/create-human-task.ts` | `tools/builtin/create-human-task.ts` |
| `tools/builtin/dispatch-subagent.ts` | `tools/builtin/dispatch-subagent.ts` |
| `tools/builtin/finalize-case.ts` | `tools/builtin/finalize-case.ts` |
| `tools/builtin/finalize-sub-agent.ts` | `tools/builtin/finalize-sub-agent.ts` |
| `tools/builtin/read-case-history.ts` | `tools/builtin/read-case-history.ts` |
| `tools/builtin/todo-read.ts` | `tools/builtin/todo-read.ts` |
| `tools/builtin/todo-write.ts` | `tools/builtin/todo-write.ts` |
| `tools/business/business-tool-adapter.ts` | `tools/business/business-tool-adapter.ts` |

#### 2.1.5 测试文件

| 源文件 | 目标文件 |
|---|---|
| `__tests__/factories/agent-loop.ts` | `__tests__/factories/agent-loop.ts` |
| `__tests__/integration/agent-loop-integration.test.ts` | `__tests__/integration/agent-loop-integration.test.ts` |
| `__tests__/mocks/anthropic.ts` | `__tests__/mocks/anthropic.ts` |
| `__tests__/regression/p0-regression.test.ts` | `__tests__/regression/p0-regression.test.ts` |
| `__tests__/smoke/smoke.test.ts` | `__tests__/smoke/smoke.test.ts` |
| `__tests__/unit/error-classifier.test.ts` | `__tests__/unit/error-classifier.test.ts` |
| `__tests__/unit/session-store.test.ts` | `__tests__/unit/session-store.test.ts` |
| `__tests__/unit/stream-handler.test.ts` | `__tests__/unit/stream-handler.test.ts` |
| `__tests__/unit/tool-result-invariant.test.ts` | `__tests__/unit/tool-result-invariant.test.ts` |
| `__tests__/unit/with-retry.test.ts` | `__tests__/unit/with-retry.test.ts` |

### 2.2 API Routes → `apps/console/app/api/`

**源路径：** `apps/chat/app/api/`
**目标路径：** `apps/console/app/api/`
**原则：** 逐个搬迁，与 Console 已有 admin/ops routes 合并；**统一为 chatId 优先的命名风格。**

#### 2.2.0 数据模型背景（重要）

```
ChatSession（会话级记忆，跨 Case 共享）
  ├── Case #1 (deposit_issue)  → ChatMemory → Messages / Traces
  ├── Case #2 (account_issue)  → ChatMemory → Messages / Traces
  └── ...

一个 Chat 可以有多个并行 Case。
运行时 API 的核心概念：
  - chatId  = 对话会话（顶层），由前端生成，随每次请求传递
  - caseId  = 工单（Chat 的子实体），每个 Case 有独立的 Agent Loop
```

#### 2.2.1 运行时 API（从 chat 搬入，路径对齐到 chatId 优先）

| Chat 侧源路由 | 迁移后路由 | 说明 |
|---|---|---|
| `cases/route.ts` | `chats/[chatId]/cases/route.ts` | POST 创建 case（属于某个 chat） + GET 列出 chat 下所有 cases |
| `cases/[id]/message/route.ts` | `chats/[chatId]/cases/[caseId]/message/route.ts` | POST 发送消息到某个 case |
| `cases/[id]/messages/route.ts` | `chats/[chatId]/cases/[caseId]/messages/route.ts` | GET 消息历史 |
| `cases/[id]/stream/route.ts` | `chats/[chatId]/cases/[caseId]/stream/route.ts` | **GET SSE 流（核心端点）** |
| `human-tasks/route.ts` | `human-tasks/route.ts` | GET 列出 + POST 创建人工任务 |
| `human-chat/route.ts` | `human-chat/route.ts` | POST 人工咨询（客户侧触发） |
| `livechat/config/route.ts` | `livechat/config/route.ts` | LiveChat 配置 |
| `livechat/webhook/[orgId]/route.ts` | `livechat/webhook/[orgId]/route.ts` | LiveChat webhook |
| `livechat/webhook/route.ts` | `livechat/webhook/route.ts` | LiveChat webhook（无 orgId） |
| `livechat/form-submit/route.ts` | `livechat/form-submit/route.ts` | LiveChat 表单提交 |
| `livechat/groups/route.ts` | `livechat/groups/route.ts` | LiveChat 分组 |
| `composer-assist/feature/route.ts` | `composer-assist/feature/route.ts` | 写作辅助特性开关 |
| `composer-assist/suggest/route.ts` | `composer-assist/suggest/route.ts` | 写作辅助建议 |
| `coordinate/route.ts` | `coordinate/route.ts` | 多 Case 协调合成（接收 caseIds[]） |
| `intent/route.ts` | `intent/route.ts` | Intent 分类 |
| `health/route.ts` | `health/route.ts` | 健康检查 |
| `internal/compact-chat/route.ts` | `internal/compact-chat/route.ts` | 内部压缩触发 |
| `admin/config-changed/route.ts` | `admin/config-changed/route.ts` | 配置变更通知（并入已有 admin 目录） |

> **关于路径对齐的说明：** 当前 Chat 侧 SSE stream 端点 URL 是 `/api/cases/{caseId}/stream?chatId=xxx`，虽然 `caseId` 在 path 中，但 AgentLoop 初始化时需要 `chatId` 来关联 `ChatSession`。迁移后建议显式改为 `chats/{chatId}/cases/{caseId}/stream` 让层级关系在 URL 中自文档化。但如果前端调用方太多，也可以暂时保持 `/api/cases/{caseId}/stream?chatId=xxx` 不变，仅做搬迁不做重命名——这是一个**可选优化**，非必须。

#### 2.2.2 与 Console 已有路由的关系

Console 已有以下**运营侧**路由，和 Chat 侧**运行时**路由职责不同：

```
Console 已有（运营视图 + 管理）:
  api/admin/*                      ← 管理 CRUD，保留
  api/auth/*                       ← 认证，保留
  api/cases/route.ts               ← 运营视图：列出全部 cases。Chat 搬入后需合并
  api/cases/[id]/export/route.ts   ← Case 导出，保留
  api/cases/[id]/messages/route.ts ← 运营视图：看某个 case 的消息。Chat 搬入后需合并
  api/cases/[id]/traces/route.ts   ← 运营视图：看 trace，保留
  api/chats/[chatId]/route.ts      ← 运营视图：Chat 详情，保留
  api/chats/[chatId]/memory/route.ts  ← 运营视图：Chat 级记忆，保留
  api/chats/[chatId]/traces/route.ts  ← 运营视图：Chat 级 trace，保留
  api/chats/[chatId]/compact/route.ts ← 手动触发 compact，保留
  api/chats/[chatId]/update-profile/route.ts ← 更新 UserProfile，保留
  api/chats/route.ts               ← 运营视图：列出 chats，保留
  api/human-chat/route.ts          ← 运营侧人工聊天。与 Chat 侧客户 human-chat 功能不同
  api/human-tasks/[id]/resolve/route.ts  ← 人工任务解决，保留
  api/human-tasks/[id]/delete/route.ts  ← 人工任务删除，保留
  api/human-tasks/[id]/route.ts    ← 人工任务详情，保留
  api/human-tasks/route.ts         ← 人工任务列表。Chat 搬入后需合并
  api/ops/dashboard/route.ts       ← 运营仪表盘，保留
  api/users/*                      ← 用户管理，保留
```

**迁移后合并策略（按优先级）：**

1. **Chat 侧 `cases/route.ts`（POST 创建 case）→ 并入 Console 已有的 `api/cases/route.ts`。** 一个文件 export GET（运营列表） + POST（客户创建）。
2. **Chat 侧 `cases/[id]/message/route.ts` → 路径不变，并入 `api/cases/[id]/message/`**（目前 Console 无此路径，无冲突）。
3. **Chat 侧 `human-chat/route.ts` → 与 Console 已有 `api/human-chat/route.ts` 是不同功能。** Chat 侧是客户触发咨询，Console 侧是运营人员参与咨询对话。最简单方案：合并到一个文件，通过 `role` 字段区分（客户侧 `role=customer` vs 运营侧 `role=operator`）。
4. **Chat 侧 `human-tasks/route.ts` → 与 Console 的 `human-tasks/` 目录共存。** Chat 侧 `GET/POST` 是运行时 API（agent 创建 + 查任务），Console 的 `[id]/*` 子路由是运营侧操作（resolve / delete）。共存无冲突。

### 2.3 LiveChat Bridge → `apps/console/lib/livechat/`

| 源文件 | 目标文件 |
|---|---|
| `bridge.ts` | `bridge.ts` |
| `livechat-api.ts` | `livechat-api.ts` |
| `config-store.ts` | `config-store.ts` |
| `session-store.ts` | `session-store.ts` |
| `webhook-dedup.ts` | `webhook-dedup.ts` |
| `webhook-filter.ts` | `webhook-filter.ts` |
| `event-translators.ts` | `event-translators.ts` |
| `retry-queue.ts` | `retry-queue.ts` |
| `channel-health.ts` | `channel-health.ts` |
| `image-utils.ts` | `image-utils.ts` |
| `types.ts` | `types.ts` |
| `__tests__/` 下全部文件 | 完整搬迁 |

### 2.4 Channels 渲染器 → `apps/console/channels/`

| 源文件 | 目标文件 |
|---|---|
| `channels/livechat/renderer.ts` | `channels/livechat/renderer.ts` |
| `channels/livechat/render-skill-by-hint.ts` | `channels/livechat/render-skill-by-hint.ts` |
| `channels/web-chat/renderer.ts` | `channels/web-chat/renderer.ts` |

### 2.5 工具函数 → `apps/console/lib/utils.ts`

从 `apps/chat/lib/utils.ts` 完整搬迁。

### 2.6 依赖包变更

Console 的 `package.json` 需新增以下依赖（从 Chat 搬入）：

```diff
  "dependencies": {
+   "@anthropic-ai/sdk": "^0.52.0",
    "@intera/shared": "*",
    "bcryptjs": "^3.0.3",
    "lucide-react": "^1.14.0",
    "next": "^15.3.3",
    "react": "^19.1.0",
-   "react-dom": "^19.1.0"
+   "react-dom": "^19.1.0",
+   "zod": "^3.24.4"
  },
```

注意：`@anthropic-ai/sdk` 当前在 `packages/shared/package.json` 中已存在（Prisma 共用），但 Chat 的 `package.json` 也显式依赖了它。迁移后 Console 需要显式添加该依赖，因为 Agent 引擎直接 import 它。

### 2.7 废弃删除清单

```
apps/chat/ 整个目录删除，包括但不限于：

前端页面和组件：
  app/chat/                           聊天页面
  app/livechat-widget/                LiveChat Widget 嵌入页
  app/layout.tsx                      Chat layout
  app/page.tsx                        Chat 首页
  components/chat/chat-shell.tsx      聊天外壳
  components/chat/case-panel.tsx      Case 面板
  components/chat/case-card.tsx       Case 卡片
  components/chat/form-card.tsx       表单卡片
  components/chat/agent-progress-card.tsx
  components/chat/agent-findings-view.tsx
  components/chat/interaction-card.tsx
  components/chat/intent-clarification-card.tsx
  components/chat/case-history-panel.tsx
  components/chat/debug-export-button.tsx
  components/ui/                      Chat UI 基础组件

配置文件：
  .env.example
  .env.local
  package.json
  next.config.js
  tailwind.config.ts
  postcss.config.*（如有）

运行时目录：
  debug-logs/
  .next/
```

---

## 三、Import 路径变更指南

### 3.1 路径别名

迁移前后 alias 对比：

```
迁移前 (vitest.config.ts):
  '@' → apps/chat/

迁移后 (vitest.config.ts):
  '@' → apps/console/
```

### 3.2 不需要修改的 import

这些 import 在搬迁后自动正确（因为它们引用的是 `packages/shared`）：

```ts
// ✓ 不变 — 引用 shared package
import type { Message, SSEEvent, CaseSchemaConfig } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { DEFAULT_STAGE_CONFIGS } from '@intera/shared/defaults'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
```

### 3.3 需要确认的 import

以下 import 依赖 `@/` alias，搬迁后需要验证路径存在于 `apps/console/` 下：

```ts
// 需要确认 console 下有对应文件
import { generateCaseId } from '@/lib/utils'
// → apps/console/lib/utils.ts（从 chat 搬入，ok）
```

Agent 引擎内部的相对 import 全部不变（目录结构保持一致）：

```ts
// ✓ 相对路径不变
import { ChatMemoryManager } from './memory'
import { PolicyEngine } from './policy'
import { StageExecutor } from './stage-executor'
```

### 3.4 console/next.config.js 清理

```diff
- const CHAT_API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3000'

  const nextConfig = {
    output: 'standalone',
    reactStrictMode: true,
    transpilePackages: ['@intera/shared'],
    experimental: {
      serverActions: {
        bodySizeLimit: '2mb',
      },
    },
-   async rewrites() {
-     return [
-       {
-         source: '/api/admin/config-changed',
-         destination: `${CHAT_API_BASE}/api/admin/config-changed`,
-       },
-       {
-         source: '/api/composer-assist/:path*',
-         destination: `${CHAT_API_BASE}/api/composer-assist/:path*`,
-       },
-     ]
-   },
  }
```

---

## 四、数据库同步

### 4.1 Schema

**零变更。** `packages/shared/prisma/schema.prisma` 是 Chat 和 Console 共用的，迁移后不变。两个 app 目前已经通过 `@intera/shared/prisma` 引用同一个 PrismaClient 单例。

### 4.2 环境变量

Console 需要新增以下环境变量（当前仅在 Chat 的 `.env.local` 中）：

```bash
# 必需 — Prisma 数据库连接
DATABASE_URL="postgresql://..."

# 必需 — LLM API Keys
ANTHROPIC_AUTH_TOKEN="..."
DEEPSEEK_API_KEY="..."       # 可选，写作辅助用
MINIMAX_API_KEY="..."        # 可选
OPENROUTER_API_KEY="..."     # 可选

# 可选 — GPTBots 知识库
GPTBOTS_API_KEY="..."        # 可选，知识库检索用

# LiveChat 集成
LIVECHAT_CLIENT_ID="..."     # 可选
LIVECHAT_CLIENT_SECRET="..." # 可选
```

### 4.3 Seed 与 Migration

```bash
# 不变 — 仍然通过 packages/shared 执行
npm run db:push    # 建表
npm run db:seed    # 写入默认数据
```

因为 `db:push` 和 `db:seed` 定义在 `packages/shared/package.json`，不受 Chat 删除的影响。

---

## 五、构建与部署配置变更

### 5.1 根 `package.json`

```diff
  "scripts": {
-   "dev:chat": "npm run dev -w apps/chat",
    "dev:console": "npm run dev -w apps/console",
-   "build:chat": "npm run build -w apps/chat",
    "build:console": "npm run build -w apps/console",
    "db:generate": "npm run db:generate -w packages/shared",
    "db:push": "npm run db:push -w packages/shared",
    "db:studio": "npm run db:studio -w packages/shared",
    "db:seed": "npm run db:seed -w packages/shared",
    "test": "npx vitest run",
    "test:watch": "npx vitest",
    "test:coverage": "npx vitest run --coverage"
  },
  "workspaces": [
-   "apps/*",
+   "apps/console",
    "packages/*"
  ],
```

### 5.2 `railway.json`

```diff
  {
    "$schema": "https://schema.railway.app/railway.schema.json",
    "build": {
-     "buildCommand": "npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/chat && cp -r apps/chat/.next/static apps/chat/.next/standalone/apps/chat/.next/static"
+     "buildCommand": "npx prisma generate --schema=./packages/shared/prisma/schema.prisma && npm run build -w apps/console && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static"
    },
    "deploy": {
-     "startCommand": "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/chat/.next/standalone/apps/chat/server.js",
+     "startCommand": "npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate && node apps/console/.next/standalone/apps/console/server.js",
      "restartPolicyType": "ON_FAILURE",
      "restartPolicyMaxRetries": 3
    }
  }
```

### 5.3 `vitest.config.ts`

```diff
  resolve: {
    alias: {
-     '@': path.resolve(__dirname, 'apps/chat'),
+     '@': path.resolve(__dirname, 'apps/console'),
    },
  },
```

注意：测试文件搬迁后，若原有测试引用了 Chat 特有的 UI 组件路径，需移除或跳过那些测试。

---

## 六、回归测试 Guide

### 6.1 测试策略总览

分三层验证：**单元测试 → 集成测试 → 端到端验证。**

### 6.2 第一层：单元测试（CI 阻断）

执行命令：`npm test`（即 `npx vitest run`）

**预期：全部通过，0 失败。**

当前测试覆盖范围（来自 `vitest.config.ts` 的 `coverage.include`）：

```
apps/chat/lib/livechat/**/*.ts
apps/chat/channels/livechat/**/*.ts
```

迁移后测试文件在 `apps/console/` 下对应位置，覆盖率配置需同步更新：

```diff
  coverage: {
    include: [
-     'apps/chat/lib/livechat/**/*.ts',
-     'apps/chat/channels/livechat/**/*.ts',
+     'apps/console/lib/livechat/**/*.ts',
+     'apps/console/channels/livechat/**/*.ts',
    ],
  },
```

**需额外运行的 Agent 引擎测试：**

```bash
# 显式运行 agent 测试（当前可能未在 coverage include 中但存在测试文件）
npx vitest run apps/console/lib/agent/__tests__/
```

### 6.3 第二层：API 集成测试（逐端点）

启动 Console 开发服务器后，逐端点验证。以下用 `curl` 示例，建议写成脚本。

#### 6.3.1 健康检查

```bash
curl http://localhost:3001/api/health
# 预期: 200, { "status": "ok" }
```

#### 6.3.2 Case 创建 + 消息发送 + SSE 流

```bash
# 1. 创建 case
curl -X POST http://localhost:3001/api/cases \
  -H 'Content-Type: application/json' \
  -d '{
    "orgId": "default",
    "userId": "test-user-001",
    "chatId": "test-chat-001",
    "message": "我的充值没到账，金额1000元，支付宝支付",
    "caseType": "deposit_issue"
  }'
# 预期: 200, 返回 { caseId, messages, caseStatus, transition }

# 2. 发送后续消息
curl -X POST http://localhost:3001/api/cases/{caseId}/message \
  -H 'Content-Type: application/json' \
  -d '{ "message": "交易号是 TX2026051912345678" }'
# 预期: 200, agent 继续处理

# 3. 获取消息历史
curl http://localhost:3001/api/cases/{caseId}/messages
# 预期: 200, 返回消息数组

# 4. SSE 流（在浏览器或支持 SSE 的客户端测试）
curl -N http://localhost:3001/api/cases/{caseId}/stream
# 预期: SSE 事件流（stream_request_start, text_delta, tool_executing, skill_result, message_stop...）
```

#### 6.3.3 人工任务

```bash
# 1. 创建人工任务（通过 agent loop 触发或直接 API）
curl http://localhost:3001/api/human-tasks
# 预期: 200, 返回任务列表

# 2. 人工任务操作
curl -X POST http://localhost:3001/api/human-tasks/{taskId}/resolve \
  -H 'Content-Type: application/json' \
  -d '{ "verdict": "confirmed_success", "notes": "已确认到账" }'
# 预期: 200
```

#### 6.3.4 Admin 配置 API

```bash
# 验证 Agent 配置 CRUD 正常
curl http://localhost:3001/api/admin/agent?orgId=default
# 预期: 200, 返回当前配置

# 验证 CaseType 管理
curl http://localhost:3001/api/admin/case-types?orgId=default
# 预期: 200, 返回 case type 列表

# 验证 Skill 管理
curl http://localhost:3001/api/admin/skills?orgId=default
# 预期: 200, 返回技能列表

# 验证 Policy 管理
curl http://localhost:3001/api/admin/policies?orgId=default
# 预期: 200

# 验证 Knowledge 管理
curl http://localhost:3001/api/admin/knowledge/sources
# 预期: 200
```

#### 6.3.5 配置变更通知

```bash
# 配置变更后清除缓存（此前由 Chat 处理，迁移后由 Console 直接处理）
curl -X POST http://localhost:3001/api/admin/config-changed \
  -H 'Content-Type: application/json' \
  -d '{ "keys": ["agentConfig"] }'
# 预期: 200
```

#### 6.3.6 LiveChat Webhook（模拟）

```bash
curl -X POST http://localhost:3001/api/livechat/webhook/default \
  -H 'Content-Type: application/json' \
  -d '{
    "event": { "id": "test-event-001", "type": "incoming_chat" },
    "chat_id": "test-livechat-001",
    "message": { "text": "Hello from LiveChat" }
  }'
# 预期: 200（即使 LiveChat 未配置也应有得体响应）
```

#### 6.3.7 意图识别

```bash
curl -X POST http://localhost:3001/api/coordinate \
  -H 'Content-Type: application/json' \
  -d '{
    "orgId": "default",
    "message": "充值没到账",
    "chatId": "test-chat-002"
  }'
# 预期: 200, 返回 intent 分类结果
```

#### 6.3.8 Ops 运营 API

```bash
curl http://localhost:3001/api/ops/dashboard?orgId=default
# 预期: 200

curl http://localhost:3001/api/chats?orgId=default
# 预期: 200

curl http://localhost:3001/api/users
# 预期: 200
```

### 6.4 第三层：端到端流程验证

完整模拟一个客户对话的完整生命周期：

```
1. 客户发起对话 → POST /api/coordinate（意图识别）
2. 系统返回 intent → 前端展示匹配的 case types
3. 客户选择 case type → POST /api/cases（创建 case + 发送首条消息）
4. Agent 开始处理 → GET /api/cases/{id}/stream（SSE 流）
5. Agent 可能收集信息 → 触发 form_request event → 前端展示表单
6. 客户提交表单 → POST /api/cases/{id}/message（附带表单答案）
7. Agent 继续处理 → SSE 继续
8a. Case 解决 → finalized event → 结束
8b. Case 升级 → escalated event → 创建 HumanTask
9. 人工处理 → POST /api/human-tasks/{id}/resolve
10. Case 关闭 → resolved
```

**验证清单：**

- [ ] SSE 事件类型完整：`stream_request_start`, `text_delta`, `tool_executing`, `skill_result`, `memory_update`, `case_status`, `message_stop`, `finalized`, `escalated`, `error`
- [ ] Tool call 匹配 tool result（S1 不变量）
- [ ] Case 状态正确流转：`created` → `investigating` → `resolved`
- [ ] Human Task 创建 → 处理 → 关闭流程完整
- [ ] ChatMemory 正确保存和恢复
- [ ] ActionTrace 记录完整
- [ ] 上下文压缩（Compact）正常触发
- [ ] Debug 日志正常写入（debugMode=true 时）

### 6.5 回归测试自动化脚本模板

```bash
#!/bin/bash
# regression-test.sh — 迁移后回归测试
set -e

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local method="$2"
  local url="$3"
  local data="$4"
  local expected_code="${5:-200}"

  if [ -n "$data" ]; then
    resp=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$url" \
      -H 'Content-Type: application/json' -d "$data")
  else
    resp=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$url")
  fi

  if [ "$resp" = "$expected_code" ]; then
    echo "✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "✗ $desc (expected $expected_code, got $resp)"
    FAIL=$((FAIL + 1))
  fi
}

# Health
check "Health check" GET /api/health

# Admin APIs
check "Get agent config" GET /api/admin/agent?orgId=default
check "List case types" GET /api/admin/case-types?orgId=default
check "List skills" GET /api/admin/skills?orgId=default
check "List policies" GET /api/admin/policies?orgId=default

# Ops APIs
check "Dashboard" GET /api/ops/dashboard?orgId=default
check "List chats" GET /api/chats?orgId=default

# Runtime APIs
check "List human tasks" GET /api/human-tasks?orgId=default

# Config changed
check "Config changed" POST /api/admin/config-changed '{"keys":["agentConfig"]}'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

---

## 七、实施步骤（严格顺序）

### Step 1: 环境准备
- [ ] 确认 `apps/console/.env.local` 包含所有必需环境变量（DATABASE_URL + API Keys）
- [ ] `cp apps/chat/.env.local apps/console/.env.local`（如缺失）
- [ ] 创建分支 `git checkout -b migrate/chat-to-console`

### Step 2: 搬运 lib 层
- [ ] `cp -r apps/chat/lib/agent apps/console/lib/agent`
- [ ] `cp -r apps/chat/lib/livechat apps/console/lib/livechat`
- [ ] `cp apps/chat/lib/utils.ts apps/console/lib/utils.ts`
- [ ] `cp apps/chat/lib/spinner-verbs.ts apps/console/lib/`（如需要）
- [ ] 验证 import 路径：`grep -r "from '@/lib" apps/console/lib/agent/` 确认 `@/lib/utils` 可解析

### Step 3: 搬运 channels
- [ ] `cp -r apps/chat/channels apps/console/channels`

### Step 4: 搬运 API routes
- [ ] 逐个搬迁 2.2 节列出的路由文件
- [ ] **重点处理冲突路由**（见 2.2.2 节的 4 个冲突点）
- [ ] 合并 `cases/route.ts`：一个文件同时 export GET 和 POST
- [ ] 合并 `human-chat/route.ts`：通过请求上下文区分客户侧 vs 运营侧
- [ ] 搬入 `admin/config-changed/route.ts`

### Step 5: 依赖安装
- [ ] 更新 `apps/console/package.json` 添加 `@anthropic-ai/sdk`、`zod`
- [ ] `npm install`（根目录）

### Step 6: 构建配置
- [ ] 更新根 `package.json`：移除 `dev:chat`、`build:chat`
- [ ] 更新 `railway.json`：路径改为 `apps/console`
- [ ] 更新 `vitest.config.ts`：alias 改为 `apps/console`，coverage include 同步
- [ ] 移除 `console/next.config.js` 中的 rewrites 和 `CHAT_API_BASE`

### Step 7: 编译验证
- [ ] `npm run build:console` — 必须无错误
- [ ] 修复所有 TS 编译错误

### Step 8: 测试
- [ ] `npm test` — 全部通过
- [ ] 启动 `npm run dev:console`，执行 6.3 节 API 测试
- [ ] 执行 6.4 节端到端流程

### Step 9: 删除
- [ ] `rm -rf apps/chat`
- [ ] 清理根 `package.json` 的 `workspaces`（移除 `apps/*` 改为 `apps/console`）

### Step 10: 部署
- [ ] Push 到 Railway
- [ ] 验证生产环境健康检查
- [ ] 监控日志无异常

---

## 八、架构性能分析：单 Console 能否大规模商用

### 8.1 结论

**可以。** 当前的 Next.js standalone + SSE streaming 架构在中等规模（数百并发对话）下完全够用。瓶颈不在 Node.js，在 LLM API 的速率限制。

### 8.2 并发模型分析

每次 Agent 对话 = 一个长期 SSE 连接。这个连接在做什么：

```
时间轴（单次 Agent Turn）：
├─ Build prompt + filter tools ........ ~5ms  (CPU，同步)
├─ Anthropic API streaming call ....... ~3-10s (网络 I/O，异步等待)
├─ Tool execution (mock/HTTP) ......... ~50-8000ms (I/O，并发执行)
├─ Policy evaluation (LLM) ............ ~200-2000ms (I/O，异步等待)
├─ Stage evaluation (rule-based) ...... ~5ms (CPU)
└─ Message persistence (Prisma) ....... ~10-50ms (I/O，异步)
```

关键特征：**95%+ 的时间在等待外部 I/O**（Anthropic API、PostgreSQL、GPTBots）。Node.js 的事件循环天然擅长处理这种 I/O 密集型负载——一个线程可以同时维护成千上万个异步等待。

### 8.3 具体资源消耗（实测估算）

以 Railway 常见配置为基准：

| 配置 | vCPU | RAM | 预估并发连接 | 月费参考 |
|------|------|-----|------------|---------|
| **Starter** | 1 vCPU | 512 MB | 50-100 | ~$5 |
| **Pro** | 1 vCPU | 1 GB | 100-300 | ~$20 |
| **Pro+** | 2 vCPU | 2 GB | 300-800 | ~$50 |

#### 单连接内存消耗拆解

```
每个活跃 SSE 连接的内存足迹：
  Message[] (最近消息, ~20条) ......... ~50 KB
  ChatMemory (facts + skills) ......... ~10 KB
  StreamingToolExecutor 实例 .......... ~5 KB
  PolicyEngine 引用（共享） ............ ~0 KB
  Anthropic client 引用（共享） ........ ~0 KB
  Prisma client 引用（共享） ........... ~0 KB
  Node.js HTTP response 对象 ........... ~2 KB
  ─────────────────────────────────────────
  合计 ................................ ~70 KB/连接
```

加上 Next.js 运行时基础开销（~150 MB），512 MB 实例的理论上限约 5,000 连接（实际受其他因素限制会低得多）。

#### 实际瓶颈排序

```
瓶颈层级（从紧到松）：

1. Anthropic API Rate Limits ⚠️ 最硬的天花板
   - Free tier:      ~100 RPM, ~50K TPD
   - Tier 1:         ~1K RPM
   - Tier 2-3:       ~2K-5K RPM
   - Enterprise:     >10K RPM（合约谈判）
   
   假设每次 Agent turn 耗费 1 个 API call，
   平均每连接每分钟 2 个 turn：
   
   | API Tier | RPM 限制 | 约支持并发连接 |
   |----------|---------|-------------|
   | Tier 1   | 1,000   | ~100         |
   | Tier 2   | 3,000   | ~300         |
   | Tier 3   | 5,000   | ~500         |
   | Enterprise| 10K+   | ~1,000+      |

2. PostgreSQL 连接池 ⚠️
   - Prisma 默认: connection_limit = num_cpus * 2 + 1
   - Neon serverless: 自动扩缩，按连接数计费
   - 使用 PgBouncer 可以支撑数千并发
   - 当前项目已有 Prisma 单例（globalThis caching），连接复用 OK

3. Node.js Event Loop ⚠️（极少成为瓶颈）
   - 10K 并发 SSE 连接 ≈ 10K 个 setTimeout/async waiter
   - Event loop 处理这个量级绰绰有余
   - 真正阻塞 event loop 的是同步 CPU 密集操作（本项目没有）

4. 内存 ✅（最容易解决）
   - 单实例 512MB 轻松承载数百并发
   - 不够就升配，线性扩展

5. 带宽 ✅
   - SSE 文本流每个 token ~4 bytes
   - 峰值带宽需求极低
```

### 8.4 水平扩展路径

当单实例不够时：

```
                    ┌──────────────┐
                    │   LB / Nginx  │  (sticky sessions by chatId)
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Console  │ │ Console  │ │ Console  │
        │ Instance │ │ Instance │ │ Instance │
        │ #1       │ │ #2       │ │ #3       │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             └────────────┼────────────┘
                          ▼
                  ┌──────────────┐
                  │  PostgreSQL  │  (Neon Serverless)
                  └──────────────┘
```

**扩展前需要解决的问题：**

1. **SessionStore 内存化 → Redis。** 当前 `session-store.ts` 用内存 Map 存储并发请求队列。多实例部署时需要改为 Redis pub/sub，否则跨实例消息丢失。

2. **SSE Sticky Sessions。** 同一个 `chatId` 的请求必须路由到同一实例（因为 Agent 状态在内存中）。Railway 支持 sticky sessions，Nginx 用 `ip_hash` 或自定义 cookie。

3. **Orchestrator 后台任务。** `dispatchInBackground` 是进程内的 fire-and-forget。多实例下子代理结果需要跨实例同步（当前通过 DB `ChatMemory` 轮询实现，已经天然跨实例）。

### 8.5 单实例够用的场景边界

| 场景 | 日活用户 | 峰值并发 | 单实例够用？ |
|------|---------|---------|-----------|
| 小型 SaaS（几个商户） | <1K | <20 | ✅ Starter |
| 中型 SaaS（几十个商户） | 1K-10K | 20-100 | ✅ Pro |
| 大型 SaaS（数百商户） | 10K-100K | 100-500 | ✅ Pro+（需优化） |
| 企业级（数千商户） | 100K+ | 500+ | ⚠️ 需水平扩展 + Redis |

**判断标准：如果你的 Anthropic API tier 还在 Tier 1-2，那么单实例完全够用。API tier 是最先触碰的天花板，它到来之前不需要考虑水平扩展。**

### 8.6 推荐的渐进式优化路径

```
Phase 1（当前 → 单实例）
  - 无需优化，直接跑

Phase 2（单实例压力增大时）
  - 启用 PgBouncer / Neon pooled connection
  - Prisma connection_limit 调优
  - 增加 Railway 实例规格（垂直扩展）

Phase 3（需要多实例时）
  - SessionStore → Redis
  - 部署 sticky sessions
  - 监控 Anthropic API rate limit 使用率

Phase 4（大规模时）
  - 独立的 Agent worker 队列（BullMQ + Redis）
  - SSE 代理层（推送而非轮询）
  - Anthropic Enterprise tier 谈判
```

---

## 九、回滚计划

如果迁移后出现阻塞性问题：

```bash
# 1. 切回原分支
git checkout main

# 2. 重新部署原架构
# railway.json 在原分支不变，自动使用原 build/deploy 命令

# 3. 数据库不变，无需回滚
```

因为数据库 Schema 无变更，回滚是 **秒级** 的 — 只是一个 git checkout + 重新部署。
