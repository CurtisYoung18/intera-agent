# 多 Agent + 多 Org 架构计划（Phase C，当前不实施）

> 来源：Phase B B2 侧边栏讨论。本文记录超出 Phase B 范围的架构变更，供后续迭代参考。

## 1. 一个 Org → 多个 Agent Config（1:N）

### 现状

`AgentConfig.orgId` 带 `@unique`，强制 1 org = 1 套 agent 配置（prompt/model/skills/guardrails）。

### 目标

一个 Org（商户）可创建多个 Agent Config（如 A 公司 10 个站点各有不同客服能力），每个 Agent Config 有独立的：
- systemPrompt / coreSystemPrompt（客服人格）
- model / temperature / thinkingBudget
- skills / guardrails
- API key（鉴权隔离）

### Schema 改动

```prisma
// AgentConfig.orgId: 删 @unique → 普通 @@index([orgId])
model AgentConfig {
  // ...
  orgId String  @map("org_id")  // 去掉 @unique
  name  String  @default("Default")  // 新增：用于 UI 下拉显示
  @@index([orgId])
}

// ApiKey: 加 agentConfigId（之前 YAGNI 撤了，届时加回）
model ApiKey {
  // ...
  agentConfigId String? @map("agent_config_id")  // 关联到具体 Agent Config
  @@index([orgId, agentConfigId])
}
```

### UI 改动

- 侧边栏底部 org 区：加 Agent 下拉选择器
- Admin 页面路由：加 `?agentConfigId=xxx` query param，或 `/admin/:agentConfigId/agent`
- Agent Config 管理页：列表 + 创建/删除（一个 org 下多个 config）
- API Key 管理：生成 key 时选择关联的 Agent Config

---

## 2. User 账号 + 多 Org 关联

### 现状

无 User 表。Console 登录通过 org 密码（`Organization.password`），cookie `intera_org_id` + `intera_auth='1'` 标识身份。

### 目标

一个用户账号可关联多个 Org（如代理商同时管理多个商户），登录后选 workspace。

### Schema 改动

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

### UI 改动

- 登录页：用 email+password 替代当前 orgId+password
- 登录后：显示 org 列表（workspace switcher），选一个进入
- 顶部/侧边栏：当前 org 名 + 切换入口
- 注册/邀请流程（后续）

---

## 3. 实施顺序（建议）

```
PR C1: AgentConfig 1:N 化（删 @unique + 加 name + UI 多 agent 选择器）
PR C2: ApiKey.agentConfigId 关联（key 绑定到具体 agent config）
PR C3: User 表 + 登录改造（email/password → workspace switcher）
PR C4: 多 org 成员管理 + 邀请
```

Phase B 侧边栏为 PR C1 预留 Agent 选择器入口（灰色 disabled，提示"即将上线"）。
