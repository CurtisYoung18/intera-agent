## LiveChat 客户对话流程（Sampled Flow）

> **2026-06-09 校准**：本文是渠道链路样例。当前目标架构是 LiveChat 作为 channel adapter，统一进入 `/api/messages`，由 single ProcedureRun Agent 执行 Procedure type + Procedure。事件名使用 Foundation Reset 后的 `tool_call` / `tool_result` 语言；历史 trace 里可能仍存在 compatibility 事件名。

### 场景：客户报告存款未到账

---

## 1. 客户发消息

```text
客户在 LiveChat Widget 输入：
  "我存了 500 BDT，还没到账"

LiveChat Cloud webhook:
  action: incoming_event
  type: message

POST /api/livechat/webhook/[orgId]/[agentName]
  -> HMAC 验签
  -> 去重
  -> 加载 LiveChat channel binding
  -> handleIncomingEvent(chatId, orgId, userId, message)
```

LiveChat 只负责接入、会话映射、typing、富消息渲染和人工转接。它不拥有另一套 Agent runtime。

---

## 2. Bridge 建会话并调用 Agent

```text
bridge.ts
  -> getSession(chatId)
  -> if first message:
       create channel session
       assign caseId
       resolve agentConfigId
  -> set typing indicator
  -> POST /api/messages {
       userId,
       chatId,
       caseId,
       agentConfigId,
       channel: 'livechat',
       message
     }
```

目标：无论消息来自 LiveChat、API、Playground 还是未来 Web Chat，都进入同一条 `/api/messages` Agent path。

---

## 3. Agent 选择 Procedure type 和 Procedure

```text
/api/messages
  -> getOrCreateSession(caseId)
  -> AgentLoop.create()
  -> Discovery
  -> dispatch_case_agent('deposit_issue')
  -> attach Procedure type: deposit_issue
  -> attach Procedure: Deposit Not Credited
  -> continue inline with the ProcedureRun Agent
```

Procedure routing 的目标语义是“打开/选择 ProcedureRun 并进入对应 Procedure”，不是启动 detached background worker。

示例 Procedure：

```text
1. ask       Collect member id, amount, currency, payment method, approximate time
2. use       get_latest_deposit
3. read      transaction_history
4. decide    Match claim against platform evidence
5. escalate  Transfer if evidence conflicts or payment provider state is unclear
6. finalize  Explain result and next step
```

---

## 4. Tool 调用与 LiveChat 富消息

```text
Agent decides to call get_latest_deposit
  -> HookEngine.evaluate('PreToolUse', ctx)
  -> SSE: tool_call { name: 'get_latest_deposit', status: 'running' }
  -> Tool executes
  -> HookEngine.evaluate('PostToolUse', ctx)
  -> SSE: tool_result {
       name: 'get_latest_deposit',
       status: 'completed',
       result: { status: 'approved', created_at: '2026-05-23 15:25:21' },
       renderHints: {
         livechat: { kind: 'card', titleField: '$.status', subtitleField: '$.created_at' }
       }
     }
  -> LiveChat renderer maps renderHints.livechat to a card
```

另一个 Tool：

```text
get_transaction_history
  -> tool_result {
       result: { data: [{ order_id, amount, currency, status }] },
       renderHints: { livechat: { kind: 'carousel' } }
     }
  -> bridge sends carousel to LiveChat
```

Rendering rule: Tool result owns structured data; channel-specific `renderHints` decide LiveChat presentation.

---

## 5. Agent 需要客户补充信息

```text
Procedure step: ask
Agent calls ask_user_questions({
  title: 'Deposit Information',
  fields: [
    { key: 'txnId', label: 'Transaction ID', type: 'text', required: true },
    { key: 'amount', label: 'Amount', type: 'number', required: true },
    { key: 'paymentMethod', label: 'Payment Method', type: 'select', options: ['bKash', 'Nagad'] }
  ]
})

SSE:
  tool_call { name: 'ask_user_questions' }
  form_request { caseId, title, fields }

LiveChat:
  send card with webview button
  customer opens Moments/WebView form
```

表单提交后：

```text
Moments SDK sends message:
  "[表单提交] txnId: TX123, amount: 500, paymentMethod: bKash"

LiveChat webhook
  -> same chatId
  -> same caseId
  -> /api/messages
  -> Agent updates CaseNotebook.facts
  -> Procedure continues
```

---

## 6. Stop Hook 与客户可见回复

所有客户可见回复发送前都要经过 `Stop`。

```text
Agent drafts reply:
  "您的存款已到账，金额 500 BDT。"

HookEngine.evaluate('Stop', {
  caseType: 'deposit_issue',
  procedureProgress,
  facts,
  missingFacts,
  toolResults,
  replyDraft
})
```

Possible outcomes:

- `allow` -> bridge flushes text to LiveChat.
- `warn` -> bridge sends text, trace records risk.
- `block` -> do not send draft; inject Hook feedback and let Agent repair.
- `escalate` -> create human task and transfer LiveChat chat.

---

## 7. 人工转接

```text
Hook or Agent decides escalation is required
  -> call create_human_task / transfer Tool
  -> payload includes:
       customer request
       Procedure type
       Procedure progress
       facts and missing facts
       Tool evidence
       Hook decisions
       recommended next human action
  -> bridge.transferChat()
  -> LiveChat conversation state = transferred
```

之后该 LiveChat chat 的客户消息应直接进入人工路径，除非操作员或系统显式恢复 Agent。

---

## 8. 并发消息

```text
Message 1: "我存了钱没到账"
  -> /api/messages starts Agent turn

Message 2: "是 bKash 存的"
  -> same chatId/caseId
  -> active session exists
  -> message is queued or drained into the running turn
  -> no second parallel AgentLoop starts for the same ProcedureRun
```

Invariant: one active customer-facing Agent turn per ProcedureRun.

---

## 9. 错误路径

Transient LLM or Tool error:

```text
Tool / LLM fails
  -> trace error
  -> Agent may retry if bounded and safe
  -> if still blocked:
       Stop Hook or runtime fallback requires human transfer
       or bridge sends a safe temporary failure message
```

Do not convert every machine error into fake business resolution. If the Agent cannot safely conclude, transfer or ask the customer to wait.
