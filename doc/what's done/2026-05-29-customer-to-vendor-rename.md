# `Customer` → `Vendor` 全项目重命名 Plan

> 动机：当前 `customerId` 在 agent prompt 上下文中指租户/商户，但 LLM 倾向理解为"正在聊天的客户（end-user）"，造成语义混淆。全局改为 `vendor` 消除歧义。
> 范围：**106 个源文件**，覆盖 Prisma Schema、Agent Engine、LiveChat Bridge、Chat/Console API Routes、Console UI、i18n、Seed、Tests。
> 策略：自底向上（Schema → Shared → Agent → API → UI），每层改完验证编译+测试。

---

## 0. 命名映射表（全文统一）

| 旧名 | 新名 | 说明 |
|------|------|------|
| `Customer` | `Vendor` | Prisma model |
| `customers` | `vendors` | DB 表名 |
| `customerId` | `vendorId` | 字段/变量/参数 |
| `customer_id` | `vendor_id` | snake_case 上下文 |
| `customer` | `vendor` | 关系字段 |
| `CUSTOMER_ID` | `VENDOR_ID` | 环境变量 |
| `DEFAULT_CUSTOMER_ID` | `DEFAULT_VENDOR_ID` | 默认值常量 |
| `getActiveCustomerId()` | `getActiveVendorId()` | console auth helper |
| `ensureDefaultCustomer()` | `ensureDefaultVendor()` | prisma helper |
| `seedCustomerConfig()` | `seedVendorConfig()` | seed 函数 |
| `intera_customer_id` | `intera_vendor_id` | cookie 名 |
| `LiveChatConfig.customerId` | `LiveChatConfig.vendorId` | 类型字段 |
| `resolvedCustomerId` | `resolvedVendorId` | route 内部变量 |

**不改变**（避免过度重命名）：
- `userId` — 终端用户的标识，语义正确
- `customer` 在纯 UI 文案中（如 "customer service"）— 业务描述，不参与代码逻辑
- `Customer` 在 i18n 翻译文本中 — 如 `customers` 翻译键保持原样（Console 里"客户"仍叫客户）

---

## 1. Prisma Schema（4 文件）

### 1.1 `packages/shared/prisma/schema.prisma`
- [ ] `model Customer` → `model Vendor`
- [ ] `@@map("customers")` → `@@map("vendors")`
- [ ] 所有 `customerId String` → `vendorId String`
- [ ] 所有 `customer Customer @relation(fields: [customerId]` → `vendor Vendor @relation(fields: [vendorId]`
- [ ] 所有 `@@unique([customerId, ...])` → `@@unique([vendorId, ...])`
- [ ] 所有 `@@index([customerId, ...])` → `@@index([vendorId, ...])`
- [ ] 注释中的 "客户" → "商户"

### 1.2 `packages/shared/prisma/index.ts`
- [ ] `ensureDefaultCustomer()` → `ensureDefaultVendor()`
- [ ] 内部变量 `CUSTOMER_ID` → `VENDOR_ID`

### 1.3 `packages/shared/prisma/seed.ts`
- [ ] `seedCustomerConfig()` → `seedVendorConfig()`
- [ ] `customerId` 参数 → `vendorId`
- [ ] 调用处：`seedVendorConfig('default', ...)` / `seedVendorConfig('api', ...)`
- [ ] 注释更新

### 1.4 `packages/shared/prisma/seed-render-hints.ts`
- [ ] `customerId` → `vendorId`
- [ ] `prisma.skill.findUnique({ where: { customerId_name: ... } })` → `vendorId_name`

### 1.5 DB Migration
- [ ] `npx prisma db push --accept-data-loss`（开发环境）或 `npx prisma migrate dev`（生产）
- [ ] 验证：`npx prisma studio` 确认表名变为 `vendors`

---

## 2. Shared Package（6 文件）

