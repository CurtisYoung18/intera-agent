# Chat Memory 重设计 — 修复实施 Plan（含测试验证闭环）

> 日期: 2026-05-29
> 来源: `doc/to-do/2026-05-29-chat-memory-redesign-review.md`（审查发现 C1-C3 / H1-H3 / M1-M4 / L1-L3）
> 读者: 开发。每项含 **改动点(file:line) + 验收闭环(可执行)**。
> 验证基础设施（已具备）：
> - chat 引擎入口 `POST /api/messages`（SSE）
> - Console: `GET /api/chats/[chatId]/memory`、`POST /api/chats/[chatId]/compact`、`GET|PUT /api/users/[userId]/profile`
> - 业务工具测试账号：`https://jayabaji.ai-chat.life/v2/chatbot`，apiKey `G71fGn7G8vb1T2824rr7`，用户 `JAYA113C88F / JAYA114BBAA / JAYA11327F2`
> - 生产库（Railway，DATABASE_URL 在 `.env.local`）可用 node 脚本直连查表
> - 单测：`npx vitest run`

---

## 0. 关键决策（C1 方向）—— 必须先拍板

**问题**：现有 `ChatMemory`（表 `chat_memories`，键 `caseId @unique`，1:1 `Case`）其实是旧 CaseMemory 改名；真正的跨会话累积落在 `UserProfile`（键 `userId`）。

**两条路：**
- (a) 把 ChatMemory 真改成 `chatId @unique`：**不推荐**。per-case 工作记忆（confirmedFacts / todos / skillResults / dashboardVersion / continuationLock）本质就是 per-case，orchestrator、sub-agent、case-continuation worker 全依赖 1:1 Case 关系。改 chatId 风险极高且语义错误。
- (b) **推荐**：承认两层职责分离——
  - **per-case 工作记忆**：保持现状（键 caseId）。为消除误导，**代码/表名维持 `ChatMemory`/`chat_memories` 不再二次迁移**，但所有注释/文档/tool 描述改为「per-case working memory」。
  - **跨会话累积层**：`UserProfile`，但**修复身份键**（见 C2）。
  - 重写 `2026-05-29-user-memory-redesign.md` 使其与现实一致。

> 本 Plan 其余条目按 (b) 展开。若选 (a)，C1 需单列为一个大改造任务（另议），其余条目仍适用。

**验收（决策落地）**：`grep -rn "per-chat\|chatId 累积" packages/shared/prisma/schema.prisma` 注释已更正；redesign 文档顶部加「实现修订记录」说明 ChatMemory=per-case、UserProfile=累积层。

---

## C2 🔴 — 匿名用户共享同一份 UserProfile（隐私/串号）

**根因**：`resolvedUserId = userId || 'anonymous'`（[messages/route.ts:297](apps/chat/app/api/messages/route.ts:297)）；UserProfile 全按 userId 读写。无稳定 userId 的访客共用 `'anonymous'` 一条记录。

**改动**：
1. 新增一个「稳定身份」判定工具函数（建议放 `apps/chat/lib/agent/identity.ts`）：
   ```ts
   // 返回可用于 UserProfile 累积的稳定 key，否则 null（= 不累积）
   export function profileKey(userId?: string, chatId?: string | null): string | null {
     const u = (userId ?? '').trim()
     const isAnon = !u || u === 'anonymous'
     const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u)
     if (!isAnon && !isUuid) return `user:${u}`        // 真实业务 member/userId
     if (chatId && chatId.trim()) return `chat:${chatId.trim()}`  // 退化到会话线程隔离
     return null                                        // 无稳定身份 → 不读不写 profile
   }
   ```
   > 注：UserProfile.userId 现在存的可能是 `user:JAYA…` 或 `chat:<chatId>` 前缀化 key（保持唯一、不串号）。或新增 `profileKey` 列、`userId` 仍存原值——二选一，前者零迁移。
