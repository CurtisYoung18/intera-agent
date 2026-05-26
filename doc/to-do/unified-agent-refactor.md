# Plan: Intera Agent 统一重构

> **前置依赖：** 同事完成 `doc/to-do/livechat-rich-ux-design.html`（In-Chat App + Bridge）后，由 Claude Code 统一实施本 plan。
>
> 合并自 `concurrent-message-queue.md` 和 `sub-agent-refactor-plan.md`，消除冲突，统一实施顺序。

---

## 0. 背景与目标

### 当前问题

| 问题 | 影响 |
|------|------|
| `loop.ts` 和 `sub-agent.ts` 两套代码 | Sub-Agent 缺少主 Agent 的护栏（Sanitizer、StageEval、Policy、Compaction） |
| Sub-Agent 通信靠 Dashboard 轮询 `dashboardVersion` | 延迟至少一个迭代周期，只能传状态变更不能传指令 |
| `POST /api/messages` 无并发保护 | 同 caseId 两个 POST → 两个独立 AgentLoop → caseMemory 覆盖 |
| Sub-Agent 每次从零构建 prompt + tools | 无 prompt cache 共享，并行子代理 token 成本翻倍 |
| 错误处理只有 `catch → break` | LLM 临时故障导致 case 中断 |
| 无 agent 树追踪 | 出问题无法定位是 main / sub / 第几层的 Agent |

### 目标

1. 统一 `AgentLoop.run()` — 主 Agent 和 Sub-Agent 走同一套代码
2. `MessageBus` 取代 Dashboard 轮询 — Agent 间实时通信
3. `MessageQueue` 接入 `/api/messages` — 并发消息安全入队
4. Fork cache 共享 — 并行子代理 token 成本降低 60-80%
5. 三层自动错误恢复 — 临时故障不中断 case
6. Query Chain Tracking — 全链路可观测 + Console Trace 可见

---

## 1. 统一 Agent Loop

### 1.1 AgentContext

`loop.ts` 的 `run()` 接受 `AgentContext`：

```typescript
interface AgentContext {
  agentId: string
  chainId: string           // 同调用链共享 UUID
  depth: number             // 0=主Agent, 1=子, 2=孙...
  parentAgentId?: string
  allowedTools: Set<string> // 工具白名单
  isSubAgent: boolean
  maxIterations: number
  messageBus: MessageBus    // Agent 间通信
}
```

`sub-agent.ts` 的独立 `run()` 废弃，改为组装 `AgentContext` 后调用 `AgentLoop.run(ctx)`。

### 1.2 主/子行为分支

`run()` 内部根据 `isSubAgent` 调整：

| 行为 | 主 Agent | Sub-Agent |
|------|----------|-----------|
| 终端工具 (`finalize_case`, `create_case`, `create_human_task`) | 允许 | 禁止 |
| `StreamingTextSanitizer` | 启用 | 启用 |
| `PolicyEngine` 三 Hook | 启用 | postTool 启用 |
| `StageExecutor` | 启用 | 跳过（sub-agent 无 stage 概念） |
| compaction 阈值 | 80% context window | 60% context window |
| TraceWriter | 完整 | 精简（仅 skill 调用 + 错误） |

---

## 2. MessageBus — Agent 间实时通信

取代 Dashboard 轮询。实现在 `session-store.ts` 中，与 MessageQueue 共用基础设施。

```typescript
interface MessageBus {
  send(to: string, msg: AgentMessage): void
  poll(agentId: string): AgentMessage[]
}

interface AgentMessage {
  from: string
  type: 'update' | 'directive' | 'query' | 'result' | 'user_input'
  content: string
  timestamp: string
}
```

### 使用场景

**场景 A — 用户穿插消息（LiveChat 场景）：**

```
LiveChat incoming_event
  → Bridge: POST /api/messages
    → MessageQueue.enqueue(msg)
    → MessageBus.send(mainAgentId, { type: 'user_input', content: "交易号 TX12345" })
  ↓
Main Agent Loop 下一轮迭代:
  → MessageQueue.dequeueNonBlocking() → 注入 "[SYSTEM] 用户补充: TX12345"
  → MessageBus.send(all, { type: 'update', ... })  → 广播给所有 sub-agent
  ↓
Sub-Agent 本轮迭代前:
  → MessageBus.poll(agentId) → 收到 UPDATE → 调整策略
```

**场景 B — Sub-Agent 间协作：**

