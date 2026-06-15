> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# 数据模型全局重命名：Customer → Vendor → Org

> **来源合并**: `2026-05-29-customer-to-vendor-rename.md` + `2026-05-30-vendor-to-org-rename.md`
> **动机**: `customerId` 在 agent prompt 上下文中指租户/商户，但 LLM 倾向理解为"正在聊天的客户（end-user）"，造成语义混淆。分两步消除歧义。

---

## 第一阶段：Customer → Vendor（05-29，已完成）

### 动机

`customerId` 在代码中表示"租户/商户"，但模型天然理解成"终端用户"。`vendor` 比 `customer` 更接近 B2B 关系——Intera 的客户是使用平台的商户。

### 范围

**106 个源文件**，覆盖 Prisma Schema、Agent Engine、LiveChat Bridge、Chat/Console API Routes、Console UI、i18n、Seed、Tests。

### 执行策略

自底向上：Schema → Shared → Agent → API → UI，每层改完验证编译+测试。

### 核心映射

| 旧 | 新 | 示例 |
|---|---|---|
| `customerId` | `vendorId` | 字段/参数 |
| `Customer` | `Vendor` | Prisma model |
| `customers` | `vendors` | DB 表名 |
| `CUSTOMER_ID` | `VENDOR_ID` | 环境变量 |
| `DEFAULT_CUSTOMER_ID` | `DEFAULT_VENDOR_ID` | 默认值 |
| `getActiveCustomerId()` | `getActiveVendorId()` | console auth |
| `ensureDefaultCustomer()` | `ensureDefaultVendor()` | prisma helper |
| `intera_customer_id` | `intera_vendor_id` | cookie 名 |

**不改变**: `userId`（终端用户标识，语义正确）；i18n 中文文案中"客户"（业务描述，非代码逻辑）。

### 执行阶段

```
Phase 1: Schema + DB  (prisma db push)
Phase 2: Shared (types, defaults, channels)
Phase 3: Agent Engine (loop, skills, memory, policy, sub-agent)
Phase 4: LiveChat (bridge, config-store, types, session-store)
Phase 5: Chat API Routes (messages, livechat/webhook, cases)
Phase 6: Console Auth + API (auth routes, admin routes, ops routes)
Phase 7: Console UI (sidebar, admin pages, ops pages, i18n)
Phase 8: Chat UI + Worker
Phase 9: Environment (.env, environment variables)
Phase 10: Tests + Deploy
```

### 验收

- `prisma studio` 显示 `vendors` 表
- Chat/Console `tsc` 零错误
- ~200 单测全过
- Console 登录/切换正常
- LiveChat webhook 正常
- Agent prompt 中不再出现租户含义的 `customerId`

---

## 第二阶段：Vendor → Org（05-30，Spec 已确认，待实施）

### 动机

`vendor` 虽然比 `customer` 好，但仍不够准确。Intera 的用户是"组织"（公司/团队），而非"供应商"。`org` 是最中性、准确的术语。这是一次**从顶到底的全量重命名**，距离第一阶段仅隔一天。

### 改名映射

| 旧 | 新 | 说明 |
|---|---|---|
| `vendor` / `Vendor` | `org` / `Organization` | 变量/类名 |
| `customer` / `Customer` | `org` / `Organization` | 历史残留清理 |
| `vendorId` | `orgId` | 字段/参数 |
| `customerId` | `orgId` | DB 列映射 |
| `VENDOR_ID` | `ORG_ID` | 常量/环境变量 |
| `vendor_id` / `customer_id` | `org_id` | URL 参数/JSON key |
| `vendors` | `organizations` | DB 表名 |
| `Vendor` (Model) | `Organization` | Prisma model |
| 「商户」「供应商」 | 「组织」 | i18n 中文 |
| Demo Vendor / API Vendor | Demo Org / API Org | 默认实体名 |

### 影响层次

**Phase 1: Prisma Schema** — `model Organization` + `@@map("organizations")`，所有表 `vendorId @map("customerId")` → `orgId @map("org_id")`。涉及模型：AgentConfig, CaseType, Skill, Policy, Routing, Case, ChatMemory, KnowledgeSource, UserProfile, LiveChatConfig 等 14 个。

**Phase 2: Shared** — types, tools, defaults, channels。

**Phase 3: Chat App** — Agent 核心 + API routes + LiveChat + Worker + Env。

**Phase 4: Console App** — Pages + API routes + Auth + Components + i18n。

**Phase 5: 环境变量 + URL** — webhook URL `[vendorId]` → `[orgId]`，query param `?customer=` → `?org=`。

### DB 迁移策略

不用 `prisma db push`（风险大），用 Prisma migrate：

```sql
ALTER TABLE IF EXISTS vendors RENAME TO organizations;
ALTER TABLE agent_configs RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE case_types RENAME COLUMN "customerId" TO "org_id";
ALTER TABLE skills RENAME COLUMN "customerId" TO "org_id";
-- ... (14 张表同理)
```

**注意**: `@map("customerId")` 已映射为 `orgId` 时，DB 列名不变，只需改 `@map` 指向新列名。

### 风险

| 风险 | 缓解 |
|------|------|
| DB 迁移失败 | 先备份，本地验证 SQL |
| LiveChat webhook URL 变化 | 同步更新 LiveChat 平台配置 |
| `?customer=api` 硬编码 | 保留旧参数兼容 + redirect |
| Console cookie 失效 | key 不变，只改值 |
| i18n 大量文案 | grep 全量扫描 |
| `@map` 不匹配 | 确认 `@map` 指向正确列名 |

### 验收标准

1. `grep -rni "vendorId\|customerId\|Vendor\|vendor\b\|customer\b" apps/ packages/ --include="*.ts" --include="*.tsx"` → 0
2. `npx tsc --noEmit -p apps/chat && npx tsc --noEmit -p apps/console` clean
3. `npm run build -w apps/chat && npm run build -w apps/console` 通过
4. 单测全过
5. 部署正常
6. Console 侧边栏显示「Demo Org」
7. LiveChat webhook 新 URL 正常处理