### 2.1 `packages/shared/types/index.ts`
- [ ] 所有含 `customerId` 的 interface/type → `vendorId`

### 2.2 `packages/shared/defaults/index.ts`
- [ ] `DEFAULT_SKILLS` 中涉及 `customerId` 的字段 → 无（DEFAULT_SKILLS 不含 customerId）
- [ ] Prompt 模板中提及 `customer` 为租户语义的地方 → `vendor`（需逐条审查）
- [ ] `DEFAULT_SYSTEM_PROMPT` 中的 "customer" → 保留（指 end-user）

### 2.3 `packages/shared/channels/binding.ts`
- [ ] `ChannelBindingConfig` 中如有 `customerId` → `vendorId`

### 2.4 `packages/shared/channels/renderer.ts`
- [ ] `RenderContext` 中 `customerId` → `vendorId`

### 2.5 `packages/shared/tools/tool.ts`
- [ ] Tool 接口中如有 `customerId` → `vendorId`

---

## 3. Agent Engine（15 文件）

### 3.1 `apps/chat/lib/agent/session-store.ts`
- [ ] 类型/变量：`customerId` → `vendorId`

### 3.2 `apps/chat/lib/agent/skills.ts`
- [ ] `SkillRouter.create(customerId)` → `create(vendorId)`
- [ ] 内部字段 `this.customerId` → `this.vendorId`
- [ ] `prisma.skill.findMany({ where: { customerId } })` → `{ vendorId }`
- [ ] KnowledgeSource 查询：`where: { customerId, enabled: true }` → `{ vendorId }`
- [ ] `BUILT_IN_SKILLS` 中有 `customerId` → `vendorId`

### 3.3 `apps/chat/lib/agent/loop.ts`
- [ ] `AgentLoop.create({ customerId })` → `create({ vendorId })`
- [ ] `this.deps.customerId` → `this.deps.vendorId`
- [ ] AgentLoop 内部所有 `customerId` 变量 → `vendorId`

### 3.4 `apps/chat/lib/agent/memory.ts`
- [ ] 参数/类型中 `customerId` → `vendorId`

### 3.5 `apps/chat/lib/agent/policy.ts`
- [ ] `PolicyEngine` 中 `customerId` → `vendorId`

### 3.6 `apps/chat/lib/agent/orchestrator.ts`
- [ ] `orchestrator` 中 `customerId` → `vendorId`

### 3.7 `apps/chat/lib/agent/sub-agent.ts`
- [ ] `sub-agent` 中 `customerId` → `vendorId`

### 3.8 `apps/chat/lib/agent/stage-executor.ts`
- [ ] `stage-executor` 中 `customerId` → `vendorId`

### 3.9 `apps/chat/lib/agent/tools/business/business-tool-adapter.ts`
- [ ] 如有 `customerId` → `vendorId`

### 3.10 `apps/chat/lib/agent/tools/builtin/*.ts`
- [ ] 3 个 builtin 工具文件中如有 `customerId` → `vendorId`

### 3.11-3.15 Agent Tests
- [ ] `__tests__/factories/` — `customerId` → `vendorId`
- [ ] `__tests__/unit/session-store.test.ts` — 更新测试

---

## 4. LiveChat Integration（9 文件）

### 4.1 `apps/chat/lib/livechat/types.ts`
- [ ] `LiveChatConfig.customerId` → `vendorId`
- [ ] `BridgeSession.customerId` → `vendorId`

### 4.2 `apps/chat/lib/livechat/bridge.ts`
- [ ] `handleIncomingEvent(chatId, customerId, ...)` → `(chatId, vendorId, ...)`
- [ ] 内部所有 `customerId` 变量 → `vendorId`
- [ ] `lcParams(config)` 使用不变（此函数不涉及 customerId）

### 4.3 `apps/chat/lib/livechat/session-store.ts`
- [ ] `BridgeSessionRow.customerId` → `vendorId`
- [ ] Prisma 查询 `where: { customerId }` → `{ vendorId }`

