# 统一 Agent 重构：审计报告 + 修正架构

> 审计 `doc/what's done/unified-agent-refactor.md` 计划的实施效果，并基于审计结论重新设计架构。
> 核心原则：**最多两种 case 执行模式，SOP 退化为 Skill + 配置，不引入新模式。**

---

## 一、审计结论

### 1.1 总览

```
Phase 1 基础    ████████░░  80%  类型/schema/trace 完成
Phase 2 统一Loop ░░░░░░░░░░   0%  loop.ts 和 sub-agent.ts 完全未动 ← 核心缺失
Phase 3 通信并发 ██████░░░░  60%  session-store 完成，202 未返回
Phase 4 Console  ██████████ 100%  trace + schema 就绪
Phase 5 Fork    ░░░░░░░░░░   0%  没有实现
Phase 6 LiveChat ██████████ 100%  webhook 完成
Phase 7 压缩    ██████░░░░  60%  函数存在，loop.ts 未集成
```

### 1.2 已完成的（✅）

| 模块 | 内容 | 位置 |
|------|------|------|
| **类型系统** | `AgentContext`, `MessageBus`, `ChainTracking`, `AgentMessage` 全部定义 | [`packages/shared/types/index.ts:587-616`](packages/shared/types/index.ts#L587-L616) |
| **Trace** | 9 个新 ActionType + `chatId` 写入 | [`apps/chat/lib/agent/trace.ts:28-82`](apps/chat/lib/agent/trace.ts#L28-L82) |
| **Schema** | `ActionTrace.chatId` + `@@index([chatId])` | [`packages/shared/prisma/schema.prisma:285-295`](packages/shared/prisma/schema.prisma#L285-L295) |
| **Session Store** | `MessageBus` 类 + `CaseSession` + `dequeueNonBlocking()` | [`apps/chat/lib/agent/session-store.ts:25-130`](apps/chat/lib/agent/session-store.ts#L25-L130) |
| **Compaction** | `contextCollapse()` + `reactiveCompact()` 函数 | [`apps/chat/lib/agent/compact.ts:187-206`](apps/chat/lib/agent/compact.ts#L187-L206) |
| **Messages Route** | MessageQueue 并发入队 + 首次 POST 创建 Loop+SSE | [`apps/chat/app/api/messages/route.ts:710-771`](apps/chat/app/api/messages/route.ts#L710-L771) |

### 1.3 核心缺失（❌）

| 缺失项 | 详情 |
|--------|------|
| **`run()` 未接受 `AgentContext`** | [`apps/chat/lib/agent/loop.ts:251-255`](apps/chat/lib/agent/loop.ts#L251-L255) 仍然是 `run(userMessage, rawSendEvent, preIngestedFacts?)` 三个参数 |
| **`isSubAgent` 分支不存在** | `loop.ts` 整个文件没有 `isSubAgent` 检查。终端工具、PolicyEngine、压缩阈值、TraceWriter 全按主 Agent 处理 |
| **`sub-agent.ts` 未被废弃** | [`apps/chat/lib/agent/sub-agent.ts:42-258`](apps/chat/lib/agent/sub-agent.ts#L42-L258) 的 `investigateStreaming()` 仍然是独立 ReAct 循环 |
| **`OrchestratorAgent` 不传 `AgentContext`** | [`apps/chat/lib/agent/orchestrator.ts:513-514`](apps/chat/lib/agent/orchestrator.ts#L513-L514) 直接 `new SubAgent()` → `agent.investigate(task)`，绕过 `AgentLoop` |
| **三层错误恢复全缺** | Model fallback / max_tokens 恢复 / 413 兜底——全部未实现 |
| **Fork 模式全缺** | orchestrator 无同类型检测、无 prompt 前缀共享 |
| **`finalize_sub_agent` 工具不存在** | 仅在 [`apps/chat/lib/agent/orchestrator.ts:76`](apps/chat/lib/agent/orchestrator.ts#L76) 作为提示文本出现，无注册、无 schema、无 handler |

### 1.4 审计总结

**基础设施完成度很高，但核心重构完全未执行。** 类型系统已经为统一做好了全部准备（`AgentContext` 8 个字段齐全、`ChainTracking` 已定义），但执行层没有跟上。计划文档中 Phase 2 标记为 ✅ 与实际代码状态严重不符。

---

## 二、修正架构：两部模式 + 策略层抽象

### 2.1 核心原则

1. **SOP 不是一种模式**——`todo_write`/`todo_read` 回归为普通 `BUILT_IN_SKILLS`，SOP 文档回归为 `StageConfig.sop?: string` prompt 附录
2. **最多两种 case 执行模式**——`stage`（高灵活性）和 `step`（高确定性）
3. **统一 Loop 引擎**——主 Agent 和 Sub-Agent 共用 `runReActLoop()`，通过 `ExecutionPolicy` 接口区分行为
4. **不引入第三种模式**

### 2.2 两种 Case 执行模式

| | Stage 模式 | Step 模式 |
|---|---|---|
| **执行主导** | LLM 在阶段内自主规划 | 引擎按步骤序列强制执行 |
| **工具约束** | 建议性（`requiredSkills`/`availableSkills`） | 强制性（每步 `requiredTools` 白名单） |
| **完成判断** | `evaluateTransition()` LLM 评估 | 每步 `completionCriteria` 自动检查 |
| **失败处理** | nudge → 人工 | `onFailure: retry \| skip \| escalate \| abort` |
| **确定性** | 低~中 | 高 |
| **适用场景** | 一般客服工单 | 提现审核、KYC 验证、风控 |
| **Console 配置** | 配置阶段目标 + 工具建议 | 配置每步的强制工具 + 验证条件 |

两种模式共用同一套基础设施：
- 同一个 `StageExecutor`（阶段过渡评估）
- 同一个 `PolicyEngine`（preTool/postTool/preFinalize 安全检查）
- 同一个 `CaseMemoryManager`（四层记忆结构）
- 同一个 `StreamingToolExecutor`（并发调度 + Zod 校验）

### 2.3 类型定义

```typescript
// packages/shared/types/index.ts

// ── CaseSchemaConfig ──────────────────────────────────────────

interface CaseSchemaConfig {
  type: CaseType
  displayName: string
  stages: string[]
  stageConfigs?: Record<string, StageConfig>
  defaultGoal: string
  escalateOn: string[]

  /** Case 执行模式："stage" = LLM驱动（默认），"step" = 引擎驱动 */
  executionMode: 'stage' | 'step'

  /** SOP 文档（prompt 附录，两种模式均可引用，非独立模式） */
  sop?: string

  // 移除: requireHumanReview, autoCloseConditions — 这些下沉到 StageConfig.exitRules
}

// ── StageConfig ───────────────────────────────────────────────

interface StageConfig {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number

  // 工具约束（两种模式共用，语义不同）
  requiredSkills?: string[]    // stage: 建议必须调用 | step: 引擎强制
  availableSkills?: string[]   // stage: 允许列表 | step: 忽略，用 stepConfig

  // 安全
  guardrails?: StageGuardrail[]
  evidenceRequirements?: EvidenceRequirement[]

  // 阶段过渡
  transition?: StageTransitionRule

  // Sub-Agent（两种模式共用）
  subAgents?: SubAgentConfig[]

  /** Step 模式专用：步骤序列。非空时 Stage 进入 Step 执行。 */
  steps?: ExecutionStep[]

  /** SOP prompt 附录（两种模式均可引用） */
  sop?: string
}

// ── Step 模式：ExecutionStep ──────────────────────────────────

interface ExecutionStep {
  id: string
  name: string
  goal: string                             // 注入 prompt：这一步要达成什么

  /** 此步骤必须调用的工具（引擎强制执行） */
  requiredTools: string[]

  /** 此步骤可选调用的工具 */
  optionalTools?: string[]

  /** 步骤完成的验证条件 */
  completionCriteria: StepCriterion[]

  /** 失败处理 */
  onFailure: {
    action: 'retry' | 'skip_step' | 'escalate_to_human' | 'abort_case'
    escalationQueue?: string
    escalationNote?: string
  }

  maxRetries?: number     // 默认 2
  timeoutMs?: number      // 默认 30s
}

interface StepCriterion {
  type: 'tool_called' | 'fact_extracted' | 'output_matches' | 'llm_evaluation'
  value: string           // tool_called: 工具名 | fact_extracted: factKey | output_matches: JSON schema | llm_evaluation: 评估 prompt
}

// ── SubAgentConfig（扩展）─────────────────────────────────────

interface SubAgentConfig {
  name: string
  model: string
  systemPrompt: string
  skills: string[]
  taskTemplate: string
  maxIterations?: number
  parallel: boolean
}

// ── AgentContext（已定义，类型就绪）────────────────────────────

interface AgentContext {
  agentId: string
  chainId: string
  depth: number
  parentAgentId?: string
  allowedTools: Set<string>
  isSubAgent: boolean
  maxIterations: number
  messageBus: MessageBus

  /** Sub-Agent 专属：orchestrator 注入的 task checklist */
  taskChecklist?: {
    goal: string
    requiredChecks: string[]
    outputFormat: string
    rules: string[]
  }
}
```

### 2.4 统一 Loop 架构

```
                          runReActLoop(ctx, policy)
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
           DiscoveryPolicy   StagePolicy     StepPolicy
           (会话模式)         (高灵活性)       (高确定性)
                  │               │               │
           CORE_ALLOWED     StageExecutor   StepExecutor
           _TOOLS           .filterTools()  .enforceStep()
                            .evaluateTrans  .checkCriteria()
                            ition()         .handleFailure()
                                  │               │
                                  └───────┬───────┘
                                          │
                                   ChecklistPolicy
                                   (Sub-Agent)
                                          │
                                   task checklist
                                   finalize_sub_agent
```

**关键**：

- `runReActLoop()` 封装了 ReAct 迭代、流式调用、工具执行、错误恢复、上下文压缩——所有 Agent 共享
- `ExecutionPolicy` 接口封装了 prompt 组装、工具过滤、继续条件、终端工具处理——各模式各自实现
- `SubAgent` 不再有自己的循环——它通过 `ChecklistPolicy` 复用同一个 `runReActLoop()`

### 2.5 ExecutionPolicy 接口

```typescript
// apps/chat/lib/agent/policies/types.ts

interface ExecutionPolicy {
  /** 组装系统提示词 */
  buildPrompt(basePrompt: string): string

  /** 过滤可用工具 */
  filterTools(allTools: Tool[], iteration: number): Tool[]

  /** 判断循环是否继续 / 过渡 / 终止 */
  evaluateContinuation(
    lastMessage: Message,
    toolResults: ToolResult[],
    iteration: number,
  ): ContinueDecision

  /** 处理终端工具，返回是否截获 */
  handleTerminalTool(toolName: string, input: unknown): TerminalToolResult | null
}

type ContinueDecision =
  | { action: 'continue' }
  | { action: 'transition'; nextStage: string }
  | { action: 'complete_task'; result: SubAgentResult }
  | { action: 'stop'; reason: string; isError?: boolean }

type TerminalToolResult =
  | { type: 'handled'; result: LoopResult }
  | { type: 'not_handled' }
```

四种实现：

| 实现 | 适用 | prompt | 工具过滤 | 继续条件 | 终端工具 |
|------|------|--------|---------|---------|---------|
| `DiscoveryPolicy` | 无 case 的会话 | Core prompt | `CORE_ALLOWED_TOOLS` | 无工具调用时返回 | `create_case`, `propose_cases` |
| `StagePolicy` | `executionMode: 'stage'` | Stage prompt + SOP 附录 | `availableSkills` 白名单 + nudge 收缩 | `StageExecutor.evaluateTransition()` | `finalize_case`, `create_human_task` |
| `StepPolicy` | `executionMode: 'step'` | Step prompt + 当前步骤 goal | 当前 step 的 `requiredTools` ∪ `optionalTools` | `StepExecutor.checkCriteria()` → 下一步 或 阶段过渡 | 同 StagePolicy |
| `ChecklistPolicy` | Sub-Agent | task checklist prompt | `allowedTools` 白名单 | 所有 required checks 完成 或 无工具调用 | `finalize_sub_agent` |

### 2.6 关键差异：Stage vs Step 执行流

**Stage 模式**（LLM 驱动）：

```
Stage "investigation" 开始
  → LLM 收到 prompt: "当前阶段: investigation, 需要: query_order, check_payment"
  → LLM 自主决定: 先调 query_order → 分析结果 → 再调 check_payment
  → LLM 决定何时过渡: "我认为证据足够了" → evaluateTransition() 确认 → 下一 stage
```

**Step 模式**（引擎驱动）：

```
Stage "investigation" 开始, 含 3 个 Step
  → Step 1 "核查支付渠道": 引擎白名单 = [query_payment_channel_status]
    → LLM 调用了 query_payment_channel_status ✓
    → completionCriteria: tool_called=query_payment_channel_status ✓
    → 引擎自动推进到 Step 2
  → Step 2 "对比交易记录": 引擎白名单 = [get_transaction_history]
    → LLM 调用了 get_transaction_history ✓
    → completionCriteria: tool_called=get_transaction_history ✓, llm_evaluation="交易记录中有匹配金额" ✓
    → 引擎自动推进到 Step 3
  → Step 3 "判定结果": 引擎白名单 = [finalize_case, create_human_task]
    → LLM 选择了 finalize_case
    → completionCriteria: tool_called=finalize_case ✓
    → 所有 Step 完成 → evaluateTransition() → 下一 stage
```

### 2.7 `todo_write`/`todo_read` 的定位

**回归为普通 Skill**，不再与"模式"绑定：

```typescript
// apps/chat/lib/agent/skills.ts — BUILT_IN_SKILLS 中增加

{
  name: 'todo_write',
  description: '创建或更新结构化待办事项列表...',
  inputSchema: { type: 'object', properties: { todos: { ... } } },
  mode: 'mock',
  isConcurrencySafe: true,
  enabled: true,
},
{
  name: 'todo_read',
  description: '读取当前待办事项列表...',
  inputSchema: { type: 'object', properties: {} },
  mode: 'mock',
  isConcurrencySafe: true,
  enabled: true,
}
```

- **Stage 模式**：LLM 可以**自主选择**调用 `todo_write` 来规划复杂调查
- **Step 模式**：引擎**自动注入** `todo_write`/`todo_read` 到工具列表，用于追踪 Step 进度
- **Sub-Agent**：默认不使用。若 `SubAgentConfig` 中配置了 `skills: ['todo_write', 'todo_read', ...]`，则可用

### 2.8 `finalize_sub_agent` 工具定义

当前仅以提示文本存在，需注册为正式工具：

```typescript
// apps/chat/lib/agent/skills.ts

{
  name: 'finalize_sub_agent',
  description: '子代理完成任务后调用，将调查结果返回给主 Agent。调用后子代理循环终止。',
  inputSchema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: { type: 'object', properties: { key: { type: 'string' }, value: {} } },
        description: '调查发现的事实列表'
      },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: '支持结论的证据引用'
      },
      recommendation: { type: 'string', description: '建议的后续行动' },
    },
    required: ['findings', 'recommendation']
  },
  mode: 'mock',
  isConcurrencySafe: false,
  enabled: true,
  // 终端工具：SubAgent 调用后循环终止
  terminalForSubAgent: true,
}
```

## 三、改造后的文件变更清单

相比原计划（`doc/what's done/unified-agent-refactor.md` §9），变更如下：

| 文件 | 操作 | 说明 |
|------|------|------|
| `loop.ts` | **重构** | `run()` 接受 `AgentContext`；提取 `runReActLoop()` 统一循环；按 `ExecutionPolicy` 分支 |
| `sub-agent.ts` | **废弃独立循环** | 改为 `SubAgent.run(ctx)` 内部调用 `AgentLoop.runReActLoop(ctx, new ChecklistPolicy(...))` |
| `orchestrator.ts` | **修改** | `dispatch()` 传递 `AgentContext`（chainId/depth+1/parentAgentId/taskChecklist）；检测同类型启用 Fork |
| `session-store.ts` | ✅ 已完成 | MessageBus + MessageQueue |
| `compact.ts` | ✅ 已完成 | contextCollapse + reactiveCompact |
| `trace.ts` | ✅ 已完成 | 9 个新 ActionType + chatId |
| `skills.ts` | **修改** | 增加 `todo_write`/`todo_read`/`finalize_sub_agent`；增加 `createSystemSkill()` 工厂 |
| `case-agent-loop.ts` | **简化** | `isSopMode()` 移除；`buildSopPrompt()` 合并进 `StagePolicy` |
| `stage-executor.ts` | **修改** | 增加 `evaluateStepCompletion()` 方法 |
| **新增** `policies/types.ts` | **新增** | `ExecutionPolicy` 接口 + `ContinueDecision` 类型 |
| **新增** `policies/discovery-policy.ts` | **新增** | 会话模式策略（替代 `ConversationLoop` 独立逻辑） |
| **新增** `policies/stage-policy.ts` | **新增** | Stage 模式策略（委托 `StageExecutor`） |
| **新增** `policies/step-policy.ts` | **新增** | Step 模式策略（引擎强制执行步骤序列） |
| **新增** `policies/checklist-policy.ts` | **新增** | Sub-Agent 策略（task checklist） |
| `types/index.ts` | **扩展** | 增加 `ExecutionStep`, `StepCriterion`, `StepFailurePolicy`；`CaseSchemaConfig.executionMode` 改为 `'stage' | 'step'` |
| `schema.prisma` | ✅ 已完成 | ActionTrace.chatId + index |

## 四、实施顺序

```
Phase 1 — 基础（代码库已有 80%，补齐剩余）
  ├─ createSystemSkill() 工厂 + SKILL_DEFAULTS
  ├─ todo_write / todo_read / finalize_sub_agent 注册
  ├─ ExecutionPolicy 接口定义
  └─ reactiveCompact 接入 loop.ts

Phase 2 — 统一 Loop（本次核心）
  ├─ AgentLoop.run() 改为接受 AgentContext
  ├─ runReActLoop() 提取：ReAct 迭代 + 流式调用 + 工具执行 + 错误恢复 + 压缩
  ├─ DiscoveryPolicy 实现（替代 ConversationLoop 独立逻辑）
  ├─ StagePolicy 实现（委托 StageExecutor）
  ├─ StepPolicy 实现（引擎强制执行 Step 序列）
  ├─ ChecklistPolicy 实现（Sub-Agent）
  ├─ sub-agent.ts 废弃独立循环，改为复用 runReActLoop
  ├─ OrchestratorAgent 传递 AgentContext + taskChecklist
  └─ 三层错误恢复接入 runReActLoop

Phase 3 — Fork + 通信
  ├─ Fork 模式：同类型 SubAgent 共享 prompt 前缀
  └─ MessageBus 接入 OrchestratorAgent

Phase 4 — Console
  ├─ Step Builder UI（apps/console/app/admin/agent/ 新增 step 编辑器）
  ├─ SOP 文档编辑器（不再与 "mode" 绑定）
  └─ Run History 树形图（基于已有的 chainId/depth trace）
```

## 五、验证

1. **统一 Loop**：Sub-Agent 执行时 Console Trace 出现 `policy_hit`、`microcompact`、`agent_tree_node`（depth=1）等之前缺失的日志
2. **Step 模式**：配置 3 个 Step 的 case → 引擎自动逐 Step 推进 → Step 2 超时 → `escalate_to_human`
3. **Sub-Agent 复用**：`sub-agent.ts` 的 `investigateStreaming()` 被移除，`SubAgent.run()` 调用 `AgentLoop.runReActLoop()`
4. **todo_write 普适**：Stage 模式中 LLM 自主调用 `todo_write` 规划复杂调查；Step 模式中引擎自动注入
5. **错误恢复**：模拟 LLM 5xx → 切换 fallback → Agent 不中断
