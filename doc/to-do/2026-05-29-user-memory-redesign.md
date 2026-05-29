# Chat Memory 重设计 Plan

> 日期: 2026-05-29
> 状态: Plan 确认，待实施

---

## 命名决策

**Chat Memory** — 绑定 `chatId`，不是 `caseId` 也不是 `userId`。

理由：
- 同一个 `chatId` = 同一个人不换浏览器的所有对话 → 自然等同于 "这个用户的记忆"
- Console 运营按 chat 维度操作（`/ops/chats/[chatId]`），打开一个 chat 就能看到这个人的完整历史和累积记忆
- 已有 `external_conversations` 表按 `chatId` 索引、`Case.chatId` 关联——chatId 已经是 Intera 的用户分组键

```
ChatMemory 1:1 chatId  →  跨 case 累积，跨 session 持久
```

---

## 代码命名变更映射

全局重命名，不留旧名残渣：

| 旧名 | 新名 |
|------|------|
| `CaseMemoryManager` | `ChatMemoryManager` |
| `CaseMemoryData` | `ChatMemoryData` |
| `CaseMemoryReader` | `ChatMemoryReader` |
| `caseMemory` (变量/属性名) | `chatMemory` |
| `case_memories` (DB 表) | `chat_memories` |
| `CaseMemory` (Prisma model) | `ChatMemory` |
| `caseMemory` (ToolContext 字段) | `chatMemory` |
| `getMemorySummary()` | 不变（仍返回 memory 摘要） |
| `loadMemory()` | 不变 |
| `caseMemory.ingestUserMessageFacts()` | `chatMemory.ingestUserMessageFacts()` |
| `caseMemory.applySkillResult()` | `chatMemory.applySkillResult()` |
| `caseMemory.setSummary()` | `chatMemory.setSummary()` |

涉及文件清单（代码层）：
- `apps/chat/lib/agent/memory.ts` — 类名 + 文件名
- `apps/chat/lib/agent/loop.ts` — 所有 `caseMemory` 引用
- `apps/chat/lib/agent/compact.ts` — `CaseMemoryManager` 引用
- `apps/chat/lib/agent/sub-agent.ts` — ToolContext 传递
- `apps/chat/lib/agent/tools/builtin/*.ts` — ToolContext.caseMemory → chatMemory
- `apps/chat/app/api/messages/route.ts` — `prisma.caseMemory` → `prisma.chatMemory`
- `apps/chat/app/api/cases/[id]/stream/route.ts` — 同上
- `apps/chat/app/api/coordinate/route.ts` — 同上
- `apps/console/app/api/cases/[id]/route.ts` — 同上
- `packages/shared/types/index.ts` — 类型重命名
- `packages/shared/tools/tool.ts` — `CaseMemoryReader` → `ChatMemoryReader`
- `packages/shared/prisma/schema.prisma` — model 重命名 + `@@map`

---

## 两层记忆的关系

| | 对话 Compact（已有） | Chat Memory（新增/重命名） |
|---|---|---|
| **粒度** | 当前 chat 的消息流 | 跨 case、跨 session，同一个 chatId 累积 |
| **触发** | 运营手动 + token 阈值自动 | 每次 compact 完成后追加写入 |
| **存储** | 临时——compact 后旧消息 snip，摘要注入 system prompt | 持久——绑 chatId，下次对话自动加载 |
| **Agent 可见** | 隐式（在 system prompt 内） | `read_chat_memory` tool 显式查询 |

**不是替代，是上下游**：

```
当前 chat 的 messages (原始对话)
        │
        ▼  compactConversation()  ← compact 的对象永远是对话消息
        │
        ├──→ 注入当前 system prompt（解决 token 不够）
        │
        └──→ 追加/合并到 ChatMemory（累积用户画像）
```

Agent Config 的 Memory Strategy 控制的仍然是**对话消息的 compact 行为**，不变。

---

## 数据模型

### ChatMemory 表（重命名 + 改造自 CaseMemory）

```prisma
model ChatMemory {
  id         String   @id @default(cuid())
  chatId     String   @unique  // ← 从 caseId 改为 chatId
  vendorId   String   @default("default")
  
  // Compact 累积产物
  summary       String?  // 累积的 chat 历史摘要（9-section 格式）
  lastSummaryAt DateTime?
  summaryTokenCount Int  @default(0)
  
  // 统计（跨 case）
  totalCases      Int @default(0)
  resolvedCases   Int @default(0)
  escalatedCases  Int @default(0)
  lastCaseAt      DateTime?
  lastCaseType    String?
  
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  
  @@map("chat_memories")
}
```

