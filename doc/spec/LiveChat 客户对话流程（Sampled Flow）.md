## LiveChat 客户对话流程（Sampled Flow）

### 场景：客户报告存款未到账

------

**第 1 步 — 客户发消息**



```
客户在 LiveChat Widget 输入："我存了 500 BDT，还没到账"
  → LiveChat Cloud 发 webhook（action: incoming_event, type: message）
  → POST /api/livechat/webhook/[customerId]
  → HMAC 验签通过 → 去重检查 → 加载 LiveChatConfig
  → handleIncomingEvent(chatId, customerId, userId, { type: 'message', text: '...' })
```

**第 2 步 — Bridge 建会话 + 调 Agent**



```
bridge.ts:
  getSession(chatId) → null（首次）
  → upsertSession({ chatId, customerId, caseId: generateCaseId(), state: 'idle' })
  → 更新 LiveChat chat properties（标记 owner: intera）
  → updateSessionState('thinking')
  → setTypingIndicator(true)     ← 客户看到三个跳动点
  → POST /api/messages { customerId, userId, chatId, caseId, message: "我存了500..." }
```

**第 3 步 — Agent Loop 启动**



```
/api/messages route.ts:
  getOrCreateSession(caseId)
  → P0-1: activeSession.resolved = false  ← 确保本轮 hasSession=true，并发护栏生效
  → AgentLoop.create() → 加载 DB 中的历史消息 + memory
  → agentLoop.run(userMessage, sendEvent)
```

**第 4 步 — Agent 创建 Case + 调用工具**



```
AgentLoop:
  iteration 1: LLM 决定 → create_case('deposit_issue')
    → SSE: tool_executing { name: 'create_case', displayVerb: 'Creating your case' }
    → renderer: noop（typing indicator 已经在跳）
    → SSE: skill_result { name: 'create_case', status: 'completed' }
    → renderer: send_card { title: 'create case', subtitle: '✅ 完成' }

  iteration 2: Case 创建完毕，LLM 自动进入 investigating stage
    → 调用 get_latest_deposit(member_id) + get_transaction_history(member_id, 'deposit')
    
    → SSE: tool_executing { name: 'get_latest_deposit' }
    → SSE: skill_result { result: { status: 'approved', created_at: '...' }, renderHints: { livechat: { kind: 'card', titleField: '$.status', subtitleField: '$.created_at' } } }
    → renderer: renderSkillByHint → send_card { title: 'approved', subtitle: '2026-05-23 15:25:21', buttons: [...] }
    → bridge: sendCard → LiveChat 客户端渲染一张富卡片

    → SSE: tool_executing { name: 'get_transaction_history' }
    → SSE: skill_result { result: { data: [{ order_id, amount, currency, status }] }, renderHints: { livechat: { kind: 'carousel' } } }
    → renderer: renderSkillByHint → send_carousel（5 条交易记录横滑卡片）
    → bridge: sendCarousel → LiveChat 渲染横滑卡片
```

**第 5 步 — Agent 需要客户补充信息 → Moments Form**



```
  iteration 3: LLM 发现需要客户提供更多信息
    → 调用 request_user_input({ title: 'Deposit Information', fields: [
        { key: 'txnId', label: 'Transaction ID', type: 'text', required: true },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'paymentMethod', label: 'Payment Method', type: 'select', options: ['bKash', 'Nagad', ...] }
      ]})
    
    → SSE: tool_executing { name: 'request_user_input' }
    → SSE: form_request { caseId, title: 'Deposit Information', fields: [...] }
    → renderer: send_card { 
        title: 'Deposit Information',
        subtitle: '3 fields to fill',
        buttons: [{ type: 'webview', url: '.../livechat-widget?view=form&caseId=...&title=...&fields=JSON' }]
      }
    → bridge: sendCard → 客户看到一张卡片，按钮写着 "Deposit Information"
```

**第 6 步 — 客户点击按钮 → Moment 打开**



```
客户点击卡片上的 "Deposit Information" 按钮
  → LiveChat 打开 webview（iframe）
  → 加载 /livechat-widget?view=form&caseId=xxx&title=Deposit Information&fields=[...]
  → widget 页面检测 URL params → 解析 fields JSON
  → Moments SDK 自动加载（CDN script）
  → 动态渲染 FormCard（3 个字段：Transaction ID / Amount / Payment Method）
  → 客户填写表单 → 点击提交
  → momentsSDK.sendMessage({ text: '[表单提交] txnId: TX123, amount: 500, paymentMethod: bKash' })
  → momentsSDK.close()
```

**第 7 步 — 表单结果回流 + Agent 继续**



```
LiveChat 将 Moments 消息作为客户消息发送：
  → webhook: incoming_event, type: message, text: "[表单提交] txnId: TX123, amount: 500, paymentMethod: bKash"

bridge:
  → getSession(chatId) → 复用已有 session（同 chatId → 同 caseId）
  → updateSessionState('thinking')
  → POST /api/messages { message: '[表单提交] ...', formResult: { caseId, answers: {...} } }

/api/messages route:
  → P0-1: getOrCreateSession(caseId) → 复用旧 session → 重置 resolved = false
  → 护栏检查：如果上一个 loop 还在跑 → hasSession=true → 消息入队（不启动并行 loop）
  → 如果上一个 loop 已结束 → 启动新 AgentLoop

AgentLoop:
  → 收到 formResult → 解析为 confirmedFacts
  → 继续 investigating stage
  → 调用 query 工具对比平台数据
  → LLM 确认无异常 → 给客户结论："您的存款已到账，金额 500 BDT"
  → SSE: text_delta → bridge: buffer_text → 逐字追加到 DB textBuffer
  → SSE: message_stop → bridge: flush_text → sendTextMessage → 客户看到完整回复
```

**第 8 步 — Loop 退出 + 队列 Drain**



```
agentLoop.run() 返回 → route.ts:
  → P0-2: while (queue.pendingCount > 0) → drain 剩余消息
    （如果客户在 agent 回复过程中又发了消息，此时被消费）
  → activeSession.resolved = true
  → 持久化 case memory + messages 到 DB
```

------

### 异常路径

**客户快速连发两条消息（并发）**



```
消息 1: "我存了钱没到账"
  → bridge → POST /api/messages → 启动 AgentLoop（hasSession 刚注册 = true）

消息 2: "是 bKash 存的"（1 秒后到达）
  → bridge → POST /api/messages
  → route: hasSession(caseId) = true → 消息入队，返回 202 "queued"
  → AgentLoop 在 iteration 顶部 drain：
      this.messages.push("[SYSTEM] 用户补充了新信息：是 bKash 存的")
  → 继续处理，不会启动并行 loop（P0-1 修复的关键）
```

**LLM API 瞬态错误**



```
AgentLoop iteration N:
  → Anthropic API 返回 500
  → FallbackTriggeredError
  → P1-4: 发 error SSE 事件 + 返回 transition: 'machine_error'
  → 不发 escalated → bridge 不 transfer
  → route: sendEvent 携带错误信息
  → bridge: 客户收到 "系统繁忙，请稍后重试"（sendFailureNotice）
  → session 保持 active → 客户可重试
```

**真实人工升级**



```
AgentLoop policy 触发:
  → conflict_requires_human → evaluator 发 escalated { reason: 'policy: conflict_requires_human' }
  → renderer: send_card → transfer_chat
  → bridge: transferChat → 会话转给人工组
  → updateSessionState('transferred')
  → 之后该 chat 的消息 → bridge 直接 return（不调 agent）
```