### 4.4 `apps/chat/lib/livechat/config-store.ts`
- [ ] `getLiveChatConfig(customerId)` → `getLiveChatConfig(vendorId)`
- [ ] `upsertLiveChatConfig(customerId, data)` → `upsertLiveChatConfig(vendorId, data)`
- [ ] `invalidateLiveChatConfig(customerId)` → `invalidateLiveChatConfig(vendorId)`
- [ ] `prisma.liveChatConfig.findUnique({ where: { customerId } })` → `{ vendorId }`

### 4.5 `apps/chat/lib/livechat/channel-health.ts`
- [ ] `markChannelUnhealthy(customerId, ...)` → `(vendorId, ...)`

### 4.6 `apps/chat/lib/livechat/retry-queue.ts`
- [ ] `enqueueRetry(... customerId ...)` → `vendorId`
- [ ] `LiveChatPendingEvent` Prisma 操作

### 4.7 `apps/chat/lib/livechat/webhook-dedup.ts`
- [ ] 如有 `customerId` → `vendorId`

### 4.8-4.9 LiveChat Tests
- [ ] `__tests__/unit/` 中所有 `customerId` → `vendorId`
- [ ] `__tests__/integration/` 中所有 `customerId` → `vendorId`

---

## 5. Chat API Routes（11 文件）

### 5.1 `apps/chat/app/api/messages/route.ts`
- [ ] `resolvedCustomerId` → `resolvedVendorId`
- [ ] 所有 Prisma 查询中的 `customerId` → `vendorId`
- [ ] `Case.create({ customerId })` → `{ vendorId }`

### 5.2 `apps/chat/app/api/livechat/webhook/route.ts`
- [ ] `customerId` 变量 → `vendorId`
- [ ] `process.env.DEFAULT_CUSTOMER_ID` → `DEFAULT_VENDOR_ID`
- [ ] `getLiveChatConfig(customerId)` → `getLiveChatConfig(vendorId)`

### 5.3 `apps/chat/app/api/livechat/webhook/[customerId]/route.ts`
- [ ] 文件名：`[customerId]` → `[vendorId]`
- [ ] 参数名：`params.customerId` → `params.vendorId`
- [ ] 函数内所有引用更新

### 5.4 `apps/chat/app/api/livechat/config/route.ts`
- [ ] query param `customerId` → `vendorId`
- [ ] 请求体中的 `customerId` 字段 → `vendorId`

### 5.5 `apps/chat/app/api/livechat/groups/route.ts`
- [ ] `customerId` → `vendorId`

### 5.6 `apps/chat/app/api/cases/route.ts`
- [ ] `customerId` → `vendorId`

### 5.7 `apps/chat/app/api/cases/[id]/stream/route.ts`
- [ ] `customerId` → `vendorId`

### 5.8 `apps/chat/app/api/cases/[id]/message/route.ts`
- [ ] `customerId` → `vendorId`

### 5.9 `apps/chat/app/api/admin/config-changed/route.ts`
- [ ] `customerId` → `vendorId`

### 5.10 `apps/chat/app/api/coordinate/route.ts`
- [ ] `customerId` → `vendorId`

### 5.11 `apps/chat/app/api/human-chat/route.ts`, `composer-assist/`
- [ ] `customerId` → `vendorId`

---

## 6. Console API Routes（22 文件）

### 6.1 Auth
- [ ] `apps/console/app/api/auth/login/route.ts` — cookie 名 `intera_customer_id` → `intera_vendor_id`
- [ ] `apps/console/app/api/auth/logout/route.ts` — 同上
- [ ] `apps/console/app/api/auth/session/route.ts` — 同上

### 6.2 Admin Routes（18 文件）
所有文件：`customerId` 参数/变量 → `vendorId`，Prisma `where: { customerId }` → `{ vendorId }`

