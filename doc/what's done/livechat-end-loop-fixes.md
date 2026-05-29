# LiveChat "莫名其妙 end loop" — 根因与修复方案

> 目标读者：开发同学。基于 **2026-05-28 对 `api` vendor 真实对话日志 + 代码** 的排查。
> 一句话结论：**agent loop 本身没异常退出(日志里全是正常的 `Exit: no tools called`)。问题在 session/并发层 —— 同一个 chat 复用一个 `caseId`,但并发护栏从第 2 条消息起就失效了,导致消息被丢、被合并、或被并行 loop 重复处理。**

---

## 0. TL;DR — 按优先级落地

| 优先级 | 问题 | 关键文件 | 性质 |
|--------|------|----------|------|
| **P0-1** | session `resolved` 闩锁复用后不重置 → 第 2 条消息起并发护栏 + 队列 drain 双双失效 | [session-store.ts:212](apps/chat/lib/agent/session-store.ts:212) / [route.ts:754](apps/chat/app/api/messages/route.ts:754) | ✅代码确认,修复最小最关键 |
| **P0-2** | 入队消息在 loop 退出前漏 drain → 永久孤儿(消息无回复) | [loop.ts:307-331](apps/chat/lib/agent/loop.ts:307) | ✅代码确认,需配合 P0-1 |
| **P1-3** | 共享 DB `textBuffer` + 每个 message_stop 都 flush → 并发丢/串回复 | [livechat/session-store.ts:82](apps/chat/lib/livechat/session-store.ts:82) / [renderer.ts:155](apps/chat/channels/livechat/renderer.ts:155) | ✅代码确认,P0-1 修好后大幅缓解 |
| **P1-4** | 任意 `escalated`(含瞬时 LLM 错误)→ 永久 `transferred` → 之后所有消息被无视 | [loop.ts:528-545](apps/chat/lib/agent/loop.ts:528) / [bridge.ts:163](apps/chat/lib/livechat/bridge.ts:163) | ✅代码确认 |
| **P2** | `Case` upsert 没写 `chatId` / bridge 无快速连发串行化 / `get_current_time` 工具一直失败 | 见 §6 | 次要/独立 |

> **P0-1 是基石**：它修好后,同一 chat 的并发消息会正确入队进**同一个** loop(而不是起并行 loop),P1-3 的 buffer 争用也随之大幅消失。建议先做 P0-1。

---

## 1. 链路回顾

```
LiveChat webhook
  → handleIncomingEvent (bridge.ts)        // 取/建 bridge session(DB: external_conversations),置 state=thinking
    → POST /api/messages (一次性 SSE)        // 并发护栏 hasSession + 队列
      → AgentLoop.run()                      // ReAct loop,流式 text_delta / tool / message_stop
        → renderer.render(sseEvent)          // SSE 事件 → BridgeAction
          → buffer_text → flush_text → sendTextMessage   // 文本累加进 DB textBuffer,message_stop 时 flush 回发
```

关键事实：**一个 LiveChat chat 全程复用同一个 `caseId`**(bridge session 里 `generateCaseId()` 只在首次建会话时生成一次)。所有后续消息都打到同一个 `caseId`。

---

## 2. 日志实锤(customer `api`)

- `fea2de7f`：连发 `今天几号` → `今天几号呢`,**第一条没回复**,客户才重问 → 两问只得一个合并回复。
- `a622505b`：`官网在哪` → `你们官网在哪`(第一条被丢);整段会话**最后停在用户消息 `JAYA114BBAA`,bot 再没回**;回复还经常**错位一轮**(问"官网"答"游戏",问"bet history"答"存款方式")。
- `a624f8c4`：出现 `[POLICY] conflict_requires_human` 升级路径。
- 统计：抽样 8 个 case，1 个停在未回复的用户消息上，多个有"重问"模式 —— 丢消息的典型信号。
- 排除项：所有 loop 退出都是正常的 `Exit: no tools called`，**没有** max_nudges / 异常退出；时间线显示这些会话是**串行**的(消息间隔 30s~13min)。所以问题不在 agent 决策,而在 session 层。

