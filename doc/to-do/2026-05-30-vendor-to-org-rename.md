# vendor/customer → org/organization 全量重命名 Spec

> 日期: 2026-05-30
> 状态: Spec 确认，待实施
> 范围: 全域——DB schema、Prisma model、TypeScript types、API routes、UI 组件、i18n、URL 参数、注释

---

## 改名映射

| 旧 | 新 | 说明 |
|---|---|---|
| `vendor` / `Vendor` | `org` / `Organization` | 变量/类名 |
| `customer` / `Customer` | `org` / `Organization` | 历史残留 |
| `vendorId` | `orgId` | 字段/参数名 |
| `customerId` | `orgId` | DB 列映射、变量名 |
| `VENDOR_ID` | `ORG_ID` | 常量/环境变量 |
| `vendor_id` / `customer_id` | `org_id` | URL 参数/JSON key |
| `vendors` | `organizations` | DB 表名 |
| `Vendor` (Model) | `Organization` | Prisma model |
| 「商户」「客户」「供应商」 | 「组织」 | i18n 中文 |

---

## 影响层次（按依赖顺序）

### Phase 1: Prisma Schema ✓

```
model Organization {
  id        String   @id @default(cuid())
  name      String
  apiKey    String?
  password  String?
  ...
  @@map("organizations")
}
```

所有表的 `vendorId String @map("customerId")` → `orgId String @map("org_id")`。

涉及模型：AgentConfig, CaseType, Skill, Policy, Routing, Case, ChatMemory, KnowledgeSource, UserProfile, LiveChatConfig, ExternalConversation, LiveChatPendingEvent, ChannelHealth, ChannelBinding。

### Phase 2: Shared Types + Tools

- `packages/shared/types/index.ts`: `AgentConfigData`, `CaseSchemaConfig` 等接口
- `packages/shared/tools/tool.ts`: `ToolContext.orgId`
- `packages/shared/defaults/index.ts`: seed 数据中的 `vendorId` → `orgId`
- `packages/shared/channels/`: render hints, binding 中的 `vendorId`

### Phase 3: Chat App

- **Agent 核心**: `loop.ts` (`deps.vendorId` → `deps.orgId`), `skills.ts`, `memory.ts`, `compact.ts`, `policy.ts`, `sub-agent.ts`, `stage-executor.ts`
- **Tools**: `tools/builtin/*.ts` 中所有 `ctx.vendorId` → `ctx.orgId`
- **API routes**: `/api/messages`, `/api/cases/**`, `/api/livechat/webhook/[vendorId]` → `[orgId]`, `/api/coordinate`, `/api/human-chat`
- **LiveChat**: `bridge.ts`, `config-store.ts`, `livechat-api.ts`, `types.ts`, `session-store.ts`
- **Identity**: `identity.ts` 中的 `profileKey`
- **Worker**: `case-continuation.ts`
- **Env**: `ANTHROPIC_AUTH_TOKEN` 等（不变——这些和 org 无关）

### Phase 4: Console App

- **Pages**: `admin/agent`, `admin/tools`, `admin/guardrails`, `admin/case-types`, `admin/knowledge`, `admin/channels/**`, `ops/chats/**`, `ops/cases/**`, `ops/users/**`, `ops/human-tasks/**`
- **API routes**: `/api/admin/**`, `/api/ops/**`, `/api/chats/**`, `/api/users/**`
- **Auth**: `lib/auth.ts` (`getActiveVendorId` → `getActiveOrgId`)
- **Components**: `console-sidebar.tsx`, `agent-blueprint.tsx`, locale-provider, etc.
- **i18n**: `dictionaries.ts` —— 「商户」→「组织」，「Demo Vendor」→「Demo Org」，「API Vendor」→「API Org」

### Phase 5: 环境变量 + URL 参数

- LiveChat webhook URL: `/api/livechat/webhook/[vendorId]` → `[orgId]`
- Chat URL 参数: `?tenant=` / `?customer=` → `?org=`
- API body 参数: `vendorId` → `orgId`（所有 JSON 请求/响应）

---

## DB 迁移策略

不用 `prisma db push`（风险太大，可能丢数据）。用 Prisma migrate 或手写 SQL：

```sql
-- 1. 表
ALTER TABLE IF EXISTS vendors RENAME TO organizations;

-- 2. 列（所有带 customerId 的）
ALTER TABLE agent_configs RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE case_types RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE skills RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE policies RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE routings RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE cases RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE chat_memories RENAME COLUMN "customerId" TO "org_id"; -- 如果有
ALTER TABLE knowledge_sources RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE user_profiles RENAME COLUMN "customerId" TO "org_id"; -- 如果有
ALTER TABLE livechat_configs RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE external_conversations RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE livechat_pending_events RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE channel_health RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE channel_bindings RENAME COLUMN "customerId" TO "org_id";

-- 3. 索引/唯一约束重名（Prisma 会生成新的，旧的需手动清理）
-- 这些由 Prisma db push 在新 schema 上重新创建即可
```

**实施时注意**：
- 先在 staging/本地验证 SQL
- 生产迁移在低峰期执行
- 保留备份

---

## 风险点

| 风险 | 缓解 |
|------|------|
| DB 迁移失败/丢数据 | 先备份，本地验证 SQL 后再跑生产 |
| LiveChat webhook URL 变化导致回调失败 | 迁移后同步更新 LiveChat 平台 webhook 配置 |
| URL 参数 `?customer=api` 硬编码在外部系统 | 保留旧参数兼容一段时间，设 redirect |
| Console 登录 cookie 失效 | cookie key 不变（只改值），无需重新登录 |
| i18n 大量文案改动容易漏 | grep 全量扫描 + 中英文双向核对 |
| `@map("customerId")` 已映射为 `orgId`，DB 列名不变 | 不需要 ALTER COLUMN，只需改 `@map` 指向新列名 |

---

## 验收标准

1. `grep -rni "vendorId\|customerId\|Vendor\|vendor\b\|customer\b" apps/ packages/ --include="*.ts" --include="*.tsx"` → 0 结果（排除注释和 i18n 中刻意保留的）
2. `grep -rni "orgId\|org\b" apps/ packages/ --include="*.ts" --include="*.tsx"` → 全部正确使用
3. `npx tsc --noEmit -p apps/chat && npx tsc --noEmit -p apps/console` clean
4. `npm run build -w apps/chat && npm run build -w apps/console` 通过
5. 单测 158/158 通过
6. Railway 部署成功，API 正常响应
7. Console 侧边栏显示「Demo Org」而非「Demo Vendor」
8. LiveChat webhook 在新 URL 下正常处理消息
