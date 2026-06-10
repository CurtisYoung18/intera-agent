# Intera — AI 客服 SaaS 平台

Intera 是一个以 **AI Agent 为核心**的多租户智能客服 SaaS。客户发起对话后，Agent 会围绕 **Chat / User / ProcedureRun / HumanTask / Trace / Memory** 推进问题：检索知识、调用 Tools、追问澄清、在 Hook 命中时升级人工，并把过程留成可验证的运行时证据。底层仍暂保留 durable `Case` shell 来兼容现有 message/trace 持久化，但这不再是产品层主概念。

当前 Console 的真实产品壳是：登录后默认进入 **Build -> Pilot Lab**，其中 `Pilot` 负责对话式构建，`Playground` 保留 dry-run 与 TraceSidebar 调试能力；**Release** 拥有版本与 package 动作；**ConfigPilot** 只存在于 Pilot Lab 内，不再作为全局 drawer。

长期目标：Intera Console 要成为 **客服 Agent 的 AgentOps Workbench**。第一阶段的对话式工具命名为 **ConfigPilot**：交付人员可以用自然语言检查、调优、测试并直接配置一个 Intera Agent，但它不开放服务器 shell、不读写服务器文件，只通过 typed admin / scenario / trace APIs 修改 Procedure、Tools、Hooks、Human Transfer，并输出 diff、验证记录和回滚路径。

**技术栈**：Next.js 15 monorepo（`apps/console` + `packages/shared`）· TypeScript · Prisma 6 + PostgreSQL · 自托管 Ubuntu，服务 `demo.anytrans.ai`。

> 架构细节、当前状态与路线图见 [`doc/handoffs/MASTER_BUILD_HANDOFF.md`](doc/handoffs/MASTER_BUILD_HANDOFF.md)。

## 本地运行

需要 **Node.js 18+**、npm、Docker（本地 Postgres）。

### 1. 安装依赖
```bash
npm install
```

### 2. 起本地数据库（Postgres 16）
```bash
docker compose up -d        # postgres:16，用户/密码/库均为 intera
```

### 3. 配置环境变量
```bash
cp .env.example .env
cp apps/console/.env.example apps/console/.env.local
```
至少填：
- `DATABASE_URL=postgresql://intera:intera@localhost:5432/intera`
- `SESSION_SECRET=`（session 签名密钥）
- 至少一个 LLM key + 其 base URL：`ANTHROPIC_AUTH_TOKEN` / `MINIMAX_API_KEY` / `DEEPSEEK_API_KEY`
- `STAFF_PASSWORD=`（破窗 / bootstrap 登录）

> Google SSO + 邀请制为可选，需额外的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `INVITE_TOKEN_SECRET`。完整清单以 `.env.example` 为准。

### 4. 建表 + 种子
```bash
npm run db:push    # 按 schema 建表
npm run db:seed    # 写入 default Organization + 演示 Agent 配置 / Tools / Hooks / CaseTypes
```
> `db:seed` 不是可选：它提供 `id='default'` 的组织和完整演示数据。

### 5. 启动
```bash
npm run dev:console   # 控制台 (localhost:3001)
```

## 构建 & 部署
```bash
npm run build:console
git push deploy main           # post-receive hook → scripts/deploy.sh
```

## 调试功能

### Debug Mode
在 Console 的 Brain 工作台开启 `Debug Mode`，每次 LLM 调用的完整 request/response payload 写入 `debug-logs/<caseId>/`。无需重启，实时生效。

### ProcedureRun 导出
```bash
curl http://localhost:3001/api/cases/{caseId}/export -o case-export.md
```
兼容 API 仍使用 `/api/cases/*` 路径，也可在 Console 的 ProcedureRun 详情页找到导出入口。

## 外部 API

Bearer token 鉴权（在 `/admin/api-keys` 创建管理）：
```bash
curl https://demo.anytrans.ai/api/messages \
  -H "Authorization: Bearer intera_sk_live_…" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","userId":"u_1"}'
```
