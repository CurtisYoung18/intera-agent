# LiveChat Widget — 代码核对发现的 Bug（2026-05-29）

> 目标读者：开发同学。来源：对照 `doc/to-do/2026-05-29-livechat-widget-test-flow.md` 逐条核对最新代码。
> 已确认到位的修复（无需再动）：P0-1 session resolved 复用重置、P0-2 退出后 drain、KB 按 score 重排、KB 默认 BGE/topK15/docCorr0.3、P1-4 瞬时错误不再误转人工、Case 持久化带 chatId。
> 下列为本次**新发现**的 4 个 bug，按严重度排序。

---

## BUG-A（高）— 图片上传：media_type 未校验，非图片/缺类型会让多模态 API 报错

**现象**：上传非图片文件，或 LiveChat 未带 `content_type` 时，Agent 调用多模态 API 报错 / 无法理解。

**根因**：
- webhook 把附件类型透传：`contentType: event.content_type ?? 'application/octet-stream'`（[webhook/[vendorId]/route.ts:126](apps/chat/app/api/livechat/webhook/[vendorId]/route.ts:126)）。
- bridge **无条件**把任意附件包成图片 block：`{ type: 'image', source: { type: 'base64', media_type: event.attachment.contentType, data } }`（[bridge.ts:188-191](apps/chat/lib/livechat/bridge.ts:188)）。
- `downloadAndEncode` 只做下载 + base64，不校验类型（[image-utils.ts:4](apps/chat/lib/livechat/image-utils.ts:4)）。
- 后果：`media_type` 可能是 `application/octet-stream`、`application/pdf` 等非法图片类型，仍以 `type: 'image'` 发给 API → 报错或被拒。

**建议修复**：
- 在 bridge 处理附件前先判定 MIME：仅当 `contentType` 属于 `image/png|jpeg|gif|webp` 才构造 image block；否则降级为文本提示（如"用户上传了一个 <类型> 文件，暂不支持解析"），不要塞进 image source。
- `content_type` 缺失时不要回落 `application/octet-stream` 后当图片用；按"未知类型"走文本降级。
- 可选：`downloadAndEncode` 返回时一并回传响应头里的 `Content-Type`，用它兜底校验真实类型。

**验收**：上传 png/jpg → 正常理解；上传 pdf / 无 content_type → 不报错、给出友好降级文案。

---

## BUG-B（高）— 流建立后 LLM 出错对用户静默（P1-4 修复暴露）

**现象**：SSE 流已开始后，LLM API 报错（重试耗尽 / fallback 耗尽），**LiveChat 用户看不到任何提示**，会话像卡住。

**根因**：
- P1-4 修复后，loop 对瞬时 LLM 错误返回 `transition: 'machine_error'` 并发 `error` SSE（[loop.ts:527-546](apps/chat/lib/agent/loop.ts:527)），不再发 `escalated`（这点是对的，避免了误转人工）。
- 但 **renderer 没有 `error` / `machine_error` 的处理分支**（[renderer.ts:32-170](apps/chat/channels/livechat/renderer.ts:32) 全部 case 里无 `error`）→ 落到 `default: { type: 'noop' }`，什么都不发。
- bridge 的 `for await` 流正常结束 → `streamTruncated=false` → 也**不会**触发 `sendFailureNotice`（[bridge.ts:320-332](apps/chat/lib/livechat/bridge.ts:320)）。
- 净结果：用户既没收到"系统繁忙"，也没被转人工，纯静默。直接违背测试流程 test 10.1 的预期。

**建议修复（二选一或都做）**：
- renderer 增加 `case 'error'`（及 `message_stop` 的 `transition==='machine_error'`）→ 返回 `send_text`：一句"系统繁忙，请稍后重试 / 已为您记录"。
- 或在 bridge 流消费过程中捕获到 `error` 事件时,设标志位 → 流结束后补发 `sendFailureNotice('engine_unreachable')`。

**验收**：模拟流中 LLM 500（重试耗尽），用户能看到一句兜底提示，会话不静默。

---

## BUG-C（中高）— P0-2 drain 的 followup 回复推流但不持久化，并发补充消息会从历史丢失

**现象**：并发场景下，消息 2 若走 P0-2 的"退出后 drain"路径，其回复能发给用户，但下一轮对话时 Agent 看不到这次往返（历史缺失），可能重复提问 / 上下文断裂。