- [ ] `admin/agent/route.ts`
- [ ] `admin/skills/route.ts`
- [ ] `admin/skills/[name]/route.ts`
- [ ] `admin/policies/route.ts`, `[name]/route.ts`, `stats/route.ts`
- [ ] `admin/case-types/route.ts`, `[name]/route.ts`
- [ ] `admin/routing/route.ts`, `[name]/route.ts`
- [ ] `admin/knowledge/sources/route.ts`, `sources/[id]/route.ts`, `gptbots/route.ts`, `test/route.ts`

### 6.3 Ops Routes
- [ ] `apps/console/app/api/cases/route.ts`, `[id]/route.ts`, `[id]/export/route.ts`
- [ ] `apps/console/app/api/human-tasks/route.ts`, `[id]/route.ts`, `[id]/resolve/route.ts`
- [ ] `apps/console/app/api/chats/route.ts`
- [ ] `apps/console/app/api/ops/dashboard/route.ts`

---

## 7. Console UI（15 文件）

### 7.1 `apps/console/lib/auth.ts`
- [ ] `getActiveCustomerId()` → `getActiveVendorId()`
- [ ] Cookie 读取 `intera_customer_id` → `intera_vendor_id`

### 7.2 `apps/console/lib/chat-api.ts`
- [ ] 如有 `customerId` → `vendorId`

### 7.3 `apps/console/components/console-sidebar.tsx`
- [ ] "Switch Project" 下拉中的 `customerId` → `vendorId`
- [ ] 文案："客户" → "商户"

### 7.4 Console Pages（12 文件）
所有 `customerId` 参数/变量 → `vendorId`，UI 文案更新

- [ ] `admin/agent/page.tsx`
- [ ] `admin/tools/page.tsx` — `getActiveCustomerId()` → `getActiveVendorId()`
- [ ] `admin/channels/livechat/page.tsx` — `customerId` state → `vendorId`
- [ ] `admin/channels/web-chat/page.tsx`
- [ ] `admin/channels/page.tsx`
- [ ] `admin/case-types/page.tsx`, `[name]/page.tsx`
- [ ] `admin/human-ops/page.tsx`
- [ ] `ops/guide/page.tsx`
- [ ] `ops/human-tasks/[id]/page.tsx`

### 7.5 i18n
- [ ] `apps/console/lib/i18n/dictionaries.ts` — 翻译键更新（如有）

---

## 8. Chat UI（4 文件）

### 8.1 `apps/chat/app/chat/` 
- [ ] `use-intera-chat.ts` — 如有 `customerId` → `vendorId`

### 8.2 `apps/chat/components/chat/`
- [ ] 3 个 chat 组件 — 如有 `customerId` → `vendorId`

---

## 9. 环境变量 & 配置（3 文件）

### 9.1 Root `.env` / App `.env.local`
- [ ] `DEFAULT_CUSTOMER_ID=api` → `DEFAULT_VENDOR_ID=api`
- [ ] 所有 `CUSTOMER_ID` → `VENDOR_ID`

### 9.2 Railway 环境变量
- [ ] Chat 服务：`DEFAULT_CUSTOMER_ID` → `DEFAULT_VENDOR_ID`
- [ ] Console 服务：同上

### 9.3 Worker
- [ ] `apps/chat/worker/case-continuation.ts` — `customerId` → `vendorId`

---

## 10. 测试（13 文件）

所有 `customerId` → `vendorId`，包括 test fixtures、mock data、assertions。

### 10.1 Agent Tests
- [ ] `apps/chat/lib/agent/__tests__/factories/`
- [ ] `apps/chat/lib/agent/__tests__/unit/session-store.test.ts`

### 10.2 LiveChat Tests
- [ ] `apps/chat/lib/livechat/__tests__/unit/` (6 文件)
- [ ] `apps/chat/lib/livechat/__tests__/integration/` (3 文件)
- [ ] `apps/chat/lib/livechat/__tests__/mocks/`

