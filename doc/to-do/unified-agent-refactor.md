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
| `StageExecutor` | 启用 | **轻量 task checklist 替代**（见 1.3） |
| compaction 阈值 | 80% context window | 60% context window |
| TraceWriter | 完整 | 精简（仅 skill 调用 + 错误） |

### 1.3 Sub-Agent 结构化执行（轻量 SOP）

Sub-Agent 不走完整 StageExecutor，但通过以下三层约束保证执行确定性：

**Layer 1 — Task Checklist（Orchestrator dispatch 时注入 system prompt）：**

```
[SUB-AGENT TASK: investigate_deposit]
核查充值记录并返回结论。

Required checks:
  □ 调用 query_deposit_channel 确认支付渠道状态
  □ 调用 get_transaction_history 拉取近7天交易
  □ 如果渠道状态 = pending → 调用 search_delay_notice 查公告

Output format:
  { "channel_status": "...", "transactions": [...], "delay_notice": "..." }

Rules:
  - 至少完成 3 个 required checks 中的 2 个
  - 如果找不到交易记录，报告 "no_transactions" 而非猜测
  - 完成后调用 finalize_sub_agent，禁止调用其他终端工具
```

**Layer 2 — Tool Whitelist（`allowedTools`）：** Sub-Agent 只能调用白名单里的工具，Orchestrator dispatch 时从 `StageConfig.subAgents[].allowedSkills` 读取。

**Layer 3 — SOP 模式可选保留：** 对合规要求极高的场景（如提现审核），在 `SubAgentConfig` 里设 `executionMode: 'sop'`，sub-agent 走完整 SOP todo 循环。默认用轻量 task checklist。

与 CC 的区别：CC 的 sub-agent 完全自由调用工具，靠 system prompt 软约束。Intera 保留了 iGaming 需要的确定性——task checklist 比 CC 更结构化，但比完整 StageExecutor 更轻量。

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

## 8. Console Trace 重构 — 以 chatId 为结算单位

### 8.1 当前问题

ActionTrace 以 `caseId` 为单位。LiveChat 场景下，一个对话可能产生多个 case，`caseId` 无法承载对话级别的全局视图（如 `incoming_chat`、`queue_enqueued`、跨 case 的 agent 树）。

### 8.2 改造方案

**ActionTrace 加 `chatId` 可选字段：**

```prisma
model ActionTrace {
  // ... existing fields ...
  chatId     String?  // 新增：所属对话 ID
  @@index([chatId])
}
```

写入 trace 时，若 AgentContext 有 chatId 则填入。所有现有 `caseId` 查询不受影响。

**Console Chats 页面升级为通用 Trace 看板：**

```
Console → Chats → 点开一个 chat

chatId: livechat_PJ0MRSHTDG
├─ 14:32:01  incoming_chat         新对话
├─ 14:32:02  case_created          deposit_issue (case_xxx)
│   ├─ 14:32:03  skill_called      kb_hybrid_retrieve
│   ├─ 14:32:04  skill_result      kb_hybrid_retrieve (3 hits)
│   ├─ 14:32:05  agent_tree_node   sub:investigator dispatch (depth=1)
│   ├─ 14:32:08  queue_enqueued    用户补充: "交易号 TX12345"
│   ├─ 14:32:09  dashboard_bump    v12 → v13
│   ├─ 14:32:10  sub_agent_done    investigator completed (1.2s)
│   └─ 14:32:13  final_resolution  resolved
├─ 14:35:22  case_created          withdraw_issue (case_yyy)
│   └─ ...
└─ 14:40:00  chat_deactivated      对话关闭
```

**可舍弃的旧页面：**
- `/ops/cases/[id]/memory` 独立页面 → 合并到 chat trace 时间线可展开 section
- `/ops/cases/[id]/traces` 独立 API → chat trace API 直接覆盖（GitHub issue: `DELETE /api/cases/[id]/traces`）

**Cases 页面保持不变但降级：** 作为按 case 过滤的快捷入口，查询时从 chat trace 中筛选 `caseId = xxx` 的节点。

### 8.3 新增 ActionType