**根因**（[route.ts:810-908](apps/chat/app/api/messages/route.ts:810)）：
- `const result = await agentLoop.run(...)`（810 行，**`const`**）保存的是**首条消息**的结果。
- drain 循环对每条队列消息 `await followup.run(...)`（845 行），但**返回值被丢弃**；`result` 不可被重新赋值。
- 持久化阶段：case memory 读 `agentLoop.getMemorySummary()`（852 行，**master loop**，未含 followup 的记忆变更）；消息持久化用 `result.messages`（908 行，**仅首条 run**）。
- 因此 followup 产生的 assistant 回复**只推流给用户、不写 DB**；followup 的 memory 变更也不落库。
- 附带：followup 在 829 行从 DB 重载历史，但此时首条 run 的消息**尚未持久化**（持久化在 906 行之后），followup 拿到的是**陈旧 transcript**（缺首条回复），仅靠 `loadMemory(master)`（844 行）补 facts，transcript 与 memory 状态不一致。

**建议修复**：
- 把每个 followup 的 `result` 纳入持久化：用最后一次 run 的 `result`（或累计所有 run 的 messages）来写 DB；memory 用最后运行的那个 loop 的 `getMemorySummary()`。
- 更稳妥：drain 不另起新 AgentLoop 实例（避免 iterationCount / 历史重载的割裂），而是复用同一 loop 持续消费队列——这与 end-loop-fixes 文档里建议的"LiveChat 改走常驻 SSE session loop"是同一方向，可一并排期。
- 在修好前，至少保证 followup 的回复消息也被 upsert 进 `messages` 表。

**验收**：构造"消息 2 在最后一轮 drain 后到达"，处理完刷新会话；DB `messages` 表应包含消息 2 的用户消息**与** Agent 回复；下一轮对话 Agent 能引用到该补充信息。

---

## BUG-D（低）— bridge 里 `response.status === 202` 是死分支

**现象**：无功能影响，但有误导（测试流程 test 8.2 原文也据此写了"返回 HTTP 202"，已在该文档修正）。

**根因**：
- `/api/messages` 在并发排队时返回的是 **200 的 SSE 流**（含 `withheld` + `message_stop{reason:queued}`），从不返回 202（[route.ts:745-758](apps/chat/app/api/messages/route.ts:745)；744 行注释里的"return 202"与实现不符）。
- bridge 的 `if (response.status === 202)`（[bridge.ts:218](apps/chat/lib/livechat/bridge.ts:218)）位于 `if (!response.ok || !response.body)` 之内，而排队响应 `response.ok===true` 且有 body，**永远进不到这里** → 死代码。排队消息实际是靠 SSE 里的 `message_stop{reason:queued}` 流过 renderer（`flush_text` 空 buffer → 不发消息）来"消化"的。

**建议修复（清理性）**：
- 二选一：① 让 route 在排队时真的返回 `202`（无 body），bridge 现有分支即生效，语义更清晰；② 或删掉 bridge 的 202 死分支 + 改 route.ts:744 注释，明确排队走 SSE `reason:queued`。
- 注意若改成真 202，要确认 bridge 不会因 `!response.body` 误报失败、也不会重复发欢迎/失败提示。

**验收**：并发排队时不产生重复输出 / 误报失败；代码与注释一致。

---

## BUG-E（高）— close→reopen 后顾客第一句话被丢弃，只回硬编码欢迎语

**现象**：每次关闭再打开 LiveChat Widget，顾客发的**第一句话得不到 Intera 响应**，widget 里只出现硬编码的
"您好，我是智能客服，请描述您遇到的问题～"。第二句起才正常。

**根因**：
- LiveChat Platform API 的事件分发规律：**新会话开启时，顾客的第一条消息是随 `incoming_chat` 事件一起下发的**，消息体在 `payload.chat.thread.events[]` 里；只有**后续**消息才作为独立的 `incoming_event`(type:`message`) 下发。
- 当前两个 webhook 路由对 `incoming_chat` **只发欢迎语、完全不解析 `payload.chat.thread.events`**，于是顾客随首次开聊带来的第一句话被直接丢弃：
  - [webhook/[vendorId]/route.ts:155-163](apps/chat/app/api/livechat/webhook/[vendorId]/route.ts:155)
  - [webhook/route.ts:153-160](apps/chat/app/api/livechat/webhook/route.ts:153)
  - 全仓库无任何 `chat.thread.events` 解析（已确认）。
- 注释"session is created by first message's bridge"基于一个错误假设——以为第一条消息一定会单独以 `incoming_event` 再来一次；实际它已包含在 `incoming_chat` 里，不会重发。
- 关闭/归档会重置 session 与 caseId（[bridge.ts:131-143](apps/chat/lib/livechat/bridge.ts:131)），所以**每次 reopen 都复现**。

**修复（两个 webhook 路由都要改）**：在 `incoming_chat` 分支里解析 thread 内的顾客消息并喂给 agent；欢迎语仅在"开聊但无消息"时单独发，或先发欢迎语再处理消息。示意：