### UserProfile 表（新）

```prisma
model UserProfile {
  id         String   @id @default(cuid())
  userId     String   @unique
  vendorId   String   @default("default")
  
  // AI 维护的 Markdown 文档（自由格式，compact 引擎自动更新）
  // 例: "## 用户画像\n- 姓名: Jay\n- 偏好语言: 中文\n- 偏好支付: bKash\n..."
  profile    String   @default("")
  
  // 统计（跨所有 chat）
  totalChats       Int @default(0)
  totalCases       Int @default(0)
  resolvedCases    Int @default(0)
  escalatedCases   Int @default(0)
  firstSeenAt      DateTime?
  lastSeenAt       DateTime?
  
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  
  @@map("user_profiles")
}
```

`profile` 字段是自由格式 Markdown，由 compact 引擎在每次 compact 后追加/合并。
运营在 Console 可以直接编辑（Markdown 编辑器）。
Agent 通过 `read_chat_memory` 读到的是已渲染文本。

### CaseMemory 旧表 → 退休

`case_memories` 表保留不删。新 case 创建时不再写入 CaseMemory。旧数据仅在 `/api/cases/[id]` 查询时兼容读取。

---

## Compact 的两个触发时机

### 触发 1: 运营手动 compact

Console → Ops → Chats → 选中某 chatId → 顶部 "Compact Memory" 按钮

```
POST /api/chats/[chatId]/compact
  → 加载该 chat 的所有 messages（跨所有 case，orderBy createdAt）
  → compactConversation(messages, strategy)
  → 生成 9-section 摘要
  → 合并写入 ChatMemory.summary（与旧 summary 合并，LLM 去重）
  → 返回: { summary, beforeTokens, afterTokens, compactedAt }
```

Console 页面展示：
- Chat Memory 面板：当前 chat 的统计 + summary 全文
- Compact 结果预览（摘要文本、压缩前后 token 对比）
- 手动编辑 summary 的能力
- 上次 compact 时间 + 触发方式（manual / auto）

### 触发 2: 系统自动 compact（token 阈值）

已有 `checkAndCompact()` 逻辑不变。变化点：
- compact 结果**不只注入 system prompt**，还**异步追加到 ChatMemory**
- `finalize_case` 时触发最终 compact → 追加到 ChatMemory
- 追加时做合并去重（与新 summary 对比，LLM 判断重复内容并压缩）

---

## System Tools

### `read_chat_memory` ✅

```typescript
{
  name: 'read_chat_memory',
  description: 'Read the accumulated memory for the current chat. This contains the user\'s history, past issues, preferences, and patterns learned from previous conversations. Use this to gain deeper context about who you are talking to.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
}
```

不需要传参——Agent 所在 chat 的 `chatId` 从 `ToolContext` 自动获取。返回：

```json
{
  "summary": "1. Primary Request: ...\n2. Key Facts: ...",
  "stats": {
    "totalCases": 5,
    "resolvedCases": 4,
    "escalatedCases": 1,
    "lastCaseType": "deposit_issue",
    "lastCaseAt": "2026-05-28T..."
  }
}
```

Agent 在以下场景自动调用：
- 新 case 创建后，了解用户历史
- 需要判断用户偏好时（支付方式、语言等）
- 遇到重复问题时，查上次解决方案

### `update_chat_memory` ❌ 不做

原因：
- 并发风险：split mode 下多个 case 同时写 → 数据竞争
- 质量风险：Agent 可能基于幻觉写入错误信息

替代：compact 引擎负责写入（运营手动 + 系统自动 + finalize_case 异步追加）。

---

## Console UI: Chat Memory + User Profile

每个 chat 页面可视化展示 Chat Memory，并链接到 User Profile。

### Chat 详情页 (`/ops/chats/[chatId]`) — Memory tab