```
investigator_a: MessageBus.send("investigator_b", { type: 'query', content: "查这个用户的历史订单" })
investigator_b: MessageBus.poll() → 收到 query → 调用工具 → MessageBus.send("investigator_a", result)
```

所有 MessageBus 事件写入 `ActionTrace`（actionType: `message_bus_send` / `message_bus_receive`），Console Timeline 可追溯。

---

## 3. MessageQueue — 并发消息安全入队

### 3.1 `/api/messages` 路由改造

```typescript
const session = getOrCreateSession(caseId)

if (!session.initialized) {
  // 首次：创建 AgentLoop + SSE stream
  session.loop = await AgentLoop.create(ctx)
  session.initialized = true
  session.queue.enqueue(msg)
  // 现有 SSE 流逻辑不变
} else if (session.resolved) {
  // case 已结束但用户回来：新 Loop + 复用 caseId
  cleanupSession(caseId)
  // 重新走首次逻辑
} else {
  // Agent 正在处理中：入队
  session.queue.enqueue(msg)
  trace.write('queue_message_enqueued', `消息入队: chatId=${chatId}`, { queueDepth: session.queue.length })
  return NextResponse.json({ accepted: true, caseId }, { status: 202 })
}
```

### 3.2 Loop 内消费

`run()` 的 while 循环顶部，LLM 调用前：

```typescript
const session = getSessionByCaseId(caseId)
if (session) {
  let pending
  while ((pending = session.queue.dequeueNonBlocking())) {
    this.messages.push({
      role: 'user',
      content: `[SYSTEM] 用户补充：${pending.content}`
    })
    MessageBus.send('*', {
      from: this.agentId,
      type: 'user_input',
      content: pending.content
    })
    trace.write('queue_message_consumed', `消费消息: ${pending.id}`, { iteration: this.iterationCount })
  }
}
```

### 3.3 并发安全

| 场景 | 处理 |
|------|------|
| 同 caseId 并发 POST | 第一个创建 Loop+SSE，后续入队返回 202 |
| LLM 调用期间消息到达 | 不打断，下轮消费 |
| Case 结束后新消息 | `session.resolved` 检测 → 新 Loop + 复用 caseId |
| Loop 未初始化时消息到达 | 预创建 Session，缓冲消息，Loop 启动后消费 |

---

## 4. Fork 模式 — Prompt Cache 共享

并行 dispatch 同类型 sub-agent 时，使用 Fork 模式：

```
主 Agent 返回 3 个 Agent() tool_use
  ↓
Fork 流程:
  1. 父 assistant 消息（含 N 个 tool_use）→ 原样保留
  2. 每个 child 收到相同 tool_result 占位:
     { tool_use_id: "xxx", content: "[Sub-agent dispatched — processing in background]" }
  3. 注入 per-child directive（只有这里不同）:
     "核查充值：查询 deposit 状态和支付渠道..."
  4. 结果: [父消息] + [相同占位] + [不同 directive]
     → prompt 前缀 95% 相同 → cache 命中
```

Fork children 共享父 Agent 的 system prompt + tools 定义。Orchestrator 检测到 `subAgents.length >= 2 && 同类型` 时自动启用 Fork 模式。

---

## 5. 自动错误恢复

在 `run()` 的 LLM 调用处加入三层恢复：

**第一层 — Model Fallback：**

```typescript
try {
  stream = await llmClient.stream(req)
} catch (e) {
  if (isProviderError(e) && fallbackModel) {
    req.model = fallbackModel
    stream = await fallbackClient.stream(req)
    trace.write('loop_decision', `Fallback to ${fallbackModel}`)
  } else { throw e }
}
```

`fallbackModel` 从 `AgentConfig.models` JSON 字段读取。

**第二层 — Token Limit 恢复：**

```typescript
if (stopReason === 'max_tokens' && tokenRetryCount < 3) {
  messages.push({ role: 'user', content: '[System] 你的回复在输出上限处被截断。请从中断处继续。' })
  tokenRetryCount++
  continue  // 不消耗 iteration
}
```

**第三层 — Context Overflow 恢复：**

```typescript
if (error.code === 413) {
  await emergencySnip(messages, 4)  // 裁剪到最近 4 条
  continue
}
```

---

## 6. Query Chain Tracking

每次 `AgentLoop.run()` 携带：

```typescript
const chain = {
  chainId: parent?.chainId ?? crypto.randomUUID(),
  depth: (parent?.depth ?? -1) + 1,
  parentAgentId: parent?.agentId,
}
```

每次 LLM 调用写 `agent_tree_node` trace（actionType 新增），Console Timeline 可展开 agent 调用树：