### 10.3 Console Tests
- [ ] `apps/console/components/admin/__tests__/`

---

## 11. 文档 & 脚本

- [ ] `CLAUDE.md` — 架构描述中 `Customer` → `Vendor`
- [ ] `doc/` 下相关文档 — 术语统一
- [ ] `scripts/deploy.sh` — 如有 `customerId` → `vendorId`

---

## 执行顺序（严格自底向上）

```
Phase 1:  Schema + DB
  ├── 1.1  schema.prisma 全部重命名
  ├── 1.2  prisma/index.ts
  ├── 1.3  npx prisma generate
  ├── 1.4  npx prisma db push
  └── ✓ 验证: prisma studio 确认 vendors 表

Phase 2:  Shared Package
  ├── 2.1  types/index.ts
  ├── 2.2  defaults/index.ts
  ├── 2.3  channels/*
  ├── 2.4  prisma/seed.ts + seed-render-hints.ts
  └── ✓ 验证: tsc -p packages/shared/tsconfig.json

Phase 3:  Agent Engine
  ├── 3.1  skills.ts (SkillRouter)
  ├── 3.2  session-store.ts
  ├── 3.3  loop.ts (AgentLoop)
  ├── 3.4  memory.ts, policy.ts
  ├── 3.5  orchestrator.ts, sub-agent.ts, stage-executor.ts
  ├── 3.6  tools/business/*, tools/builtin/*
  └── ✓ 验证: agent engine unit tests pass

Phase 4:  LiveChat Integration
  ├── 4.1  types.ts, config-store.ts, session-store.ts
  ├── 4.2  bridge.ts
  ├── 4.3  channel-health.ts, retry-queue.ts, webhook-dedup.ts
  ├── 4.4  channels/livechat/renderer.ts, render-skill-by-hint.ts
  └── ✓ 验证: LiveChat unit tests pass

Phase 5:  Chat API Routes
  ├── 5.1  messages/route.ts (最大文件)
  ├── 5.2  livechat/webhook/*, livechat/config, livechat/groups
  ├── 5.3  cases/*
  ├── 5.4  admin/config-changed, coordinate, human-chat, composer-assist
  └── ✓ 验证: tsc -p apps/chat/tsconfig.json

Phase 6:  Console Auth + API Routes
  ├── 6.1  auth.ts (getActiveVendorId), auth routes (cookie 改名)
  ├── 6.2  admin routes (18 files)
  ├── 6.3  ops routes
  └── ✓ 验证: tsc -p apps/console/tsconfig.json

Phase 7:  Console UI
  ├── 7.1  console-sidebar.tsx
  ├── 7.2  admin pages (12 files)
  ├── 7.3  ops pages
  ├── 7.4  i18n dictionaries
  └── ✓ 验证: visual check in browser

Phase 8:  Chat UI + Worker
  ├── 8.1  use-intera-chat.ts
  ├── 8.2  chat components
  ├── 8.3  worker
  └── ✓ 验证: tsc

Phase 9:  Environment & Config
  ├── 9.1  .env / .env.local
  ├── 9.2  Railway variables
  └── ✓ 验证: 部署后功能正常

Phase 10: Tests & Deploy
  ├── 10.1  全部单元测试通过
  ├── 10.2  deploy chat + console
  └── ✓ 验证: 生产环境端到端
```

---

## 验收标准

- [ ] `npx prisma studio` 显示 `vendors` 表（非 `customers`）
- [ ] `npx tsc -p apps/chat/tsconfig.json` 零错误
- [ ] `npx tsc -p apps/console/tsconfig.json` 零错误
- [ ] 所有单元测试通过（~200 个）
- [ ] Console 登录/切换商户正常
- [ ] LiveChat webhook 正常工作（消息收发）
- [ ] Agent prompt 中不出现 `customerId` 或 `Customer`（指租户时）
- [ ] Railway 部署后两个服务均 healthy