2. `appendToUserProfile`（[loop.ts:1882](apps/chat/lib/agent/loop.ts:1882)）：开头 `const key = profileKey(this.deps.userId, this.deps.chatId); if (!key) return`，用 key 替换所有 `where:{userId}`。
3. 两个读 tool（[loop.ts:1368/1397](apps/chat/lib/agent/loop.ts:1368)）：同样用 key；key 为 null 时返回 `{ profile: null, stats: {...零} }`。
4. 手动 compact 路由（[compact/route.ts:51](apps/console/app/api/chats/[chatId]/compact/route.ts:51)）：用 `profileKey(sampleCase.userId, chatId)`，null 则跳过 profile 写入。

**验收闭环**：
- 单测：`profileKey()` 表驱动用例（真实 id→`user:`、anonymous/UUID→`chat:` 或 null）。
- 集成（两个匿名会话不串号）：
  ```bash
  # 会话A（无 userId，chatId=chatA）触发一次 finalize/compact 后：
  # 会话B（无 userId，chatId=chatB）read_user_profile 不应看到 A 的内容
  node scripts/check.mjs  # 直连库断言 user_profiles 无 'anonymous' 行，且 chat:chatA / chat:chatB 各自独立
  ```
- 库断言脚本：`SELECT "userId", length(profile) FROM user_profiles` —— 不应再出现 `anonymous`。

---

## H1 🟠 — 手动 compact 覆盖（而非合并）UserProfile

**根因**：[compact/route.ts:63-67](apps/console/app/api/chats/[chatId]/compact/route.ts:63) `update: { profile: summary }` 清空旧画像。

**改动**：抽一个共享合并函数（与 C2/H3 统一），手动 compact 与 `appendToUserProfile` 都调它：
```ts
// packages/shared 或 chat lib：mergeProfile(oldProfile, newSummary, maxTokens) → string
// 读旧 → 追加带日期段落 → 按段落边界截断到上限（不从字符中间截）
```
compact 路由改为：`const old = (await prisma.userProfile.findUnique(...))?.profile ?? ''; const merged = mergeProfile(old, summary, maxTokens); upsert({ update: { profile: merged, ... } })`。

**验收闭环**：
```bash
# 同一 chatId 连续点两次 compact，第二次后 profile 必须仍包含第一次的内容
curl -XPOST localhost:3000/api/chats/<chatId>/compact   # 第一次
# 库里记下 profile 片段标记
curl -XPOST localhost:3000/api/chats/<chatId>/compact   # 第二次
# 断言：GET /api/users/<key>/profile 的 profile 同时含两次的日期段落
```
- 单测：`mergeProfile('## A...', 'B...', 4000)` 结果同时含 A、B；超限时按段落裁剪、不破坏 Markdown。

---

## H2 🟠 — Console 跨 app import chat 源码（构建/运行隐患）

**根因**：[compact/route.ts:5](apps/console/app/api/chats/[chatId]/compact/route.ts:5) `import { compactConversation } from '@/../chat/lib/agent/compact'`（全仓唯一）。

**改动**：把 compact 能力抽到共享层：
1. 新建 `packages/shared/memory/compact.ts`（或现有 shared 子目录），把 `compactConversation` 及其纯依赖迁入；chat 端 `apps/chat/lib/agent/compact.ts` 改为从 shared re-export（保持现有 import 不破）。
   - 注意剥离对 `apps/chat` 内部模块（provider-config 等）的耦合：compact 需要的 LLM client 以参数/注入方式传入，或在 shared 里走通用 provider 配置。
2. Console 路由改 `import { compactConversation } from '@intera/shared/memory/compact'`。

**验收闭环（必须真实 build，不能只 tsc）**：
```bash
npm run build -w apps/console        # 必须成功，且不把 chat 端 server-only 依赖打崩
npm run build -w apps/chat
# 部署后实测：
curl -XPOST https://<console-host>/api/chats/<chatId>/compact   # 返回 200 + summary
```
- 若暂不抽共享：**至少**在 Console 真实 `next build` 通过 + 该路由线上能跑，否则视为未完成。

