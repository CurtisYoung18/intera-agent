# 多 Agent + 多 Org 架构计划（Phase C）

> 来源：Phase B B2 侧边栏讨论。
>
> **Status (2026-06-04): 🟡 Partially shipped.** C1 + C2 shipped in v1.1/v1.3. C3 + C4 **unbuilt** — require architect sign-off before build (changes the login model from org-password to email/User).

## 1. 一个 Org → 多个 Agent Config（1:N）✅ C1 SHIPPED (v1.3)

### 现状

~~`AgentConfig.orgId` 带 `@unique`，强制 1 org = 1 套 agent 配置（prompt/model/skills/guardrails）。~~

**当前状态:** `AgentConfig.orgId` 已去 `@unique`，使用 `@@unique([orgId, name, version])`。`name` 字段已存在。一个 Org 可创建多套 Agent Config（不同 name/version）。

### 目标 ✅

一个 Org（商户）可创建多个 Agent Config（如 A 公司 10 个站点各有不同客服能力），每个 Agent Config 有独立的：
- systemPrompt / coreSystemPrompt（客服人格）
- model / temperature / thinkingBudget
- skills / guardrails
- API key（鉴权隔离）

### Schema（已实施）✅

```prisma
model AgentConfig {
  orgId String  @map("org_id")     // 无 @unique
  name  String  @default("Default") // UI 下拉显示
  @@unique([orgId, name, version])
}

model ApiKey {
  agentConfigId String? @map("agent_config_id")  // C2 ✅
  @@index([orgId, agentConfigId])
}
```

### UI（已实施）✅

- 侧边栏底部 org 区：Agent 下拉选择器 ✅
- Admin 页面路由：`?agentConfigId=xxx` query param ✅
- Agent Config 管理页：版本列表 + fork/激活 ✅
- API Key 管理：生成 key 时选择关联的 Agent Config ✅

---

## 2. User 账号 + 多 Org 关联 ❌ C3 + C4 UNBUILT

> **⚠️ 需要 architect sign-off.** C3 改变了登录模型（org-password → email/User），影响范围大。

### 现状

无 User 表。Console 登录通过 org 密码（`Organization.password`），cookie `intera_org_id` + `intera_auth='1'` 标识身份。

### 目标

一个用户账号可关联多个 Org（如代理商同时管理多个商户），登录后选 workspace。

### Schema 改动（未实施）

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String    // bcrypt
  name          String?
  createdAt     DateTime  @default(now())
  memberships   UserOrgMembership[]
  @@map("users")
}

model UserOrgMembership {
  id     String @id @default(cuid())
  userId String @map("user_id")
  orgId  String @map("org_id")
  role   String @default("admin") // admin | member
  user   User   @relation(fields: [userId], references: [id])
  org    Organization @relation(fields: [orgId], references: [id])
  @@unique([userId, orgId])
  @@map("user_org_memberships")
}
```

### UI 改动（未实施）

- 登录页：用 email+password 替代当前 orgId+password
- 登录后：显示 org 列表（workspace switcher），选一个进入
- 顶部/侧边栏：当前 org 名 + 切换入口
- 注册/邀请流程（后续）

---

## 3. 实施状态

| PR | 内容 | 状态 |
|----|------|------|
| C1 | AgentConfig 1:N 化（删 @unique + 加 name + UI 多 agent 选择器） | ✅ Shipped (v1.3) |
| C2 | ApiKey.agentConfigId 关联（key 绑定到具体 agent config） | ✅ Shipped (v1.1) |
| C3 | User 表 + 登录改造（email/password → workspace switcher） | ❌ Unbuilt — needs architect sign-off |
| C4 | 多 org 成员管理 + 邀请 | ❌ Unbuilt — depends on C3 |