```ts
if (action === 'incoming_chat') {
  const p = { region: config.region, authType: config.authType, accountId: config.accountId }

  // LiveChat 把顾客的第一条消息放在 incoming_chat 的 thread.events 里下发,
  // 必须解析并交给 agent,否则 reopen 后第一句话会被丢弃(见 BUG-E)。
  const chat = (payload.chat ?? {}) as Record<string, unknown>
  const thread = (chat.thread ?? {}) as Record<string, unknown>
  const threadEvents = (thread.events ?? []) as Array<Record<string, unknown>>

  const customerMessages = threadEvents.filter((e) => {
    if (e.type !== 'message') return false
    const text = (e.text as string) || ''
    if (!text.trim()) return false
    // 排除我们自己 agent 发的消息(欢迎语等)
    if (config.agentAccountId && e.author_id === config.agentAccountId) return false
    return true
  })

  if (customerMessages.length === 0) {
    // 纯开聊、无文本 → 发欢迎语
    sendTextMessage(chatId, '您好，我是智能客服，请描述您遇到的问题～',
      config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
      .catch(err => console.error('[Webhook] incoming_chat welcome error:', err))
  } else {
    // 有首条消息 → 逐条交给 agent(handleIncomingEvent 内部会建 session)
    for (const e of customerMessages) {
      const evUserId = (e.author_id ?? userId) as string
      handleIncomingEvent(chatId, vendorId, evUserId, { type: 'message', text: e.text as string }, config)
        .catch(err => console.error('[Webhook] incoming_chat first-message error:', err))
    }
    // 可选:仍想要欢迎语就先发,但不要用它替代对首条消息的响应
  }
}
```

**注意点**：
- **去重**：thread 里的 message event 有自己的 `id`；若 LiveChat 之后又把它作为 `incoming_event` 重发，靠现有 `event.id` 去重即可挡住([route.ts:80-87](apps/chat/app/api/livechat/webhook/[vendorId]/route.ts:80))。建议处理 thread 消息时也用其 `e.id` 走一遍 `isDuplicateWebhook`，防止"incoming_chat 内首条 + 随后独立 incoming_event"双重响应。
- thread.events 里可能含多条历史/系统事件，务必只取 `type==='message'`、非空、非 agent 自发的。
- 字段路径以实际收到的 webhook 为准(可先在 `[Webhook] received` 日志里打印 `payload.chat.thread.events` 结构确认)；不同 LiveChat API 版本字段名可能略有差异。
- 两个路由(`[vendorId]` 多租户版与无参旧版)逻辑一致,需同步修改;若旧版已弃用可只改 `[vendorId]` 并确认线上 webhook 指向它。

**验收**：关闭并重开 widget → 顾客发第一句话 → **Intera 给出针对该问题的响应**（而非仅欢迎语）；连续 reopen 多次均如此；不出现对同一条消息的重复响应。

---

## 备注

- 本次核对未实跑端到端（需 LiveChat 真实 webhook + 平台账号）；BUG-A/B/D 为代码层确定性问题，BUG-C 为并发时序问题，建议补**并发集成测试**固化（对同一 caseId 极短间隔连发 2~3 条，断言每条都有回复且都持久化）。
- KB 检索质量相关另见 `doc/to-do/kb-retrieval-tuning.md`。

---

## 测试步骤（可用现有 API 端点和测试账号验证）

> 所有 HTTP 接口的基础 URL: `https://jayabaji.ai-chat.life/v2/chatbot`
> API Key: `G71fGn7G8vb1T2824rr7`
> 测试用户: `JAYA113C88F`, `JAYA114BBAA`, `JAYA11327F2`, `JAYA1188F57`, `JAYA11C5184`

### BUG-A — 图片上传 MIME 校验

**目标**: 验证非图片文件不会导致多模态 API 报错。

**步骤**:
1. 使用 curl 模拟 webhook 发送 `incoming_event`(type=`file`)，`content_type` 设为 `application/pdf`:
   ```bash
   curl -X POST http://localhost:3000/api/livechat/webhook/api \
     -H 'Content-Type: application/json' \
     -H 'x-livechat-webhook-signature: test' \
     -d '{
       "action": "incoming_event",
       "chat_id": "test-bug-a-001",
       "payload": {
         "license_id": "api",
         "event": {
           "id": "evt-bug-a-001",
           "type": "file",
           "author_id": "JAYA113C88F",
           "url": "https://example.com/test.pdf",
           "content_type": "application/pdf",
           "name": "receipt.pdf"
         }
       }
     }'
   ```
2. 观察 bridge 日志: 应输出 `[Bridge] attachment: ... text-only fallback`（非图片降级），而不是构造 image content block。
3. 用 `image/png` contentType 发同样请求，观察正确构造 image block。
4. 用缺失 `content_type` 的请求，观察降级到 `未知类型` 文本提示。

**预期结果**: PDF / 无类型 → bridge 发文本提示，不尝试构造 image block；PNG → 正常走多模态。