```
14:32:03  agent_tree_node  [Main] iteration #1 (depth=0, chain=abc)
14:32:05  agent_tree_node    [investigator:deposit] dispatch (depth=1)
14:32:08  agent_tree_node      LLM request (depth=1, chain=abc)
14:32:12  agent_tree_node    [investigator:fraud] dispatch (depth=1)
14:32:15  agent_tree_node    [investigator:deposit] completed (1.2s, 820 tokens)
14:32:18  agent_tree_node    [investigator:fraud] completed (0.9s, 610 tokens)
```

---

## 7. 上下文压缩补齐

在现有 `compact.ts` 上补齐：

| 能力 | 当前 | 改造 |
|------|------|------|
| microcompact | ✅ | Sub-Agent 也启用 |
| autocompact | ✅ | Sub-Agent 启用（阈值 60%） |
| snip | ✅ | 不变 |
| context collapse | ❌ | 新增：跨轮持久化摘要 |
| reactive compact | ❌ | 新增：413 触发紧急裁剪到 4 条 |

---

## 8. Console Trace 新增 ActionType

```typescript
// trace.ts 新增:
| 'queue_message_enqueued'    // 并发消息入队（payload: chatId, queueDepth）
| 'queue_message_consumed'    // Loop 消费消息（payload: iteration）
| 'message_bus_send'          // Agent 发消息给另一个 Agent
| 'message_bus_receive'       // Agent 收到消息
| 'agent_tree_node'           // Agent 调用树节点（payload: chainId, depth）
| 'fork_dispatch'             // Fork 模式批量 dispatch（payload: childCount）
```

全部通过 `caseId` → `chatId` 关联，Console → Cases → Timeline 可追溯完整链路。

---

## 9. 文件变更清单

| 文件 | 操作 | 关联章节 |
|------|------|----------|
| `loop.ts` | 重构 | 1,3,5,6 — AgentContext + 队列消费 + 错误恢复 + chain tracking |
| `sub-agent.ts` | 废弃独立 run() | 1 — 改为调 AgentLoop.run(ctx) |
| `orchestrator.ts` | 修改 | 4 — Fork 模式 + AgentContext 传递 |
| `session-store.ts` | 扩展 | 2,3 — MessageBus + dequeueNonBlocking + resolved |
| `compact.ts` | 扩展 | 7 — contextCollapse + reactiveCompact |
| `trace.ts` | 扩展 | 8 — 6 个新 ActionType |
| `types/index.ts` | 扩展 | — AgentContext, MessageBus, ChainTracking 类型 |
| `config-cache.ts` | 修改 | 5 — 读取 models.fallback |
| `messages/route.ts` | 修改 | 3 — 接入 MessageQueue，202 返回 |
| `livechat/webhook/route.ts` | 新建 | — HMAC 验签 + 透传 /api/messages |

---

## 10. 实施顺序

```
Phase 1 ─ 基础（无外部依赖）
  ├─ Trace 扩展（6 个新 ActionType）
  ├─ Query Chain Tracking
  └─ 上下文压缩补齐

Phase 2 ─ 统一 Loop（Phase 1 完成后）
  ├─ AgentContext + loop.ts 条件分支
  ├─ 废弃 sub-agent.ts 独立 run()
  └─ Orchestrator 传递 AgentContext

Phase 3 ─ 通信 + 并发（Phase 2 完成后）
  ├─ MessageBus + MessageQueue 集成到 session-store
  ├─ /api/messages 接入队列 → 202
  ├─ Loop 内队列消费 + MessageBus 广播
  └─ 自动错误恢复

Phase 4 ─ 性能优化（Phase 3 完成后）
  └─ Fork 模式 cache 共享

Phase 5 ─ LiveChat Bridge（Phase 3 完成后，可与 Phase 4 并行）
  └─ /api/livechat/webhook 路由
```

---

## 11. 验证

1. **统一 Loop**：Sub-Agent 执行时 Console Trace 出现 `policy_hit`、`microcompact` 等之前缺失的日志
2. **并发消息**：两个 POST 同时打同一 caseId → 一个 200 SSE + 一个 202；Console Timeline 可见 `queue_message_enqueued` → `queue_message_consumed` → `message_bus_send`
3. **Fork Cache**：3 个并行 investigator → Anthropic `cache_read_input_tokens` > 80%
4. **错误恢复**：模拟 LLM 5xx → Agent 切换 fallback → case 不中断
5. **Agent 树**：Console Timeline 可展开 main → sub → sub-sub 调用树