---

## 3. 根因详解

### P0-1 — `resolved` 闩锁复用后不重置 ✅

- `hasSession()` 在 `resolved=true` 时返回 `false`（[session-store.ts:212-215](apps/chat/lib/agent/session-store.ts:212)）。新加的单测还把这个状态锁成了"预期"（[session-store.test.ts:39-47](apps/chat/lib/agent/__tests__/unit/session-store.test.ts:39)）。
- 第 1 条消息 run 完置 `activeSession.resolved = true`（[route.ts:802](apps/chat/app/api/messages/route.ts:802)），**session 对象不删除**，留在 map 里。
- 第 2 条消息（同 `caseId`）：`getOrCreateSession` 拿回旧 session，但**没有把 `resolved` 重置为 `false`**（[route.ts:754](apps/chat/app/api/messages/route.ts:754)）。
- 于是第 2 条之后,运行中的 loop `hasSession` 恒为 `false`，导致：
  - **并发护栏失效**：后续并发消息在 [route.ts:737](apps/chat/app/api/messages/route.ts:737) 不入队 → **直接再起一个并行 loop 跑同一个 caseId** → 回复重复/错位、case memory 互相覆盖（这就是日志里"回复错位一轮"的来源）。
  - **队列 drain 失效**：loop 顶部的 dequeue 被 `hasSession` 门控（[loop.ts:310](apps/chat/lib/agent/loop.ts:310)）→ 即使有消息入队也永不消费。

### P0-2 — 入队消息在 loop 退出前漏 drain ✅

- loop 只在**每轮迭代开头**取队列（[loop.ts:307-331](apps/chat/lib/agent/loop.ts:307)）。最后一轮 drain 之后、`return` 之前到达的入队消息,没有"退出前再 drain"兜底 → 永久卡在死 session 的队列里(直到 30min TTL 清除)。**客户那条消息彻底没回复。**
- 设计割裂：队列原本是为**常驻 SSE session loop**(`/api/cases/[id]/stream` 里用阻塞式 `dequeue()` 持续等待)设计的；但 LiveChat 走的是一次性的 `/api/messages`,没有那个常驻消费者,只能靠"迭代顶部顺手 drain",天然有退出竞态。

### P1-3 — 共享 DB `textBuffer` + 每个 message_stop 都 flush ✅

- 流式文本累加进 `external_conversations.textBuffer`(DB 列,**按 chatId 共享**)（[livechat/session-store.ts:82-121](apps/chat/lib/livechat/session-store.ts:82)）；renderer 对**每个** `message_stop` 都发 `flush_text`（[renderer.ts:155-157](apps/chat/channels/livechat/renderer.ts:155)）。
- 同一 chat 的两个并发 webhook（由 P0-1 产生的并行 loop）会往同一个 buffer 追加、互相 flush：`flushTextBuffer` 用 `FOR UPDATE` 原子取走全部,先 flush 的人拿到两段串在一起的文本,**后 flush 的拿到空串 → 那条回复彻底丢失**。
- 附带：每轮有**两个** message_stop 到 bridge（loop 内 [loop.ts:1025](apps/chat/lib/agent/loop.ts:1025) 一个 + route 收尾 [route.ts:886](apps/chat/app/api/messages/route.ts:886) 一个）,目前靠 flush 幂等(第二次 buffer 已空)扛着,较脆。case 模式下还有 nudge/stage_transition 的中间 message_stop,会把一条回复从中间切断分两条发。

### P1-4 — 瞬时错误也会永久 transfer ✅