---

### BUG-B — 流中 LLM 错误对用户静默

**目标**: 验证 LLM 出错时用户能看到"系统繁忙"提示。

**步骤**:
1. 调用 POST `/api/messages`，传入一个会导致 LLM 调用的消息:
   ```bash
   curl -X POST http://localhost:3000/api/messages \
     -H 'Content-Type: application/json' \
     -d '{
       "vendorId": "api",
       "userId": "JAYA113C88F",
       "chatId": "test-bug-b-001",
       "message": "test error handling"
     }'
   ```
2. 观察 SSE 流: 如果在 tool calling 阶段 LLM 返回 error，SSE 流中应出现:
   ```
   data: {"type":"error","data":"LLM API error ..."}
   ```
3. 检查 renderer: `error` event 应转换为 `send_text`（包含"系统繁忙，请稍后重试"），而不是 `noop`。
4. 确认 bridge 将此文本发送到 LiveChat 客户端。

**预期结果**: SSE 流中的 `error` 事件 → 用户看到"系统繁忙"提示，不会静默。

---

### BUG-C — Drain followup 持久化

**目标**: 验证并发场景下 drain 的消息回复持久化到 DB。

**步骤**:
1. 对同一个 `caseId` 快速连发 2 条 `/api/messages`:
   ```bash
   # Terminal 1: 第一条消息
   curl -X POST http://localhost:3000/api/messages \
     -H 'Content-Type: application/json' \
     -d '{"vendorId":"api","userId":"JAYA113C88F","chatId":"test-bug-c-001","message":"第一条消息"}'

   # Terminal 2: 立即发第二条（1 秒内）
   curl -X POST http://localhost:3000/api/messages \
     -H 'Content-Type: application/json' \
     -d '{"vendorId":"api","userId":"JAYA113C88F","chatId":"test-bug-c-001","message":"第二条补充"}'
   ```
2. 等待两个 SSE 流都结束。
3. 查询 DB messages 表:
   ```sql
   SELECT role, content FROM messages WHERE caseId = '<case_id>' ORDER BY createdAt;
   ```
4. 确认第二条消息的用户输入和 agent 回复都存在于表中。

**预期结果**: DB 中包含所有消息往返（用户消息 × 2 + agent 回复 × 2），无缺失。

---

### BUG-D — 202 死分支清理

**目标**: 验证代码中不再有 202 死分支。

**步骤**:
1. 检查 bridge.ts: 搜索 `response.status === 202`，确认已删除。
2. 检查 route.ts 排队注释: 搜索 `return 202`，确认已改为描述 SSE `reason:queued`。
3. 功能回归: 快速连发两条消息到同一 caseId，第二条被排队后 SSE 正常结束（不发重复回复）。

**预期结果**: bridge 中无 202 判断；注释和实现一致。

---

### BUG-E — incoming_chat 首条消息

**目标**: 验证 reopen 后首条消息不被丢弃。

**步骤**:
1. 模拟 `incoming_chat` webhook（带 thread.events）:
   ```bash
   curl -X POST http://localhost:3000/api/livechat/webhook/api \
     -H 'Content-Type: application/json' \
     -H 'x-livechat-webhook-signature: test' \
     -d '{
       "action": "incoming_chat",
       "chat_id": "test-bug-e-001",
       "payload": {
         "license_id": "api",
         "chat": {
           "thread": {
             "events": [
               {
                 "id": "evt-first-msg-001",
                 "type": "message",
                 "text": "我的存款什么时候到账？",
                 "author_id": "JAYA113C88F"
               }
             ]
           }
         }
       }
     }'
   ```
2. 观察日志: 应输出 `[Webhook] incoming_chat: first message dispatched`，调用 `handleIncomingEvent`。
3. 检查 bridge session 是否创建（`external_conversations` 表中有该 chatId）。
4. 确认 agent 对 "我的存款什么时候到账？" 给出了针对性回复，而非仅发欢迎语。
5. 用同样的 chatId 再发一条独立 `incoming_event`(type=`message`)，确认去重生效（同一条 thread event 不会被响应两次）。

**预期结果**: reopen 后首条消息被正常处理并得到回复；重复事件被去重。

---

### 并发集成测试（全覆盖）

**步骤**:
1. 对同一 `caseId` 在 0.5s 间隔内连发 3 条 `/api/messages`。
2. 断言:
   - 只启动一个 AgentLoop（`hasSession` 为 true 时，后续请求入队）
   - 3 条消息全部得到回复
   - 所有回复都持久化到 DB
   - 无重复回复 / 无消息丢失
3. 重新请求同一个 caseId: agent 能看到之前 3 条的完整上下文。

**预期结果**: 并发安全，每条消息都有回复且持久化。