```
┌─ Header ───────────────────────────────────────────┐
│ ← Back  Chat · userId  [case pills] [📊]          │
│ xx cases · xx msgs · xx traces                     │
│ [Messages] [Traces] [Memory] [Analysis]            │
└────────────────────────────────────────────────────┘

Memory tab:
┌─ User Profile (link) ──────────────────────────────┐
│ 👤 userId · 5 cases · 注册 2025-01                  │
│ 偏好: bKash · 中文 · deposit_issue 常客              │
│                                    [Open Profile →] │
└─────────────────────────────────────────────────────┘

┌─ Chat Memory (this chatId) ────────────────────────┐
│ Stats: 5 cases · 4 resolved · 1 escalated          │
│ Last case: deposit_issue · 2026-05-28              │
├─────────────────────────────────────────────────────┤
│ Summary:                                            │
│ 1. Primary Customer Request: ...                    │
│ 2. Key Facts: txnId=TX123, amount=500 BDT, ...     │
│ 3. Skills/Tools Executed: query_order_status × 3,  │
│    query_payment_channel × 2, kb_search × 5        │
│ ...                                                 │
│                                      [Edit] [Compact]│
├─────────────────────────────────────────────────────┤
│ Compact History:                                    │
│  2026-05-29 14:23  auto    12K → 2K tokens         │
│  2026-05-28 10:15  manual   8K → 1.5K tokens       │
└─────────────────────────────────────────────────────┘
```

### User Profile 页面 (`/ops/users/[userId]` 或弹窗)

独立页面，展示跨 chat 的用户全貌：

```
┌─ User Profile: JAYA113C88F ────────────────────────┐
│                                                     │
│ ┌─ Stats Bar ─────────────────────────────────────┐ │
│ │ 2 chats · 7 cases · 6 resolved · 1 escalated     │ │
│ │ First seen: 2025-01-15 · Last: 2026-05-29         │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ Profile (Markdown, AI-maintained) ─────────────┐ │
│ │ ## 用户画像                                        │ │
│ │ - 姓名: Jay                                        │ │
│ │ - 偏好语言: 中文                                   │ │
│ │ - 常用支付: bKash, Nagad                           │ │
│ │ - 常遇问题: deposit_issue (5次), account_issue (2次)│ │
│ │ - 标签: VIP, 高频用户                               │ │
│ │                                                    │ │
│ │ ## 历史记录                                        │ │
│ │ - 2026-05-29: 存款500 BDT未到账，已解决             │ │
│ │ - 2026-05-20: 账户登录失败，已重置密码               │ │
│ │ ...                                                │ │
│ │                                     [Edit] [Save]  │ │
│ └──────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ Chat History ──────────────────────────────────┐ │
│ │ Chat #1 · 5 cases · Last: 2026-05-29  [Open →]  │ │
│ │ Chat #2 · 2 cases · Last: 2026-05-20  [Open →]  │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**关键交互**：
- Chat 详情页的 Memory tab 顶部有一行 User Profile 摘要卡片，点击 "Open Profile" 打开独立页面
- User Profile 页面列出该用户的所有 chat、聚合统计、可编辑的结构化属性
- 运营可以在 Profile 页手动编辑用户属性（偏好语言、支付方式、标签等）
- "Re-compact All" 跨 chat 重新生成聚合摘要

### 数据关系

```
UserProfile (per userId, 结构化字段)
    │
    ├──→ linked from Chat Memory tab (顶部卡片)
    │
    └──→ 聚合所有 ChatMemory 的统计

ChatMemory (per chatId, compact 累积)
    │
    ├──→ 每个 chat 页面的 Memory tab 主要内容
    │
    └──→ 运营手动 compact 写入
        系统自动 compact 写入
```

### 配置可视化

Agent Config → Memory Strategy 面板新增：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableChatMemory` | toggle | true | 是否启用 Chat Memory 累积 |
| `chatMemoryMergePrompt` | textarea | 内置默认 | 合并旧新 summary 时的 LLM prompt |
| `chatMemoryMaxTokens` | number | 4000 | ChatMemory 摘要的最大 token 数 |

---

## Compact Prompt 优化

当前 9-section prompt 的 Section 3 "Skills/Tools Executed and Results" 会逐条列出所有 tool+全量 JSON 返回值。

**问题**：对于长期累积的 ChatMemory，老 tool 结果的原始 JSON 占 token 且价值递减。

**优化方向**：

```
追加指令到 COMPACT_SYSTEM_PROMPT：

合并策略（合并旧 ChatMemory 与新摘要时）:
- 旧摘要中超过 7 天的 tool 结果：只保留结论（一行），丢弃原始 JSON
- 超过 30 天的 tool 结果：只保留 skill 名称
- 合并同类 tool 的多次调用："query_order_status 在过去 3 个月被调用了 5 次，最近一次结果：..."
- 用户消息摘要（Section 6）永不压缩——用户每次说的都要记住
- 事实部分去重：同一 key 以最新值为准，旧值丢弃
- 总 token 控制在 chatMemoryMaxTokens 以内
```

