> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Chat Memory 重设计：双层记忆架构

> **来源合并**: `2026-05-29-user-memory-redesign.md` + `2026-05-29-chat-memory-redesign-review.md` + `2026-05-29-chat-memory-fix-plan.md`
> **实施状态**: 已实施（commits `c6d8c98` + `a3e3ec1`），代码审查发现若干偏离，修复计划另附。

---

## 1. 设计意图

将原本散落在各处的记忆机制整合成**两层职责分离**的清晰架构：

- **ChatMemory**（表 `chat_memories`，键 `caseId`）— per-case 工作记忆：`confirmedFacts`、`skillResults`、`todos`、`compactSummary`。agent 在当前 case 执行期间随时读写。
- **UserProfile**（表 `user_profiles`，键 `profileKey`）— 跨会话累积层：用户画像、历史摘要、行为统计。通过 `profileKey(userId, chatId)` 做身份隔离。

自动写入时机：Agent Loop compact 后 + `finalize_case`/`escalated` 退出时。手动写入：Console "Compact Now" 按钮。

---

## 2. 关键决策：C1 方向 b

Plan 最初设想 `ChatMemory 1:1 chatId`（跨 case 累积）。代码审查发现实现走了另一条路：

- `model ChatMemory` 仍是 **`caseId @unique`** + `case Case @relation`，只是类名从 `CaseMemory` 改为 `ChatMemory`、`@@map` 从 `case_memories` 改为 `chat_memories`。
- `ChatMemoryManager` 构造仍传 `caseId`，全部分 `prisma.chatMemory` 调用都是 `where: { caseId }`。
- **真正承载"跨会话累积"的是新起的 `UserProfile`（per userId）**。

**最终选择**：承认实际架构，明确 **UserProfile(per userId) 才是累积层**，ChatMemory 保持 per-case。改回 `CaseMemory` 类名还是保留 `ChatMemory` 由读者决定，但文档必须与代码一致。

---

## 3. 两层记忆数据流

```
当前 chat 的 messages (原始对话)
        │
        ▼  compactConversation()  ← compact 的对象永远是对话消息
        │
        ├──→ 注入当前 system prompt（解决 token 不够）
        │
        └──→ 追加/合并到 UserProfile（累积用户画像）
```

Agent 的 `read_chat_memory` 返回 per-case 工作记忆；`read_user_profile` 返回跨会话画像+统计。两者语义重叠（均返回 profile + stats），是已知噪音点。

---

## 4. 数据模型（实际实现）

### ChatMemory（per-case 工作记忆）

```prisma
model ChatMemory {
  id         String   @id @default(cuid())
  caseId     String   @unique
  case       Case     @relation(fields: [caseId], references: [id])

  confirmedFacts    Json     @default("[]")
  skillResults      Json     @default("[]")
  todos             Json     @default("[]")
  compactSummary    String?
  continuationLock  Int      @default(0)
  dashboardVersion  Int      @default(0)

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@map("chat_memories")
}
```

### UserProfile（跨会话累积层）

```prisma
model UserProfile {
  id         String   @id @default(cuid())
  profileKey String   @unique  // "user:<userId>" 或 "chat:<chatId>" 或 null

  profile    String   @default("")
  totalChats       Int @default(0)
  totalCases       Int @default(0)
  resolvedCases    Int @default(0)
  escalatedCases   Int @default(0)
  lastCaseType     String?
  firstSeenAt      DateTime?
  lastSeenAt       DateTime?

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@map("user_profiles")
}
```

---

## 5. 代码审查发现的问题

以下来自 `chat-memory-redesign-review.md`（对照 plan 逐项核对代码 + 生产库），按严重度排序。

### 🔴 Critical

**C1 — ChatMemory 没有按 chatId 重构**
（见 §2 关键决策，已接受方向 b）

**C2 — 匿名用户共享同一份 UserProfile（隐私 + 正确性）**
`resolvedUserId = userId || 'anonymous'` → 所有未登录访客共享 `profileKey='user:anonymous'`，A 用户画像被 B 用户读取 → 串号 + 隐私泄露。

**建议修复**: userId 为空/anonymous/UUID-不稳定时，不读不写 UserProfile。给 `appendToUserProfile` 和两个读 tool 加 guard。

**C3 — `case_memories` 旧表已删除，与 plan"保留兼容"矛盾**
`@@map` 从 `case_memories` 改到 `chat_memories` 后 `db push` 把旧表丢了。旧数据无法兼容读取。若旧数据仅为测试数据则可接受，但需更新文档。

### 🟠 High

**H1 — 运营手动 compact 会"覆盖"而非"合并" UserProfile**
`chats/[chatId]/compact/route.ts:63-67` 的 `update: { profile: summary }` 用本次摘要覆盖整条 profile，丢弃此前累积。与 `appendToUserProfile` 行为相反。

**建议修复**: 改为读出旧 profile 后追加/合并，抽成共享函数。

**H2 — Console 跨 app 直接 import chat app 源码**
`compact/route.ts:5` → `import { compactConversation } from '@/../chat/lib/agent/compact'` — 全仓库唯一跨 sibling app 的源码 import。

**建议修复**: 把 `compactConversation` 抽到 `packages/shared`。

**H3 — UserProfile 合并是裸拼接+字符截断，非 plan 的 LLM 去重**
`loop.ts:1890-1894` 用 `slice(0, maxTokens*4)` 按字符硬截断。Plan §5.2 的 LLM 去重 + 7天/30天分级压缩未实现。

### 🟡 Medium

- **M1**: `read_chat_memory` 与 `read_user_profile` 语义重叠，对模型是噪音。
- **M2**: 手动 compact 使用 `DEFAULT_MEMORY_STRATEGY`，忽略该 vendor 实际配置。
- **M3**: "tokens" 实为字符数（compact route 的 `content.length`）。
- **M4**: `appendToUserProfile` 的 update 不维护 `totalChats`、`escalatedCases`、`lastCaseType`、`firstSeenAt`。

### 🟢 Low

- **L1**: schema 注释"accumulated per-chat"与实际 per-case 矛盾。
- **L2**: plan 说 `toolContext.chatId` 自动获取，实际用 `this.deps.userId`。
- **L3**: `read_chat_memory` description 宣称"accumulated for the current chat"与实际不符。

---

## 6. 修复优先级

| 优先 | 问题 | 修复要点 |
|------|------|---------|
| P0 | C2 匿名串号 | userId 为空时不读不写 UserProfile |
| P0 | H1 覆盖 profile | 改为追加合并，统一逻辑 |
| P1 | C1 文档同步 | 更新命名/注释与代码一致 |
| P1 | H2 跨 app import | `compactConversation` 抽到 shared |
| P1 | H3 LLM 去重 | 补 LLM 合并或明确为 v1 简化 |
| P2 | M1-M4 | 工具合并、vendor 配置、token 估算、统计维护 |

---

## 7. Console UI 设计（待实现）

- **Chat 详情页 Memory tab**: 展示 ChatMemory summary + 统计 + "Compact Now" 按钮 + compact 历史
- **User Profile 页面** (`/ops/users/[userId]`): 跨 chat 画像 + 可编辑属性 + 关联 chat 列表
- **Agent Config Memory Strategy**: `enableChatMemory` toggle + maxTokens + merge prompt

---

## 8. 验证状态（审查时）

- `tsc --noEmit`（chat + console）通过
- Agent + LiveChat 单测 158/158 通过
- 生产库: `chat_memories`(1行), `user_profiles`(0行), `case_memories` 已缺失
- **未做**: 真实 `next build`（H2 需此验证）、端到端 UserProfile 累积/读取