```typescript
// trace.ts 新增:
| 'queue_message_enqueued'    // 并发消息入队（payload: chatId, queueDepth）
| 'queue_message_consumed'    // Loop 消费消息（payload: iteration）
| 'message_bus_send'          // Agent 发消息给另一个 Agent
| 'message_bus_receive'       // Agent 收到消息
| 'agent_tree_node'           // Agent 调用树节点（payload: chainId, depth）
| 'fork_dispatch'             // Fork 模式批量 dispatch（payload: childCount）
| 'incoming_chat'             // LiveChat 新对话（payload: platform, externalChatId）
| 'chat_deactivated'          // 对话关闭
| 'case_merged'               // 同 chat 内多个 case 的关联标记
```

---

## 9. 文件变更清单

| 文件 | 操作 | 关联章节 |
|------|------|----------|
| `loop.ts` | 重构 | 1,3,5,6 — AgentContext + 队列消费 + 错误恢复 + chain tracking |
| `sub-agent.ts` | 废弃独立 run() | 1 — 改为调 AgentLoop.run(ctx) |
| `orchestrator.ts` | 修改 | 1.3, 4 — task checklist 注入 + Fork 模式 + AgentContext 传递 |
| `session-store.ts` | 扩展 | 2,3 — MessageBus + dequeueNonBlocking + resolved |
| `compact.ts` | 扩展 | 7 — contextCollapse + reactiveCompact |
| `trace.ts` | 扩展 | 8 — 9 个新 ActionType + chatId 字段 |
| `types/index.ts` | 扩展 | — AgentContext, MessageBus, ChainTracking 类型 |
| `config-cache.ts` | 修改 | 5 — 读取 models.fallback |
| `messages/route.ts` | 修改 | 3 — 接入 MessageQueue，202 返回 |
| `schema.prisma` | 修改 | 8 — ActionTrace 加 chatId 字段 |
| `apps/console/app/ops/chats/` | 重构 | 8 — 升级为通用 Trace 看板 |
| `apps/console/app/ops/cases/[id]/memory/` | 废弃 | 8 — 合并到 chat trace |
| `livechat/webhook/route.ts` | 已完成 | — HMAC 验签 + 透传 /api/messages |

---

## 10. 实施顺序

```
Phase 1 ─ 基础（无外部依赖）
  ├─ Trace 扩展（9 个新 ActionType + chatId 字段 + schema 变更）✅
  ├─ Query Chain Tracking ✅
  └─ 上下文压缩补齐

Phase 2 ─ 统一 Loop（Phase 1 完成后）
  ├─ AgentContext + loop.ts 条件分支 ✅
  ├─ Sub-Agent 轻量 SOP（task checklist + tool whitelist）✅
  ├─ 废弃 sub-agent.ts 独立 run()
  └─ Orchestrator 传递 AgentContext + task checklist 注入 ✅

Phase 3 ─ 通信 + 并发（Phase 2 完成后）
  ├─ MessageBus + MessageQueue 集成到 session-store ✅
  ├─ /api/messages 接入队列 → 202 ✅
  ├─ Loop 内队列消费 + MessageBus 广播 ✅
  └─ 自动错误恢复 ✅

Phase 4 ─ Console Trace 重构（Phase 3 完成后）
  ├─ ActionTrace 加 chatId 字段 ✅
  ├─ Chats 页面升级为通用 Trace 看板
  └─ /ops/cases/[id]/memory 合并废弃

Phase 5 ─ 性能优化（Phase 3 完成后，可与 Phase 4 并行）
  └─ Fork 模式 cache 共享

Phase 6 ─ LiveChat Bridge ✅
  └─ /api/livechat/webhook 路由 ✅
```

---

## 11. 验证

1. **统一 Loop**：Sub-Agent 执行时 Console Trace 出现 `policy_hit`、`microcompact` 等之前缺失的日志
2. **并发消息**：两个 POST 同时打同一 caseId → 一个 200 SSE + 一个 202；Console Timeline 可见 `queue_message_enqueued` → `queue_message_consumed` → `message_bus_send`
3. **Fork Cache**：3 个并行 investigator → Anthropic `cache_read_input_tokens` > 80%
4. **错误恢复**：模拟 LLM 5xx → Agent 切换 fallback → case 不中断
5. **Agent 树**：Console Timeline 可展开 main → sub → sub-sub 调用树
