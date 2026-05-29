# Chat Memory 重设计 — 代码审查（2026-05-29）

> 审查对象：`doc/to-do/2026-05-29-user-memory-redesign.md` 的实现（commits `c6d8c98` Phase 0-2 + `a3e3ec1` Phase 3-4）。
> 方法：对照 plan 逐项核对代码 + 生产库实际状态。结论：**核心数据模型与 plan 严重背离**，且存在隐私/数据正确性漏洞。下面按严重度排序。

---

## 🔴 Critical

### C1 — "ChatMemory" 根本没有按 chatId 重构，只是把 CaseMemory 改了个名

Plan 的核心前提是 `ChatMemory 1:1 chatId，跨 case 累积`。但实现里：
- `model ChatMemory` 仍是 **`caseId String @unique` + `case Case @relation`**（[schema.prisma:221-246](packages/shared/prisma/schema.prisma:221)）——和旧 CaseMemory 字段**完全一致**，只是 `@@map` 改成 `chat_memories`、类名改成 ChatMemory。
- `ChatMemoryManager` 构造仍传 `caseId`（[loop.ts:176](apps/chat/lib/agent/loop.ts:176) `new ChatMemoryManager(deps.caseId, …)`），内存里依然 **per-case**。
- 全部 `prisma.chatMemory` 调用都是 `where: { caseId }`（route/orchestrator/worker/console 共 ~15 处）。

**真正承载"跨会话累积"的是另起的 `UserProfile`（per `userId`）**，不是 ChatMemory。即 plan 描述的 chatId 维度累积**未实现**，被 userId 维度的 UserProfile 替代了。

**后果**：文档与代码南辕北辙；"Chat Memory" 是误称（实为 Case Memory）；后续维护者会被彻底误导。
**建议**：二选一并让文档与代码一致——
- (a) 真按 plan：ChatMemory 改 `chatId @unique`、manager 传 chatId、所有 `where` 改 chatId；或
- (b) 承认实际架构：把 model/类名改回 `CaseMemory`，明确 **UserProfile(per userId) 才是累积层**，重写 redesign 文档。

### C2 — 匿名用户共享同一份 UserProfile（隐私 + 正确性）

`resolvedUserId = userId || 'anonymous'`（[messages/route.ts:297](apps/chat/app/api/messages/route.ts:297)）。`appendToUserProfile` / `read_user_profile` / `read_chat_memory` 全部按 `userId` 读写 UserProfile（[loop.ts:1368/1397/1885/1902](apps/chat/lib/agent/loop.ts:1368)）。

→ **所有没有稳定 userId 的访客（web chat 未登录等）都落到 `userId='anonymous'`，共用一条 UserProfile**：A 用户的画像/历史会被 append 进去，又被 B 用户的 `read_user_profile` 读出来 → **跨用户数据串号 + 隐私泄露**。
LiveChat 场景 userId=访客 UUID（见 BUG-G），跨 session 是否稳定也需确认；不稳定则根本累积不起来。

**建议**：userId 为空/anonymous/UUID-不稳定时，**不读不写 UserProfile**（或退化为按 chatId 隔离）。给 `appendToUserProfile` 和两个读 tool 加 guard。

### C3 — `case_memories` 表已被删除，与 plan「保留旧表兼容读取」矛盾，旧数据丢失

生产库实测：`case_memories` → **MISSING**；`chat_memories` → 存在(1 行)；`user_profiles` → 存在(0 行)。
`@@map` 从 `case_memories` 改到 `chat_memories` 后 `db push` 把旧表丢了。而 plan §"CaseMemory 旧表→退休" 明说「表保留不删，旧数据仅在 `/api/cases/[id]` 兼容读取」——但现在**没有任何 model 映射 case_memories**，兼容读取无从谈起，旧数据也没了。
**建议**：确认旧数据是否需要（此阶段大概率只是测试数据，可接受）；同时把 plan 的该段改成与现实一致，避免误导后续迁移。

---

## 🟠 High

### H1 — 运营手动 compact 会「覆盖」而非「合并」UserProfile

[chats/[chatId]/compact/route.ts:63-67](apps/console/app/api/chats/[chatId]/compact/route.ts:63) 的 `update: { profile: summary }` **直接用本次摘要覆盖整条 profile**，丢弃此前累积的全部内容。与 `appendToUserProfile`（追加）行为相反，也违背"累积"目标。运营点一次 Compact 就把历史画像清空了。
**建议**：改为读出旧 profile 后追加/合并（与 `appendToUserProfile` 统一逻辑，最好抽成一个共享函数）。

### H2 — Console 跨 app 直接 import chat app 源码（构建/运行隐患）