---

## H3 🟠 — UserProfile 合并是裸拼接+字符截断（非 plan 的 LLM 去重）

**根因**：[loop.ts:1890-1894](apps/chat/lib/agent/loop.ts:1890) `slice(0, maxTokens*4)` 硬截断。

**改动（二选一，按产品预期定）**：
- **v1（低成本，推荐先做）**：`mergeProfile`（见 H1）按**段落边界**截断 + 同 key 事实去重（保留最新日期段，丢最老段直到 token 上限）。文档标注「LLM 去重为后续迭代」。
- **v2（按 plan §5.2）**：合并时调一次 LLM（用 vendor 的 compactModel + `chatMemoryMergePrompt`）做语义去重/分级压缩（>7天 tool 结果只留结论、>30天只留 skill 名）。

**验收闭环**：
- 构造一条很长的旧 profile + 新 summary（含重复事实），跑 `mergeProfile`/LLM 合并，断言：① 结果 ≤ `chatMemoryMaxTokens`（用真实 token 估算，见 M3）；② 重复事实只剩最新值；③ 不从段落中间截断。
- 真实估算：用仓库已有 token 估算工具对结果计数。

---

## C3 🔴（文档/数据）— `case_memories` 已删，与 plan 矛盾

**现状**：生产库 `case_memories` MISSING、`chat_memories` 存在。无 model 映射旧表，"兼容读取" 不可行，旧数据已丢。

**改动**：
1. 重写 redesign 文档 §"CaseMemory 旧表→退休"：改为「`case_memories` 已随 `@@map` 迁移为 `chat_memories`，旧数据未保留（仅测试数据）」。
2. 全仓搜索是否仍有代码假设 `case_memories` 存在 / 期望兼容读取：
   ```bash
   grep -rn "case_memories\|caseMemory" apps packages --include=*.ts | grep -v ".next"
   ```
   有则清理（应已无，确认即可）。

**验收闭环**：
```bash
node -e '...'  # 断言生产库存在 chat_memories、user_profiles；无代码引用 case_memories
grep -rn "case_memories" apps packages --include=*.ts | grep -v ".next"   # 期望空
```

---

## M1 🟡 — `read_chat_memory` 与 `read_user_profile` 语义重叠

**改动**：合并为单一 tool 或明确分工。推荐保留 **`read_user_profile`**（跨会话画像）；把 `read_chat_memory` 改为只返回**当前 case 工作记忆**（confirmedFacts/keyEvents/summary，不含 profile），或直接移除（信息已在 system prompt）。同步 [skills.ts:93](apps/chat/lib/agent/skills.ts:93) 的 description 与 [loop.ts:1363-1418](apps/chat/lib/agent/loop.ts:1363) 的实现、CORE/CASE 默认 prompt 里的工具引用。

**验收闭环**：
- 单测：两 tool 返回结构无重叠字段。
- 集成：`/api/messages` 跑一轮触发该 tool，trace 里 `Tool read_*_memory result:` 内容符合新契约。

## M2 🟡 — 手动 compact 忽略 vendor 配置

**改动**：[compact/route.ts:41](apps/console/app/api/chats/[chatId]/compact/route.ts:41) 按 chatId→case→vendorId 加载该 vendor 的 `agentConfig.memoryStrategy`，替代 `DEFAULT_MEMORY_STRATEGY`。
**验收**：对一个改过 memoryStrategy.compactModel 的 vendor 触发 compact，返回的 `compactModel` 应为该 vendor 配置值。

## M3 🟡 — "tokens" 实为字符数

**改动**：compact 路由 `beforeTokens/afterTokens`（[compact/route.ts:37/71](apps/console/app/api/chats/[chatId]/compact/route.ts:37)）改用仓库 token 估算工具；或前端字段改名 `beforeChars/afterChars`。
**验收**：返回值与 token 估算工具结果一致（±10%）。