- `escalated` 事件 → renderer 转 `transfer_chat`（[renderer.ts:131-133](apps/chat/channels/livechat/renderer.ts:131)）→ bridge 置 `transferred`（[bridge.ts:273-282](apps/chat/lib/livechat/bridge.ts:273)）→ 之后 `handleIncomingEvent` 对该 chat 直接 return（[bridge.ts:163-166](apps/chat/lib/livechat/bridge.ts:163)）,**bot 永久不再应答**。
- 但 `escalated` 不只在"真需要人工"时触发,**瞬时 LLM API 错误 / fallback 耗尽也会触发**（[loop.ts:528-545](apps/chat/lib/agent/loop.ts:528)）。一次模型抖动 → chat 被永久判给人工。`a624f8c4` 的 policy 升级也是这条路径。

---

## 4. 修复方案(代码级)

### P0-1（基石，最小改动）

复用 session 起新 loop 时重置闩锁。在 [route.ts:754](apps/chat/app/api/messages/route.ts:754)：

```ts
// 复用旧 session 时,prior turn 的 resolved 闩锁必须清掉,否则本轮 run 期间
// hasSession 恒为 false → 并发护栏与队列 drain 双双失效(见 doc/to-do/livechat-end-loop-fixes.md §3 P0-1)。
const activeSession = getOrCreateSession(resolvedCaseId)
activeSession.resolved = false
activeSession.aborted = false
activeSession.lastActiveAt = Date.now()
```

> 在**调用点**重置(而不是改 `getOrCreateSession` 内部),避免影响常驻 SSE stream 路径(`/api/cases/[id]/stream`)的生命周期。
> 更稳健的重构(可选,后续做)：把"loop 是否在跑"用独立的 `active` 标志表示,在 loop 开始置 true、结束置 false,`hasSession`/护栏/dequeue 全部基于 `active`,语义比一次性的 `resolved` 闩锁清晰。

### P0-2（退出前 drain 兜底）

P0-1 修好后,本轮 run 期间 `hasSession=true`,并发消息会正确入队并被迭代顶部 drain 消费。残留竞态是"最后一轮之后到达"的消息。两个方案：

- **务实兜底**：`run()` 返回后、标记 resolved 前,把队列剩余消息接着跑完。注意 `AgentLoop.iterationCount` 是实例字段、不会自动重置,直接复用同实例二次 `run()` 会立刻撞 `maxIterations` —— 需要给每条 drain 出来的消息**新建一个 AgentLoop 实例**(或暴露一个重置 iterationCount 的入口)。示意（在 [route.ts:799-802](apps/chat/app/api/messages/route.ts:799) 附近）：

```ts
let result = await agentLoop.run(userMessage, sendEvent, formAnswers, contentBlocks)
// P0-2: 消费 loop 退出后才到达、漏 drain 的入队消息
while (activeSession.queue.pendingCount > 0) {
  const next = activeSession.queue.dequeueNonBlocking()
  if (!next || next.content === '__SESSION_CLOSED__') break
  const followup = await AgentLoop.create({ /* 同上 deps */ })
  // 注意:需重新从 DB 载入 messages/memory(同首次),否则丢上下文
  result = await followup.run(next.content, sendEvent, next.formAnswers, next.contentBlocks)
}
activeSession.resolved = true
```

- **正解(推荐中期)**：让 LiveChat 也走**常驻 SSE session loop**(`/api/cases/[id]/stream` + `/api/cases/[id]/message`),用阻塞式 `dequeue()` 持续消费,从根上消除"一次性 run + 顶部 drain"的退出竞态。改动较大,建议单独排期。

### P1-3（buffer 隔离 / flush 收敛）

- P0-1 修好后并行 loop 消失,同一 chat 同时只有一个 loop 在 buffer,争用基本消除。**先验证 P0-1 是否已解决,再决定是否加固。**
- 若要加固：给 `textBuffer` 按"本轮 run"隔离(例如 flush 时带一个 run/turn token,只取本轮追加的部分),或改成 renderer 端内存缓冲、不落 DB 共享列。
- 顺手收敛 message_stop：route 收尾的那个 message_stop（[route.ts:886](apps/chat/app/api/messages/route.ts:886)）与 loop 内的（[loop.ts:1025](apps/chat/lib/agent/loop.ts:1025)）语义重复,建议明确只在"真正一轮结束"flush 一次。