[compact/route.ts:5](apps/console/app/api/chats/[chatId]/compact/route.ts:5) `import { compactConversation } from '@/../chat/lib/agent/compact'` —— Console 用 `@/..` 别名**伸进 sibling app（apps/chat）的源码**。这是全仓库唯一一处这种跨 app 源码 import。`compact.ts` 会连带拉入 provider-config、anthropic SDK 等 chat 端服务依赖进 Console 构建。
typecheck 能过不代表 Next 生产构建/运行没问题。**建议**：把 `compactConversation` 抽到 `packages/shared`（或独立 package）供两端共享；务必在真实 `next build` Console 后验证该路由能跑。

### H3 — UserProfile 合并是「裸拼接 + 字符截断」，非 plan 的 LLM 去重

[loop.ts:1890-1894](apps/chat/lib/agent/loop.ts:1890)：`newProfile = existing.profile.slice(0, maxTokens*4) + header + summary.slice(0, maxTokens*2)`。每次 compact 追加一个带日期的段落，旧内容按**字符数**硬截断（可能从中间截断 Markdown）。Plan §5.2「LLM 判断重复并压缩」、§Compact Prompt 优化（按 7天/30天分级压缩 tool 结果）**均未实现**。
**建议**：明确这是 v1 的简化（可接受就更新文档），或补 LLM 合并；至少按段落边界截断而非字符。

---

## 🟡 Medium

### M1 — 两个语义重叠的 tool：`read_chat_memory` 与 `read_user_profile`
两者都返回 `profile + stats`（[loop.ts:1363-1418](apps/chat/lib/agent/loop.ts:1363)）。`read_chat_memory` 名为"chat"实则返回 **per-case 的 chatMemory + userProfile**，与 `read_user_profile` 大量重叠。对模型是噪音，易选错。**建议**：合并成一个，或明确各自边界与命名。

### M2 — 手动 compact 用 `DEFAULT_MEMORY_STRATEGY`，忽略该 vendor 实际配置
[compact/route.ts:41](apps/console/app/api/chats/[chatId]/compact/route.ts:41)。运营手动 compact 用的 model/prompt 与运行时（vendor 配置）不一致。**建议**：按 chatId→vendor 加载该 vendor 的 memoryStrategy。

### M3 — "tokens" 实为字符数
compact 路由 `beforeTokens = Σ content.length`、`afterTokens = summary.length`（[route.ts:37/71](apps/console/app/api/chats/[chatId]/compact/route.ts:37)）。UI 显示 "12K→2K tokens" 实际是字符。**建议**：改名为 chars 或用真实 token 估算（仓库已有 token 估算工具）。

### M4 — UserProfile 统计字段维护不全
`appendToUserProfile` 的 update 只更 `totalCases/resolvedCases/lastSeenAt`（[loop.ts:1913-1918](apps/chat/lib/agent/loop.ts:1913)），**不更 `totalChats`(create 写死 1)、`escalatedCases`、`lastCaseType`、`firstSeenAt`**；手动 compact 路由又只写 totalCases。→ UserProfile 的多个统计长期不准，而 UI/read tool 会展示它们。**建议**：统一在一处聚合计算所有 stats。

---

## 🟢 Low / 文档同步

- L1 — schema 注释「accumulated per-chat」与实际 per-case 矛盾（[schema.prisma:219](packages/shared/prisma/schema.prisma:219)）。
- L2 — plan §read_chat_memory 说「chatId 从 ToolContext 自动获取」，实现实际用 `this.deps.userId` 读 UserProfile，ToolContext.chatId 没用上；文档过时。
- L3 — `read_chat_memory` 的 description（[skills.ts:93](apps/chat/lib/agent/skills.ts:93)）宣称"accumulated memory for the current chat"，与其实际返回内容（per-case + userProfile）不符。

---

## 验证状态
- 当前仓库 `tsc --noEmit`（chat + console）通过；agent + livechat 单测 158/158 通过（含我叠加的 coreSystemPrompt 改动）。
- 生产库表：`case_memories` 缺失、`chat_memories`(1)、`user_profiles`(0)。`user_profiles` 0 行属正常（compaction 需 token 阈值/finalize 才触发，部署后暂无真实流量）。
- **未做**：真实 `next build`（H2 的构建风险需此验证）、端到端跑一次"同用户多 case → UserProfile 累积/读取"。

## 优先级建议
先定 **C1**（要么真按 chatId 重构、要么改回 CaseMemory 并重写文档）——它决定其余项的走向。**C2（匿名串号）** 和 **H1（覆盖 profile）** 是会直接造成线上错误数据的，应紧随其后修。H2 在 Console 部署前必须验证。