## M4 🟡 — UserProfile 统计字段维护不全

**根因**：update 只更 totalCases/resolvedCases/lastSeenAt（[loop.ts:1913](apps/chat/lib/agent/loop.ts:1913)）；totalChats/escalatedCases/lastCaseType/firstSeenAt 不更新。
**改动**：抽 `recomputeProfileStats(key)`——一次性按 key 聚合所有相关 case/chat 算出全部 stats，append/compact 两处都调用它写回。
**验收**：
```bash
# 造 3 个 case（2 resolved /1 escalated）同一身份 → 触发 → 断言
GET /api/users/<key>/profile  →  totalCases=3, resolvedCases=2, escalatedCases=1, lastCaseType 正确
```

## L1-L3 🟢 — 文档/注释同步

- L1 [schema.prisma:219](packages/shared/prisma/schema.prisma:219) 注释「per-chat」→「per-case working memory」。
- L2 redesign 文档 read_chat_memory「chatId from ToolContext」→ 实际按 profileKey 读 UserProfile。
- L3 [skills.ts:93](apps/chat/lib/agent/skills.ts:93) description 与新契约（M1）对齐。
**验收**：文档/注释与代码一致，无残留误导描述。

---

## 端到端验收场景（全部修完后跑一遍）

> 目标：同一真实用户跨多个 case/会话，画像正确累积、不串号、可读可压缩。

1. **准备**：选测试用户 `JAYA11327F2`（真实 member_id，非匿名）。
2. **第 1 个 case**：`POST /api/messages`（userId=JAYA11327F2, chatId=chatX, message="存款没到账"）→ 走到 finalize/resolved。
   - 断言：`user_profiles` 出现 key=`user:JAYA11327F2` 一行，profile 非空，totalCases≥1。
3. **第 2 个 case（同用户同 chat）**：再 `POST /api/messages` 新问题 → finalize。
   - 断言：profile **累积**（含两段日期），未被覆盖；totalCases=2。
4. **read 验证**：第 3 轮里让 agent 调 `read_user_profile` → trace 里返回完整画像 + 正确 stats。
5. **匿名隔离**：userId 缺省 + chatId=chatY 跑一轮 → 断言不写入 `user:` / `anonymous`，仅 `chat:chatY`（或不写）；且读不到 JAYA 的画像。
6. **运营手动 compact**：`POST /api/chats/chatX/compact` → 返回 summary + 真实 token 数；再查 profile 仍含历史（H1）。
7. **构建**：`npm run build -w apps/console && npm run build -w apps/chat` 均成功（H2）。
8. **回归**：`npx vitest run` 全绿；`tsc --noEmit`（chat+console）clean。

**库断言脚本骨架**（直连 Railway，只读）：
```js
import { readFileSync } from 'node:fs'
process.env.DATABASE_URL = readFileSync('.env.local','utf8').match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1]
const { PrismaClient } = await import('./node_modules/@prisma/client/index.js')
const p = new PrismaClient()
console.log(await p.$queryRawUnsafe(`SELECT "userId", length(profile) chars, "totalCases","resolvedCases","escalatedCases" FROM user_profiles ORDER BY "updatedAt" DESC LIMIT 20`))
```

---

## 实施顺序与依赖

1. **决策 C1（方向 b）** → 定调，解锁文档类条目（C3/L1-L3）。
2. **共享合并函数 `mergeProfile` + `recomputeProfileStats`**（H1/H3/M4 的公共底座）先写好。
3. **C2（profileKey）** → 改 append/读 tool/compact 路由的身份键（依赖 mergeProfile 已就位）。
4. **H2（抽共享 compact）** → 解除跨 app import；与 M2 一起改 compact 路由。
5. **M1（tool 合并）/M3（token 计量）** 独立小改。
6. 全部完成 → 跑「端到端验收场景」+ 回归。

> 优先级：C2 + H1 会直接产生线上错误数据，最高优先；H2 是 Console 部署阻断项，部署前必须验证。