### P1-4（区分瞬时错误与真升级）

- 瞬时基础设施错误(LLM API error / fallback 耗尽,[loop.ts:528-545](apps/chat/lib/agent/loop.ts:528))**不应**发 `escalated`/触发 transfer。改为发 `error` + 给客户一句"系统繁忙,请稍后重发",**保持 session 非 transferred**,让客户可重试(或入 retry 队列)。
- 只有**刻意的人工交接**(max_nudges、policy `conflict_requires_human`、finalize→human)才走 `escalated` → transfer。
- 可在 `escalated` 事件里带 `reason` 分类,renderer 仅对"真升级"reason 转 `transfer_chat`（[renderer.ts:131](apps/chat/channels/livechat/renderer.ts:131)）。
- (低优)即便真 transfer,bridge 永久无视后续消息（[bridge.ts:163](apps/chat/lib/livechat/bridge.ts:163)）也值得加个"长时间无人工接入则回切 bot / 提示"的兜底。

---

## 5. "回复错位一轮"是 P0-1 的下游症状(诚实标注)

日志里"问官网答游戏、问 bet history 答存款"这类错位,**最可能**是 P0-1 的并行 loop 同时读同一份 DB 历史、又 last-write-wins 互相覆盖 case memory + 交叉持久化消息导致的历史错乱。但也**不能完全排除模型质量**(MiniMax 对该场景的理解 + KB 缺官网信息)。建议 P0-1 修好后复测同样的对话序列,确认错位是否消失,再判断是否还有模型侧问题。

---

## 6. P2(次要/独立)

- **`Case` 没存 `chatId`**：[route.ts:631-641](apps/chat/app/api/messages/route.ts:631) 的 upsert create 块没带 `chatId`,导致 LiveChat case 的 `chatId` 为 null,console ops 无法按 chat 归集会话。create 时补上 `chatId: chatId ?? null`。
- **bridge 层无快速连发串行化**：[handleIncomingEvent](apps/chat/lib/livechat/bridge.ts:120) 不因 `state==='thinking'` 串行化,完全依赖 `/api/messages` 护栏。P0-1 修好后护栏可靠,通常够用;若仍有抖动,可在 bridge 对同 chat 加轻量串行(thinking 时短暂等待/合并)。
- **`get_current_time` 一直 `ok:false`**:还把日期答成 2025-05-13(实际 2026-05-28),并触发重试风暴(`9a390e44` 连试 8 次)。独立工具 bug,单独查。
- **`thinking` 卡死**:DB 里看到 9 个 session 卡在 `thinking`,均为 `default` 客户的测试数据(case-1/2/3),非生产;但建议确认生产 `thinking` 在任何异常路径下都会经 bridge 的 `finally`（[bridge.ts:333-337](apps/chat/lib/livechat/bridge.ts:333)）复位。

---

## 7. 验收/验证

1. **单测**：补 session-store 测试 —— "session resolved 后再 `getOrCreateSession` + 重置,`hasSession` 应恢复为 true";现有的 [session-store.test.ts:39](apps/chat/lib/agent/__tests__/unit/session-store.test.ts:39) 锁的是 buggy 状态,P0-1 落地后需相应更新该用例语义。
2. **并发集成测试**：对同一 `caseId` 在极短间隔内连发 2~3 条 `/api/messages`,断言：(a) 不产生并行 loop(同一时刻只有一个 run);(b) 每条用户消息最终都有对应回复(无孤儿、无丢失)。
3. **回归真实序列**：用 §2 里 `a622505b` / `fea2de7f` 的消息序列重放,确认不再出现"重问/无回复/错位一轮"。
4. **P1-4**：模拟 LLM API 瞬时错误,断言 chat **不被** transfer、session 仍可继续对话。

> 说明：本次排查覆盖的是 `vector/match` 之外的 LiveChat 链路;抽样的真实对话偏串行,P0 类 bug 在**快速连发**下最易触发(客服场景极常见)。并发竞态类问题建议以集成测试固化,而非只靠人工复现。