---

## 实施步骤

### Phase 0: 全局重命名（P0，必须先做）

| # | 任务 |
|---|------|
| 0.1 | `CaseMemoryManager` → `ChatMemoryManager`（类名 + 文件名 `memory.ts` 不变） |
| 0.2 | `CaseMemoryData` / `CaseMemoryReader` → `ChatMemoryData` / `ChatMemoryReader` |
| 0.3 | 所有 `caseMemory` 变量/属性 → `chatMemory` |
| 0.4 | Prisma model `CaseMemory` → `ChatMemory`，`@@map("case_memories")` → `@@map("chat_memories")`，`caseId @unique` → `chatId @unique` |
| 0.5 | 所有 `prisma.caseMemory` 引用 → `prisma.chatMemory` |
| 0.6 | ToolContext 接口 `caseMemory: CaseMemoryReader` → `chatMemory: ChatMemoryReader` |
| 0.7 | Console API 路由类型引用更新 |
| 0.8 | typecheck + build 通过 |

### Phase 1: 数据模型 + System Tool（P0）

| # | 任务 | 文件 |
|---|------|------|
| 1.1 | 新增 `ChatMemory` 表（替代 CaseMemory） | `schema.prisma` |
| 1.2 | 新增 `UserProfile` 表 | `schema.prisma` |
| 1.3 | 新增 `read_chat_memory` system tool | `skills.ts` + `tools/builtin/read-chat-memory.ts` |
| 1.4 | `compactConversation()` 结果追加到 ChatMemory | `compact.ts` |
| 1.5 | `finalize_case` 触发最终 compact → 追加 | `tools/builtin/finalize-case.ts` |
| 1.6 | 旧 case_memories 表读写切到 chat_memories（兼容） | routes |

### Phase 2: Console UI — Chat Memory tab（P1）

| # | 任务 | 文件 |
|---|------|------|
| 2.1 | Chat 详情页新增 Memory tab | `ops/chats/[chatId]/page.tsx` |
| 2.2 | User Profile 摘要卡片（顶部，链接到 Profile 页） | 同上 |
| 2.3 | Stats 卡片 + Summary 查看/编辑（Markdown） | 同上 |
| 2.4 | "Compact Now" 按钮 + 结果预览 + token 对比 | 同上 |
| 2.5 | Compact 历史时间线 | 同上 |
| 2.6 | `POST /api/chats/[chatId]/compact` API | 新增 route |

### Phase 3: Console UI — User Profile 页（P1）

| # | 任务 | 文件 |
|---|------|------|
| 3.1 | `/ops/users/[userId]` 页面 | 新增 |
| 3.2 | Attributes 查看 + 编辑（JSON 表单） | 同上 |
| 3.3 | 关联 Chat 列表（该用户的所有 chatId） | 同上 |
| 3.4 | 聚合 Memory（跨 chat 摘要） | 同上 |
| 3.5 | "Re-compact All" 按钮 | 同上 |
| 3.6 | `GET/PUT /api/users/[userId]/profile` API | 新增 route |

### Phase 4: Agent Config UI（P1）

| # | 任务 | 文件 |
|---|------|------|
| 4.1 | Memory Strategy 面板增加 Chat Memory 配置区 | `agent/page.tsx` |
| 4.2 | `enableChatMemory` toggle + `chatMemoryMaxTokens` + merge prompt | 同上 |

### Phase 5: Prompt 优化（P2）

| # | 任务 | 文件 |
|---|------|------|
| 5.1 | Compact prompt 增加旧 tool 结果压缩指令 | `compact.ts` |
| 5.2 | ChatMemory 合并去重逻辑（LLM-based） | `compact.ts` / 新 `chat-memory.ts` |
| 5.3 | UserProfile 自动更新（compact 后提取结构化属性） | `compact.ts` |

---

## 验证

1. Phase 0 全局重命名后：typecheck + build 通过，所有测试通过
2. 同一 chatId 多次对话 → ChatMemory.summary 持续累积，不丢失
3. 运营在 Console 点击 "Compact Now" → 立即生成摘要并更新 ChatMemory
4. Agent 调用 `read_chat_memory` → 返回完整画像，新对话有上下文
5. 旧 tool 结果在 N 天后被压缩成一行结论
6. `case_memories` DB 表不动，新 case 不写
