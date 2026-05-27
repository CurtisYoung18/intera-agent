# Intera Agent — 修复与测试计划

## Context

基于架构师对 S1-S6 代码审计的结果，项目存在三个层级的问题：

1. **P0 — 生产事故级别**：主循环无重试导致瞬时网络错误直接升级人工、mid-stream silent break 破坏消息不变量、子代理硬编码模型+无重试、dispatch_subagent 是死代码
2. **P1 — 稳定性/体验问题**：S4 双工具系统并存（旧系统生产、新系统死代码）、renderHints 链路断开、5 个 LLM 调用站点缺少重试、零测试
3. **P2 — 完善性工作**：SOP→CC 重命名、DB 迁移、dashboards、Human Ops 频道配置 UI

**目标**：5 个工作日内从"能跑 happy path"提升到"可演示给客户"，并建立测试基础设施防止回归。

---

## ⚠️ 架构师 review 后的范围调整（2026-05-26）

经审查发现：原计划的 5 天范围超载，且 B2/C3 包含会让 PR 走不通的工程细节。**调整后范围**：

| 计划项 | 原状态 | 调整后 |
|---|---|---|
| A1 / A2 | P0 | P0（修文档 bug 后开工） |
| A3 / A4 | P0 | P0（补 fallback catch） |
| B1（其余 LLM 站点接 withRetry） | P1 | **P1，保留** |
| B2（S4 builtin 接入） | P1 | **推迟**到独立 spec（S4 真正完成需 ≥1 周） |
| B3（renderHints 链路） | P1 | **砍到最小**（只让 executor emit，端到端推迟） |
| C1 / C2（SOP→CC 重命名 + migration） | P2 | **推迟出 5 天窗口**，单独周做 |
| C3（频道差异化 human task） | P2 | **砍到只做 1 条**：LiveChat `human_task_created` 不再静默丢弃 |
| C4（Dashboards） | P2 | 不变，后续 spec |

**新增 Step 0**：A1 开工前先建 trace baseline。详见 §F1。

---

## Fix Plan A: P0 Critical Fixes (Day 1-2)

### A1 — 将 withRetry 接入主循环 Stream 创建

**问题**：[loop.ts:489-510](apps/chat/lib/agent/loop.ts#L489-L510) 直接调用 `anthropicClient.messages.stream()`，try/catch 对任何非 context_overflow 错误直接升级到人工。`withRetry()` 在 [with-retry.ts](apps/chat/lib/agent/api/with-retry.ts) 已完整实现（指数退避+抖动、per-source 策略、model fallback），但从未被调用。

**修改文件**：`apps/chat/lib/agent/loop.ts`

**具体变更**：

1. 在文件顶部添加 import（第 22 行附近）：
```typescript
import { withRetry, CannotRetryError, FallbackTriggeredError } from './api/with-retry'
```

2. 替换第 488-510 行的 stream creation try/catch 块。**注意**：`operation` 内必须用 `ctx.model`（不是 `this.deps.config.model`），否则 FallbackTriggeredError 触发后 withRetry 切到 fallbackModel，operation 仍用老 model = fallback 配了等于没配。

```typescript
// ── S2: Stream creation with classified retry ──
let stream: ReturnType<typeof this.anthropicClient.messages.stream>
try {
  stream = await withRetry(
    async (_client, ctx) => {
      // 注意：streaming API 不通过 withRetry 传入的 client（特定方法），
      // 但 model 必须从 ctx 读取以让 fallback 生效。
      return this.anthropicClient.messages.stream({
        model: ctx.model,                                              // ← ctx.model，不是 this.deps.config.model
        max_tokens: ctx.maxTokensOverride ?? (this.deps.config.maxOutputTokens ?? 4096),
        system: stagePrompt,
        messages: apiMessages,
        tools: stageTools,
        ...(this.deps.config.showThinking ? {
          thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
        } : {}),
      }, { signal: this.abortController.signal })
    },
    {
      querySource: 'main_loop',
      model: this.deps.config.model,
      fallbackModel: this.deps.config.fallbackModel,
      signal: this.abortController.signal,
      onRetry: (info) => {
        sendEvent({
          type: 'retry_pending',
          data: { attempt: info.attempt, delayMs: info.delayMs, errorClass: info.errorClass, message: info.message },
          timestamp: new Date().toISOString(),
        })
      },
    },
    () => this.anthropicClient,
  )
} catch (err) {
  if (err instanceof FallbackTriggeredError) {
    sendEvent({ type: 'error', data: `Model fallback exhausted: ${err.originalModel}`, timestamp: new Date().toISOString() })
    sendEvent({ type: 'escalated', data: { reason: `LLM API error: ${err.reason}` }, timestamp: new Date().toISOString() })
    return { messages: this.messages, transition: 'waiting_human' as const, caseStatus: 'escalated' as const }
  }
  if (err instanceof CannotRetryError && err.errorClass === 'context_overflow') {
    this.messages = reactiveCompact(this.messages)
    await this.traceWriter.write('loop_decision', 'Reactive compact on context overflow', { error: String(err) })
    continue
  }
  if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
    await this.traceWriter.write('loop_decision', 'Stream aborted', { iteration: this.iterationCount })
    await this.writeProfilerSnapshot()
    return { messages: this.messages, caseStatus: this.currentStage as CaseStatus, transition: 'connection_lost', currentStage: this.currentStage, reason: 'connection_lost' }
  }
  const classified = err instanceof CannotRetryError ? err.errorClass : classifyError(err)
  sendEvent({ type: 'error', data: `LLM API error (${classified})`, timestamp: new Date().toISOString() })
  sendEvent({ type: 'escalated', data: { reason: `LLM API error: ${classified}` }, timestamp: new Date().toISOString() })
  return { messages: this.messages, transition: 'waiting_human' as const, caseStatus: 'escalated' as const }
}
```

### ⚠️ A1 的关键边界 — withRetry 对 streaming 的局限

`withRetry` 包裹 `messages.stream(...)` 调用时，只能捕获**流创建瞬间**的错误（连接拒绝、立即 5xx、立即抛出的认证失败）。**一旦 stream 对象成功返回、进入 `for await` 消费循环之后的任何错误（mid-stream ECONNRESET、嵌入式 overloaded_error），withRetry 看不到** —— 那是 A2 的领地。

A1 + A2 联合后能覆盖：
- ✅ 流创建立即失败 → A1 重试
- ✅ 流中途断开 → A2 走 S1 synthesis 兜底 + `connection_lost` 退出
- ❌ 流中途断开后**重新创建流并继续** → 暂不实现（这是 CC 的 `streamFallbackToNonStreaming` 能力，留待 S2 完整版）

**所以现状是：流创建有重试，流消费失败一次就 connection_lost**。这是已知边界，演示前需要客户场景里的网络环境足够稳定到能撑过一次流的消费时长（通常 < 30 秒）。

**工作量**：2 小时
**依赖**：Step 0 trace baseline 已建立
**验证**：模拟网络瞬时失败 2-3 次后成功，验证 retry_pending 事件发送、stream 最终打开、不升级到人工

---

### A2 — 修复 Mid-Stream Silent Break

**问题**：[loop.ts:633](apps/chat/lib/agent/loop.ts#L633) 非连接、非 413 的 stream 错误执行 `break`，退出 while 循环时**跳过了第 675-743 行的 S1 invariant synthesis**。未完成的 tool_use 块没有对应的 tool_result，下一次 API 调用会被 Anthropic 拒绝。

**修改文件**：`apps/chat/lib/agent/loop.ts`

**具体变更**：

1. 在迭代循环开始处（第 478 行 `while` 之后）声明标志变量：
```typescript
let streamFatalError: string | null = null
```

2. 将第 633 行的 `break` 替换为：
```typescript
// Record fatal error — S1 synthesis must run before exit
streamFatalError = errStr
```

3. 在第 743 行之后（S1 invariant synthesis `}` 闭合后，`processTodoTools` 之前）插入：
```typescript
// ── Stream fatal error after synthesis: exit gracefully ──
if (streamFatalError) {
  await this.traceWriter.write('loop_decision', 'Fatal stream error after S1 synthesis', {
    error: streamFatalError, iteration: this.iterationCount,
  })
  sendEvent({ type: 'error', data: `Stream error: ${streamFatalError}`, timestamp: new Date().toISOString() })
  await this.writeProfilerSnapshot()
  return {
    messages: this.messages,
    caseStatus: 'escalated',
    transition: 'error',
    currentStage: this.currentStage,
    reason: 'stream_error',
  }
}
```

**工作量**：1 小时
**依赖**：无
**验证**：构造 mock stream——先 emit content_block_start (tool_use) 再 throw error。验证 S1 synthesis 为该 tool_use 生成了 `is_error: true` 的 tool_result，messages 数组无不匹配的 tool_use 块。

---

### A3 — 修复子代理：模型解硬编码 + 重试 + S1 Invariant

**问题**：[loop.ts:1775](apps/chat/lib/agent/loop.ts#L1775) `runReActLoop` 硬编码 `model: 'claude-sonnet-4-20250514'`、无错误分类/重试、无 S1 invariant synthesis、使用非流式 `messages.create()`。

**修改文件**：
- `apps/chat/lib/agent/loop.ts` — `runReActLoop` 静态方法
- `apps/chat/lib/agent/sub-agent.ts` — `SubAgent.run()` 调用方

**具体变更**：

**loop.ts 变更**：

1. 给 `runReActLoop` 添加 `model` 参数（第 1744 行）：
```typescript
static async runReActLoop(
  client: Anthropic,
  model: string,                    // NEW — 从 sub-agent config 传入
  systemPrompt: string,
  skillDefinitions: SkillDefinition[],
  ctx: AgentContext,
  policy: ExecutionPolicy,
  sendEvent: (event: SSEEvent) => void,
  taskPrompt: string,
  abortController?: AbortController,
): Promise<LoopResult> {
```

2. 替换第 1772-1792 行的 LLM 调用 try/catch。**注意**：要让 sub-agent 在过载时有自救能力，必须传 `fallbackModel` 并 catch `FallbackTriggeredError` 重跑一次。否则 sub-agent 三次 529 后就抛错升人工，主循环 nudge 直至失败。

```typescript
let msg: Anthropic.Messages.Message
let currentModel = model
let currentFallback: string | undefined = subAgentConfig?.fallbackModel  // 见 §A3 第 6 步：从 SubAgentConfig 传入
try {
  msg = await withRetry(
    (innerClient, ctx) => innerClient.messages.create({
      model: ctx.model,           // ← ctx.model，让 fallback 生效
      max_tokens: 4096,
      temperature: 0.3,
      system: stagePrompt,
      tools: stageTools.length > 0 ? stageTools : undefined,
      messages: messages as any,
    }, { signal: ac.signal }),
    {
      querySource: 'sub_agent_loop',
      model: currentModel,
      fallbackModel: currentFallback,
      signal: ac.signal,
    },
    () => client,
  )
} catch (err) {
  if (err instanceof FallbackTriggeredError) {
    // 主路径过载耗尽，已经切到 fallbackModel；记录一次 trace 让 dashboard 能看到
    // 注意：withRetry 内部其实不会再次抛 FallbackTriggeredError 给外层 ——
    // 它会自己用 fallbackModel 重试。所以这个分支理论上不会触发；保留作为防御
    return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: 'model_fallback_exhausted' }
  }
  if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
    return { messages: [], caseStatus: 'escalated' as const, transition: 'connection_lost' as const, reason: 'aborted' }
  }
  if (err instanceof CannotRetryError) {
    return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: `sub_agent_llm_${err.errorClass}` }
  }
  // 真正未知错误 — 抛给上层 sub-agent.run 的 catch
  throw err
}
```

3. 将第 1775 行的硬编码 `model: 'claude-sonnet-4-20250514'` 替换为 `model,`

4. 在工具执行后（第 1884 行 `toolResultBlocks` 构建后、第 1888 行 push 前）添加 S1 invariant：
```typescript
// ── S1: Guarantee one tool_result per tool_use ──
const completedIds = new Set(
  execResults.map((er) => er.toolUse?.id ?? toolUses.find((tu) => tu.name === er.name)?.id ?? '')
)
const missingBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
for (const tu of toolUses) {
  if (!completedIds.has(tu.id)) {
    missingBlocks.push({
      type: 'tool_result' as const,
      tool_use_id: tu.id,
      content: JSON.stringify({ error: 'tool_execution_failed', reason: 'executor_did_not_produce_result' }),
    })
  }
}
const allToolResultBlocks = [...toolResultBlocks, ...missingBlocks]
```

5. 将第 1888 行的 `toolResultBlocks` 替换为 `allToolResultBlocks`：
```typescript
messages.push({ role: 'user' as const, content: allToolResultBlocks })
```

**sub-agent.ts 变更**：

6. 在 `SubAgent.run()` 中传入 model + fallbackModel + 完整 config（约第 100 行）：
```typescript
const loopResult = await AgentLoop.runReActLoop(
  this.client,
  this.config.model,                 // NEW — 从 SubAgentConfig 读取
  this.config,                       // NEW — 完整 config 让 runReActLoop 能读 fallbackModel 等
  this.config.systemPrompt,
  allSkills,
  ctx,
  ...
)
```

**SubAgentConfig 类型补充**：`packages/shared/types/index.ts` 的 `SubAgentConfig` 需要加可选字段 `fallbackModel?: string`。默认 undefined 时不启用 fallback（保守行为）。

**工作量**：3 小时
**依赖**：A1（withRetry import 就绪）
**验证**：创建子代理任务，验证使用 `SubAgentConfig.model` 而非硬编码值。强制 LLM 调用失败 2 次后成功，验证重试生效。模拟 tool_use 块无匹配结果，验证 invariant 合成错误 tool_result。

---

### A4 — 激活 dispatch_subagent（CC/Adaptive 模式）

**问题**：`dispatch-subagent.ts` builtin tool 调用了 `registerBuiltin()` 但模块从未被 import → `BUILTIN_TOOLS` Map 始终为空。Console UI 允许运营配置 CC 模式 + sub-agent 注册表，但引擎永远不调用 dispatch_subagent。

**决策**：暂时走"回退到 SkillRouter"路线——在旧的 `BUILT_IN_SKILLS` 中添加 `dispatch_subagent` 的 SkillDefinition，同时在 loop.ts 中添加拦截逻辑（仿照 `processTodoTools` 模式）。

**修改文件**：
- `apps/chat/lib/agent/skills.ts` — 添加 dispatch_subagent SkillDefinition
- `apps/chat/lib/agent/loop.ts` — 添加 dispatch_subagent 拦截处理
- `apps/chat/lib/agent/orchestrator.ts` — 添加单任务 dispatch 辅助方法

**具体变更**：

**skills.ts 变更**：

1. 在 `BUILT_IN_SKILLS` 数组末尾（约第 838 行，`SOP_INTERNAL_SKILLS` 之前）添加：
```typescript
{
  name: 'dispatch_subagent',
  description:
    'Dispatch a specialist sub-agent to investigate a specific aspect of the case. ' +
    'Available sub-agents are defined in the case type stage configuration. ' +
    'Use this to delegate research tasks to specialized agents.',
  inputSchema: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: 'Name of the sub-agent to dispatch' },
      taskDescription: { type: 'string', description: 'Short human-readable task summary' },
      taskPrompt: { type: 'string', description: 'Detailed investigation instructions for the sub-agent' },
    },
    required: ['agentName', 'taskDescription', 'taskPrompt'],
  },
  isConcurrencySafe: false,
  mode: 'mock',
  enabled: true,
  displayVerb: { text: 'Dispatching specialist agent', icon: 'pulse' },
  zodSchema: z.object({
    agentName: z.string(),
    taskDescription: z.string(),
    taskPrompt: z.string(),
  }),
  mockFixture: { status: 'dispatched', message: 'Sub-agent task dispatched' },
}
```

**loop.ts 变更**：

2. 在 `processTodoTools` 方法附近（约第 1565 行之后）添加新方法 `processDispatchSubagent`：
```typescript
private async processDispatchSubagent(
  toolResults: ToolResult[],
  sendEvent: (event: SSEEvent) => void,
): Promise<ToolResult[]> {
  const dispatchResults: ToolResult[] = []
  for (const tr of toolResults) {
    if (tr.name !== 'dispatch_subagent') {
      dispatchResults.push(tr)
      continue
    }
    const input = tr.output as { agentName?: string; taskDescription?: string; taskPrompt?: string } | undefined
    if (!input?.agentName || !input?.taskPrompt) {
      dispatchResults.push({
        ...tr,
        output: { ok: false, error: 'dispatch_subagent requires agentName, taskDescription, and taskPrompt' },
      })
      continue
    }
    try {
      await this.caseLoop.orchestrator.dispatchSingle(
        input.agentName,
        input.taskDescription ?? input.agentName,
        input.taskPrompt,
        sendEvent,
      )
      dispatchResults.push({ ...tr, output: { ok: true, status: 'dispatched', agentName: input.agentName } })
    } catch (err) {
      dispatchResults.push({
        ...tr,
        output: { ok: false, error: String(err) },
      })
    }
  }
  return dispatchResults
}
```

3. 在 loop.ts 第 749 行 `processTodoTools` 调用之后，添加：
```typescript
// ── Intercept dispatch_subagent (CC mode sub-agent dispatch) ──
if (this.deps.caseSchema?.executionMode === 'cc') {
  toolResults = await this.processDispatchSubagent(toolResults, sendEvent)
}
```

**orchestrator.ts 变更**：

4. 在 `OrchestratorAgent` 类中添加 `dispatchSingle` 方法（约第 115 行 `dispatch` 方法旁）：
```typescript
async dispatchSingle(
  agentName: string,
  taskDescription: string,
  taskPrompt: string,
  sendEvent: (event: SSEEvent) => void,
): Promise<SubAgentResult> {
  const config = this.subAgentConfigs.find(c => c.name === agentName)
  if (!config) throw new Error(`Unknown sub-agent: ${agentName}`)
  
  const task: SubAgentTask = {
    agentConfig: config,
    taskDescription,
    taskPrompt,
  }
  return this.dispatch([task], sendEvent)
}
```

**工作量**：4 小时
**依赖**：A3（子代理修复完成，Orchestrator 可用）
**验证**：配置一个 CC 模式的 case type + sub-agent registry。发送消息触发 dispatch_subagent 调用。验证 orchestrator 收到 dispatch、子代理运行、结果写回 CaseMemory。

---

## Fix Plan B: P1 Stability Fixes (Day 3-4)

### B1 — 所有 LLM 调用站点接入 withRetry

**问题**：项目中有 8 个 LLM 调用站点，A1/A3 只覆盖了 2 个。其余 6 个也缺少重试。

**调用站点清单**：

| # | 文件:行号 | 类型 | QuerySource | 当前状态 |
|---|----------|------|-------------|---------|
| 1 | loop.ts:490 | streaming | main_loop | A1 修复 |
| 2 | loop.ts:1774 | non-streaming | sub_agent_loop | A3 修复 |
| 3 | compact.ts:~144 | non-streaming | compact | 需修复 |
| 4 | consultation-agent.ts:~90 | streaming | consultation_loop | 需修复 |
| 5 | memory.ts:~187 | non-streaming | compact | 需修复 |
| 6 | policy.ts:~358 | non-streaming | policy_eval | 需修复 |
| 7 | stage-executor.ts:~408 | non-streaming | policy_eval | 需修复 |
| 8 | sub-agent.ts:~178 | non-streaming | sub_agent_loop | 需修复（deprecated 路径） |

**修改文件**：
- `apps/chat/lib/agent/compact.ts`
- `apps/chat/lib/agent/consultation-agent.ts`
- `apps/chat/lib/agent/memory.ts`
- `apps/chat/lib/agent/policy.ts`
- `apps/chat/lib/agent/stage-executor.ts`
- `apps/chat/lib/agent/sub-agent.ts`

**具体变更**（每个文件遵循同一模式）：

```typescript
// 替换直接的 client.messages.create() / client.messages.stream() try/catch：
import { withRetry, CannotRetryError } from './api/with-retry'

// 对于 non-streaming 调用：
const response = await withRetry(
  (client) => client.messages.create({ model, max_tokens, ... }, { signal }),
  { querySource: 'compact', model, signal },
  () => this.client,
)

// 对于 streaming 调用（consultation-agent.ts），同时需要 A2 式的 mid-stream 保护：
// stream creation 用 withRetry，stream consumption 的 catch 也要走 synthesis + 优雅退出
```

**compact.ts 特殊处理**：当前 `compactConversation` 函数内部创建 Anthropic client（第 142 行）。withRetry 的 `getClient` 回调也要对应创建。如果 compact 后仍 context_overflow，withRetry 会自动尝试 `maxTokensOverride` 缩减。

**policy.ts / stage-executor.ts 特殊处理**：policy_eval 源策略 `bailOn529: true`——529 不重试直接退出。这符合预期（后台评估不应长时间阻塞）。

**工作量**：4 小时
**依赖**：A1（withRetry 模式经过实战验证）
**验证**：对每个站点模拟 transient_network 错误 2 次，验证重试后成功返回。

---

### B2 — 连接 S4 Builtin Tools 到引擎  🛑 **推迟到独立 spec（S4 完整版）**

**架构师 review 结论**：原计划的 `adaptToolToSkill()` 把 Tool 转成 SkillDefinition 时硬编码 `mode: 'mock'` + 空 `mockFixture` → executor 走的是 `executeMock(definition)` → 返回空对象。**`tool.call()` 实现代码永远不会执行**，结果是"看起来注册了，实际没用"，比"什么都不做"更坏（产生已修复错觉）。

要让 9 个 builtin Tool 真正运行，必须改 `StreamingToolExecutor` 加 builtin 分支：

```typescript
const builtin = getBuiltin(toolUse.name)
if (builtin) {
  output = await builtin.call(parsedInput, this.toolContext)
} else if (definition.mode === 'mock') { /* existing */ }
```

这是 S4 spec 原本要求的工作量（约 1.5–2 周），5 天窗口内不现实。

**5 天窗口的处理**：
1. **不做 B2**。承认 S4 builtin 接入未完成
2. 给 `apps/chat/lib/agent/tools/builtin/` 目录加 README 说明 "wired in a future cycle"
3. dispatch_subagent **必须** 走 A4 的旧系统拦截路径（已在 A4 实现）
4. 9 个 builtin Tool 文件作为下一周独立 spec 的起点保留

**未来的独立 spec**（暂称 S4-impl）需要覆盖：
- StreamingToolExecutor 添加 builtin 分支
- 每个 builtin Tool 单元测试 + 集成测试
- 老的 BUILT_IN_SKILLS 中对应条目删除（避免新旧并存）
- Migration: DB skills 表中如果有同名 system skill 行也要清理

**当前 5 天窗口内的 B2 实施量**：0 小时

---

### B2-original — 原方案存档（不要执行）

下面是原文档的 B2 内容，已识别为陷阱，仅供未来 spec 参考：

**问题**：9 个 `Tool<I,O>` builtin tools 在模块作用域调用了 `registerBuiltin()` 但从未被 import → `BUILTIN_TOOLS` Map 始终为空。执行器走的是旧 `SkillRouter` → `SkillDefinition[]` → `StreamingToolExecutor`。

**策略**：创建 barrel import 触发 side effect + 在 SkillRouter 初始化时加载 builtin tools 并转换为 SkillDefinition。

**修改文件**：
- 新建 `apps/chat/lib/agent/tools/builtin/index.ts` — barrel import
- `apps/chat/lib/agent/skills.ts` — SkillRouter.create() 加载 builtin tools
- 新建 `apps/chat/lib/agent/tools/business/tool-to-skill.ts` — Tool→SkillDefinition 转换器

**具体变更**：

1. 创建 `apps/chat/lib/agent/tools/builtin/index.ts`：
```typescript
// Barrel — triggers registerBuiltin() side effects for all 9 builtin tools
import './create-case'
import './create-human-task'
import './dispatch-subagent'
import './finalize-case'
import './finalize-sub-agent'
import './kb-hybrid-retrieve'
import './read-case-history'
import './todo-read'
import './todo-write'

export { getAllBuiltins, getBuiltin, registerBuiltin, isBuiltin } from '@intera/shared/tools/tool'
```

2. 创建 `apps/chat/lib/agent/tools/business/tool-to-skill.ts`：
```typescript
import type { Tool } from '@intera/shared/tools/tool'
import type { SkillDefinition } from '@intera/shared/types'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function adaptToolToSkill(tool: Tool): SkillDefinition {
  return {
    name: tool.name,
    description: `[S4] ${tool.name}`,
    inputSchema: zodToJsonSchema(tool.inputSchema) as SkillDefinition['inputSchema'],
    isConcurrencySafe: tool.isConcurrencySafe(),
    mode: 'mock',
    enabled: tool.isEnabled(),
    displayVerb: tool.displayVerb ?? { text: `Calling ${tool.name}`, icon: 'dots' },
    zodSchema: tool.inputSchema,
    mockFixture: {},
  }
}
```

3. 在 `skills.ts` 的 `SkillRouter.create()` 方法中（约第 877 行，DB skills 加载完成后），添加：
```typescript
// Load S4 builtin Tool<I,O> tools
try {
  const { getAllBuiltins } = await import('./tools/builtin')
  const { adaptToolToSkill } = await import('./tools/business/tool-to-skill')
  for (const tool of getAllBuiltins()) {
    if (!router.skills.has(tool.name)) {
      router.skills.set(tool.name, adaptToolToSkill(tool))
    }
  }
} catch (err) {
  console.warn('[SkillRouter] Failed to load S4 builtin tools:', err)
}
```

**重要**：`zod-to-json-schema` 是新的依赖，需要安装。可通过动态 import 处理，使得它在未安装时 graceful degrade。

**工作量**：4 小时
**依赖**：A4（dispatch_subagent 需要被 SkillRouter 发现）
**验证**：启动 app，验证 `getAllBuiltins()` 返回 9 个工具。验证 `SkillRouter.getToolDefinitions()` 包含 builtin tools。

---

### B3 — 将 renderHints 接入 SSE Event Payload  ✂️ **砍到最小范围**

**架构师 review 结论**：完整端到端需要：(a) 类型加字段、(b) Prisma 加列 + migration、(c) BUILT_IN_SKILLS 25 个内置 skill 各配 hints、(d) 编辑器 UI、(e) renderer 消费。**3 小时不够，约需 1 天**。

**5 天窗口砍后版本**：只做 (a) 和 (e) 的两条：
1. **`SkillDefinition` 类型加可选 `renderHints` 字段**（不改 DB，不强制配）
2. **StreamingToolExecutor 在 `tool_executing` / `skill_result` SSE 事件 payload 中带上 `renderHints`**（即使为 undefined，pipeline 也跑通）
3. **LiveChatRenderer 修复 `human_task_created` 不再静默丢弃**（这一条本来在 C3 里，挪到 B3 因为它也是 renderer 链路缺失的症状之一）

(b)(c)(d) 推迟到 renderHints 完整版 spec。

**修改文件**：
- `apps/chat/lib/agent/streaming-tool-executor.ts` — SSE 事件发送时携带 renderHints（可能是 undefined）
- `apps/chat/channels/livechat/renderer.ts` — 添加 `human_task_created` 处理
- `packages/shared/types/index.ts` — SkillDefinition 加 renderHints 可选字段

**不做的部分**：
- ❌ Prisma migration（DB 不动）
- ❌ BUILT_IN_SKILLS 25 个内置 skill 配 hints（保持 undefined，走 channel default fallback）
- ❌ Console 编辑器 UI

**工作量**：1.5 小时（原 3 小时）
**依赖**：无（不依赖 B2）
**验证**：单测 LiveChatRenderer 收到 `human_task_created` 事件不再返回 `noop`；executor 发出的 SSE event payload 包含 `renderHints` 字段（即使为 undefined）。

---

### B3-original — 原方案存档（推迟到完整 spec）

**问题**：`Tool<I,O>.renderHints` 类型和 `ChannelBindingConfig` 已定义，但引擎从不将 `renderHints` 放入 SSE 事件 payload → `LiveChatRenderer` 永远收不到 render hints → per-tool 渲染提示链完全断开。

**修改文件**：
- `apps/chat/lib/agent/streaming-tool-executor.ts` — SSE 事件发送时携带 renderHints
- `apps/chat/lib/agent/loop.ts` — 构建 renderHints map 传给 executor
- `apps/chat/lib/livechat/bridge.ts` — 修复 `human_task_created` 的 noop 问题
- `apps/chat/channels/livechat/renderer.ts` — 添加 `human_task_created` 处理
- `packages/shared/types/index.ts` — SkillDefinition 添加 renderHints 字段

**具体变更**：

1. 给 `SkillDefinition` 类型（[types/index.ts](packages/shared/types/index.ts) 约第 81 行）添加可选字段：
```typescript
renderHints?: Partial<Record<Channel, RenderHint>>
```

2. 在 `StreamingToolExecutor` ([streaming-tool-executor.ts](apps/chat/lib/agent/streaming-tool-executor.ts)) 的 `onStatusChange` 回调中，给 `tool_executing` 和 `skill_result` 事件的 data payload 添加 `renderHints` 字段。

3. 在 [loop.ts:418-430](apps/chat/lib/agent/loop.ts#L418-L430) 创建 `StreamingToolExecutor` 时，将工具的 `renderHints` 传入 executor 或通过闭包访问 `skillRouter.getToolDefinitions()` 的 renderHints。

4. **修复 LiveChat renderer 丢弃 `human_task_created`**：在 [renderer.ts](apps/chat/channels/livechat/renderer.ts) 的 `translateEvent` switch 中添加：
```typescript
case 'human_task_created':
  return {
    type: 'send_widget_payload',
    payload: {
      widgetType: 'notification',
      data: {
        title: 'Escalated to Specialist',
        message: event.data?.question || 'A human operator has been notified',
        severity: 'info',
        taskId: event.data?.taskId,
      },
    },
  }
```

5. 在 [bridge.ts:151](apps/chat/lib/livechat/bridge.ts#L151) `RenderContext` 构建时，从 `ChannelBindingConfig` 中读取 `channelSkillBinding` 并传给 renderer：
```typescript
const binding: ChannelBindingConfig = {
  channel: 'livechat',
  enabled: true,
  credentials: config,
  channelSkillBinding: config.channelSkillBinding,  // 从 DB 配置传入
}
```

**工作量**：3 小时
**依赖**：B2（builtin tools 有 renderHints 才有意义）
**验证**：发送一条包含 tool_executing 的 SSE 事件，验证 LiveChatRenderer.render() 收到 renderHints。验证 `human_task_created` 事件不再被静默丢弃。

---

## Fix Plan C: P2 Polish + Human Ops Channel Config (Day 5+)

> **架构师 review 调整**：
> - **C1 / C2 推迟出 5 天窗口** — 全项目重命名 + Prisma migration 风险高，需要 grep 干净 + 部署窗口规划，应该作为独立周做
> - **C3 砍到只做 1 条** — LiveChat `human_task_created` 事件不再静默丢弃。`humanTaskBehavior` 4 模式配置化是新设计（S5 spec 里没有），范围太大，推迟
> - **C4 dashboards** — 不变，未来 spec

---

### C1 — SOP → CC 重命名 + 数据迁移  🛑 **推迟到独立周**

**问题**：代码库中 "SOP"（Standard Operating Procedure）和 "CC"（Claude Code）混用。DB schema 使用 `executionMode: 'sop'`，代码中规范化为 `'cc'`。

**修改范围**（全项目搜索替换）：
- 常量值：`'sop'` → `'cc'`（executionMode 字段、schema 默认值、DB enum 值）
- 变量名：`sopDoc` → `ccDoc`, `isSopMode` → `isCcMode`, `buildSopPrompt` → `buildCcPrompt`, `filterSopTools` → `filterCcTools`, `sopInternalNames` → `ccInternalNames`, `SOP_INTERNAL_SKILLS` → `CC_INTERNAL_SKILLS`
- 注释/字符串：所有 "SOP mode" / "SOP execution" → "CC mode" / "Autonomous execution"
- DB migration：添加 Prisma migration 更新 `CaseType.executionMode` 的默认值

**关键文件**：
- [skills.ts:792](apps/chat/lib/agent/skills.ts#L792) — `SOP_INTERNAL_SKILLS`
- [loop.ts:458,929,1103,1260](apps/chat/lib/agent/loop.ts) — `executionMode === 'cc'` 检查
- [case-agent-loop.ts:119,128,196](apps/chat/lib/agent/case-agent-loop.ts) — sop 相关方法
- [shared/types/index.ts](packages/shared/types/index.ts) — `CaseSchemaConfig.executionMode` 类型
- [prisma/schema.prisma](packages/shared/prisma/schema.prisma) — `CaseType.executionMode` 字段

**工作量**：2 小时

---

### C2 — DB Migrations  🛑 **推迟到独立周（跟 C1 一起做）**

**Prisma Schema 变更** ([schema.prisma](packages/shared/prisma/schema.prisma))：

1. `CaseType.executionMode` 默认值从 `'sop'` 改为 `'cc'`
2. 验证 `ChannelBinding` 模型的 `toolOverrides`, `defaults`, `channelSkillBinding` JSON 列已存在（402-416 行确认存在）
3. 为 `HumanTask` 模型添加 `channel` 字段（用于频道差异化路由）：
```prisma
model HumanTask {
  // ...existing fields...
  channel   String?  // 'web-chat' | 'livechat' | 'slack' | etc.
}
```

**工作量**：2 小时

---

### C3 — Human Ops 频道配置 UI  ✂️ **砍到最小：只修一个 bug**

**架构师 review 结论**：原 C3 包含 6 个改动（CRUD API、Integrations 表单、Human Ops 页面 UI、引擎差异化逻辑、LiveChat renderer 完善、binding 类型扩展），引入了 S5 spec 里没有的新设计 `humanTaskBehavior` 4 模式枚举。**估时 6 小时不够，至少 1.5–2 天**，且超出 demo 必要范围。

**5 天窗口砍后版本**：只做 1 条（已挪到 B3 的 §3）：
- ✅ LiveChat renderer 的 `human_task_created` 事件不再 `noop`，发 widget 通知

**推迟的部分**（待独立 spec）：
- ❌ `humanTaskBehavior` 4 种行为模式（db_task / widget_notify / transfer / silent）
- ❌ Channel binding CRUD API
- ❌ Integrations 页面频道技能绑定表单
- ❌ Human Ops 页面 Per-Channel Human Task Behavior section
- ❌ 引擎按 binding 决定 SSE 事件类型的逻辑

**5 天窗口内的实施量**：0 小时（已被 B3 覆盖）

---

### C3-original — 原方案存档（推迟到完整 spec）

**问题**：
1. `create_human_task` 在所有频道上行为统一（创建 DB task），但不同频道需要差异化行为——LiveChat 应发送 widget payload 而不是静默创建 task；Slack 应发送消息到频道
2. `ChannelBindingConfig.channelSkillBinding` 从未在 UI 中配置
3. Human Ops 页面的 Operator Queues 没有频道概念
4. Integrations 页面有 placeholder "Channel-to-skill binding — available in a future release"

**修改文件**：
- `apps/console/app/admin/human-ops/page.tsx` — 添加频道绑定 UI
- `apps/console/app/admin/integrations/page.tsx` — 替换 placeholder 为实际的频道绑定表单
- `apps/console/app/api/admin/channel-binding/route.ts` — 新建 CRUD API
- `apps/chat/lib/livechat/bridge.ts` — 使用 `channelSkillBinding` 过滤工具
- `apps/chat/channels/livechat/renderer.ts` — 完善 `human_task_created` 处理

**具体变更**：

#### 3a. Channel Binding CRUD API

新建 `apps/console/app/api/admin/channel-binding/route.ts`：
```typescript
// GET /api/admin/channel-binding?customerId=xxx — 列出所有 channel bindings
// PUT /api/admin/channel-binding — 创建/更新单个 channel binding
// DELETE /api/admin/channel-binding?channel=xxx — 删除
```

API 直接读写 Prisma `ChannelBinding` 表。

#### 3b. Integrations 页面——频道技能绑定表单

替换 [integrations/page.tsx:256-259](apps/console/app/admin/integrations/page.tsx#L256-L259) 的 placeholder：

添加一个新的 UI section "Channel Skill Binding"：
- 选择频道（livechat/slack/discord/whatsapp）
- 开关 `enabled`
- 技能 allowlist（多选，从可用技能列表中选择）
- Per-tool render hints 重写（可选，如设置 CardHint 的 buttonStyle）
- Channel defaults 配置（plain/card/form 渲染默认值）

```tsx
// 替换 placeholder 为：
<div className="mt-4 space-y-3">
  <h3 className="text-[13px] font-semibold text-[var(--mist)]">Channel Skill Binding</h3>
  <p className="text-[11px] text-[var(--fog)]">Control which skills are available per channel</p>
  
  {/* Skill allowlist */}
  <label className="space-y-1.5 block">
    <span className="text-[11px] text-[var(--fog)]">Allowed Skills</span>
    <div className="flex flex-wrap gap-1.5">
      {availableSkills.map(skill => (
        <button
          key={skill}
          onClick={() => toggleSkillBinding(skill)}
          className={`px-2 py-1 rounded text-[11px] transition-colors ${
            boundSkills.includes(skill)
              ? 'bg-indigo text-white'
              : 'bg-black/[0.04] text-[var(--fog)]'
          }`}
        >
          {skill}
        </button>
      ))}
    </div>
  </label>
</div>
```

#### 3c. Human Ops 页面——按频道配置 human task 行为

在 [human-ops/page.tsx](apps/console/app/admin/human-ops/page.tsx) 的 Operator Queues section 下方添加新的 "Per-Channel Human Task Behavior" section：

```tsx
{/* ── Per-Channel Human Task Behavior ── */}
<div className="mt-8">
  <h2 className="text-[14px] font-semibold text-[var(--mist)] mb-4">
    Per-Channel Human Task Behavior
  </h2>
  <p className="text-[11px] text-[var(--fog)] mb-4">
    Configure how create_human_task behaves on each channel.
  </p>
  
  <div className="space-y-3">
    {CHANNELS.filter(c => !c.comingSoon).map(channel => (
      <div key={channel.id} className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-[var(--mist)]">{channel.label}</span>
          <select
            value={channelBehaviors[channel.id] ?? 'db_task'}
            onChange={(e) => setChannelBehavior(channel.id, e.target.value)}
            className="glass-input-console text-[12px] w-40"
          >
            <option value="db_task">DB Task (default)</option>
            <option value="widget_notify">Widget Notification</option>
            <option value="transfer">Chat Transfer</option>
            <option value="silent">Silent (no notification)</option>
          </select>
        </div>
        {channelBehaviors[channel.id] === 'widget_notify' && (
          <div className="text-[11px] text-[var(--fog)] bg-black/[0.02] p-3 rounded-lg">
            The LiveChat renderer will send a widget payload with the human task question.
            The task is still created in DB for operator tracking.
          </div>
        )}
        {channelBehaviors[channel.id] === 'transfer' && (
          <div className="text-[11px] text-[var(--fog)] bg-black/[0.02] p-3 rounded-lg">
            The chat will be transferred to an operator queue immediately.
            No intermediate task record is created.
          </div>
        )}
      </div>
    ))}
  </div>
</div>
```

#### 3d. 引擎层——按频道差异化 human task 行为

在 `create_human_task` tool 执行后，引擎根据 `ChannelBindingConfig` 中的 `humanTaskBehavior` 字段决定 SSE 事件内容：

```typescript
// 在 StreamingToolExecutor 或 case-agent-loop.ts 中：
const channelBinding = this.deps.channelBindings?.[channel]
const behavior = channelBinding?.humanTaskBehavior ?? 'db_task'

switch (behavior) {
  case 'widget_notify':
    sendEvent({ type: 'human_task_created', data: { taskId, question: input.question, channel, notify: true } })
    break
  case 'transfer':
    sendEvent({ type: 'escalated', data: { reason: 'human_task_created', taskId, channel } })
    break
  case 'db_task':
  default:
    sendEvent({ type: 'human_task_created', data: { taskId, question: input.question, channel } })
    break
}
```

#### 3e. LiveChat Renderer——根据行为类型渲染

更新 [renderer.ts](apps/chat/channels/livechat/renderer.ts) 的 `human_task_created` case：
```typescript
case 'human_task_created':
  if (event.data?.notify) {
    return {
      type: 'send_widget_payload',
      payload: {
        widgetType: 'notification',
        data: {
          title: 'Escalated to Specialist',
          message: event.data.question || 'A human operator will respond shortly.',
          severity: 'info',
        },
      },
    }
  }
  // Default: silent DB task — no user-visible action
  return { type: 'noop' }
```

#### 3f. ChannelBindingConfig 类型扩展

在 [binding.ts](packages/shared/channels/binding.ts) 添加：
```typescript
export interface ChannelBindingConfig {
  // ...existing fields...
  humanTaskBehavior?: 'db_task' | 'widget_notify' | 'transfer' | 'silent'
}
```

Prisma `ChannelBinding` 模型添加对应 JSON 列。

**工作量**：6 小时
**依赖**：B3（renderer 链路已通）、C2（DB migration）
**验证**：在 Console 配置 LiveChat 频道的 human task behavior 为 "Widget Notification"。通过 LiveChat 触发 create_human_task。验证 LiveChat 用户收到 widget 通知。在 Console 改回 "DB Task"。验证用户不再收到通知。

---

### C4 — Dashboards、Admin Panels（后续工作）

- 运营 dashboard：case 监控、sub-agent 成功率、平均延迟
- renderHints editor：Console skill 配置页
- engine internals admin panel：运行时状态查看

这些属于 P2 范围，5 天窗口内暂不详细展开。建议另开独立 spec（S7）。

---

## Fix Plan F: Step 0 — Trace Baseline (开工前必做)

### F1 — 建立 trace baseline

**目的**：A1–A4 都是行为改动。没有基线就无法证明"修了 P0 没引入新问题"。架构师 review 强烈要求：在 A1 开工**之前**捕获当前代码的 trace 序列作为对照。

**步骤**：
1. 启动当前 `main` 分支的 dev 环境
2. 在 console 上跑一遍固定的演示场景：
   - 客户消息 "我的提现还没到账"
   - 收到工具调用 → 等待 case 创建
   - 客户消息 "txn_id 是 TX2026..."
   - 等到 finalize 或 timeout
3. 从 `prisma.trace.findMany({ where: { chatId: ... } })` 导出 trace JSON
4. 保存为 `apps/chat/lib/agent/__tests__/baseline/withdrawal_case_pre_a1.jsonl`
5. 同时保存最终的 `messages` 数组 + `LoopResult` 到 `withdrawal_case_pre_a1_result.json`

**修改后比对**：
- 每完成一个 A 块，重跑同样场景
- 比对：trace 事件 actionType 序列、最终 LoopResult.transition、messages 数组结构
- 允许差异：timestamps、UUIDs、retry 相关新增事件、model echo（如果走到 fallback）
- 不允许差异：业务 actionType 缺失或新增、LoopResult.transition 改变、messages 中 tool_use 与 tool_result 配对关系

**工作量**：1 小时（开工前）
**依赖**：无
**验证**：baseline 文件存在、可读、能被未来测试加载

---

## Test Infrastructure Plan

### D1 — 引入 Vitest

**当前状态**：零测试文件、零测试框架。`package.json` devDependencies 仅 `playwright` 和 `@types/bcryptjs`。

**修改文件**：
- 根 `package.json` — 添加 vitest 依赖和 scripts
- `apps/chat/package.json` — 添加 vitest devDependency
- `packages/shared/package.json` — 添加 vitest devDependency
- 新建 `vitest.config.ts`（根目录）

**具体变更**：

根 `package.json` 添加：
```json
{
  "devDependencies": {
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:smoke": "vitest run --project=smoke"
  }
}
```

根目录新建 `vitest.config.ts`：
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'claude-code-source-code-ref-only'],
    globals: true,
  },
})
```

`apps/chat/package.json` 和 `packages/shared/package.json` 各添加：
```json
{
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

执行 `pnpm install`。

**工作量**：1 小时
**依赖**：无
**验证**：`pnpm test` 运行成功（即使没有测试文件，框架本身正常工作）

---

### D2 — Mock Anthropic Client

**新建文件**：`apps/chat/lib/agent/__tests__/mocks/anthropic.ts`

```typescript
import { vi } from 'vitest'

// Simulates SSE stream events from Anthropic streaming API
export interface MockStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' 
    | 'content_block_stop' | 'message_delta' | 'message_stop'
  message?: { id: string; model: string; role: string; content: unknown[] }
  content_block?: { type: string; id?: string; name?: string; index: number; input?: Record<string, unknown> }
  delta?: { type: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string | null }
  index?: number
  usage?: { input_tokens: number; output_tokens: number }
}

export function createMockStream(events: MockStreamEvent[]) {
  let closed = false
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next: async () => {
          if (closed || i >= events.length) return { done: true as const, value: undefined }
          const event = events[i++]
          // Simulate stream events as SDK would emit them
          return { done: false as const, value: event as any }
        },
        return: async () => {
          closed = true
          return { done: true as const, value: undefined }
        },
      }
    },
  }
}

// Factory for building a text-only stream response
export function mockTextStream(text: string, model = 'claude-sonnet-4-20250514', usage = { input_tokens: 100, output_tokens: 50 }) {
  return createMockStream([
    { type: 'message_start', message: { id: 'msg_1', model, role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', index: 0 } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage },
    { type: 'message_stop' },
  ])
}

// Factory for building a tool-use stream response
export function mockToolUseStream(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = 'tool_001',
  model = 'claude-sonnet-4-20250514',
) {
  return createMockStream([
    { type: 'message_start', message: { id: 'msg_1', model, role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name: toolName, index: 0 } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 100, output_tokens: 50 } },
    { type: 'message_stop' },
  ])
}

export function mockAnthropicClient() {
  return {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  }
}
```

**工作量**：1.5 小时
**依赖**：D1（vitest 就绪）
**验证**：`mockTextStream('hello')` 的 async iterator 能正常遍历 6 个事件

---

### D3 — AgentLoop 测试工厂

**新建文件**：`apps/chat/lib/agent/__tests__/factories/agent-loop.ts`

创建最小化 AgentLoop 实例的工厂函数：
- Mock Anthropic client（D2）
- Mock Prisma（使用 vi.fn() 替代所有 DB 调用）
- Mock SkillRouter（包含已知技能集合）
- Test case ID + customer ID
- `sendEvent` 回调捕获所有 SSE 事件到数组

```typescript
import { vi } from 'vitest'

export function createTestAgentLoop() {
  const mockPrisma = {
    case: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    humanTask: { create: vi.fn() },
    trace: { create: vi.fn() },
  }
  
  const events: Array<{ type: string; data: unknown }> = []
  const sendEvent = (event: { type: string; data: unknown }) => events.push(event)
  
  // ...return AgentLoop instance with mocks
  return { loop, events, mockPrisma, sendEvent }
}
```

**工作量**：2 小时
**依赖**：D2
**验证**：工厂创建的 instance 不抛异常

---

## Test Plan: 具体测试用例

### E1 — 烟测（Must Pass Before Deploy）

**位置**：`apps/chat/lib/agent/__tests__/smoke/`

#### Test 1: Happy Path — User Message → Case Creation
```
Given: AgentLoop with mock Anthropic client returning create_case tool_use + text
When: loop.run() is called with user message "I have a withdrawal issue"
Then:
  - text_delta events are emitted
  - create_case tool is in the tool_executing events
  - case_created SSE event is emitted
  - LoopResult has no error
  - Messages array is non-empty
```

#### Test 2: Happy Path — Tool Execution
```
Given: AgentLoop, mock stream returns todo_write tool_use
When: loop processes the tool_use
Then:
  - tool_executing event emitted for todo_write
  - skill_result event emitted with tool output
  - Tool result appears in messages array
```

#### Test 3: Happy Path — Multi-Iteration
```
Given: AgentLoop with maxIterations=3, alternating text + tool_use responses
When: loop.run()
Then:
  - All 3 iterations execute
  - Messages array grows correctly per iteration
  - No invariant violations in final messages
```

---

### E2 — P0 回归测试

**位置**：`apps/chat/lib/agent/__tests__/regression/`

#### Test A1-1: Stream Creation Retry (Success)
```
Given: client.messages.stream fails with APIConnectionError 2 times, succeeds on 3rd
When: AgentLoop creates stream
Then:
  - 2 retry_pending SSE events emitted
  - Stream opens successfully on 3rd attempt
  - Loop does NOT escalate to human
```

#### Test A1-2: Stream Creation Retry (Exhausted)
```
Given: client.messages.stream fails 6 times (exceeds main_loop maxRetries=5)
When: AgentLoop creates stream
Then:
  - 5 onRetry callbacks fired
  - escalated SSE event emitted
  - LoopResult: transition='waiting_human', caseStatus='escalated'
```

#### Test A1-3: Context Overflow During Stream Creation
```
Given: client.messages.stream throws context_overflow error
When: AgentLoop creates stream
Then:
  - reactiveCompact is called on messages
  - Loop continues (does NOT escalate)
```

#### Test A2-1: Mid-Stream Error With Tool_Use Blocks
```
Given: Stream emits content_block_start(tool_use, id="tu_1"), then throws Error("socket hang up")
When: Stream consumption catches error
Then:
  - S1 synthesis runs before loop exits
  - tool_result block created for tu_1 with is_error:true
  - Messages array has no unmatched tool_use blocks
  - LoopResult.reason is 'stream_error'
```

#### Test A2-2: Mid-Stream Connection Loss (Abort)
```
Given: abortController.abort() called during stream consumption
When: Stream consumption catches abort error
Then:
  - toolExecutor.waitForAll() is called to drain pending tools
  - LoopResult: transition='connection_lost' (NOT 'escalated')
  - Case status preserved
```

#### Test A3-1: Sub-Agent Uses Correct Model
```
Given: SubAgentConfig.model = 'claude-sonnet-4-20250514'
When: runReActLoop called
Then:
  - Anthropic client receives { model: 'claude-sonnet-4-20250514' }
  - NOT the old hardcoded value
```

#### Test A3-2: Sub-Agent Retry on Transient Failure
```
Given: client.messages.create fails 2 times with APIConnectionError, succeeds on 3rd
When: runReActLoop calls LLM
Then:
  - 2 retries happen
  - Sub-agent completes with results
```

#### Test A3-3: Sub-Agent Invariant Synthesis
```
Given: executeAll returns results for 2 of 3 tool_use blocks
When: S1 synthesis runs
Then:
  - All 3 tool_use_ids have matching tool_result blocks
  - The missing one has content containing 'tool_execution_failed'
```

#### Test A4-1: dispatch_subagent is Callable
```
Given: SkillRouter initialized with builtin tools barrel
When: getToolDefinitions() called
Then:
  - dispatch_subagent exists in returned skill list
  - Its inputSchema has agentName, taskDescription, taskPrompt
```

---

### E3 — S1 Invariant 单元测试（纯函数，可立即写）

**位置**：`apps/chat/lib/agent/__tests__/unit/tool-result-invariant.test.ts`

不需要任何 mock — `synthesizeMissingToolResults` 和 `assertToolResultInvariant` 是纯函数。

#### Test: All Tool_Uses Have Matching Results
```
Input: 3 toolUses, 3 completedResults (all matching)
Expect: 3 ToolResultBlocks with actual outputs, none is_error
```

#### Test: One Missing Tool_Use (With MissingReasons Entry)
```
Input: 3 toolUses, 2 completedResults, missingReasons Map has entry for 3rd: 'policy_blocked'
Expect: 2 with actual outputs, 1 with is_error:true and reason='policy_blocked'
```

#### Test: Missing Tool_Use Without MissingReasons Entry — Throws
```
Input: 3 toolUses, 2 completedResults, empty missingReasons
Expect: throws Error
```

#### Test: assertToolResultInvariant — Passes When Matched
```
Input: Assistant msg with 2 tool_uses + user msg with 2 matching tool_results
Expect: no throw
```

#### Test: assertToolResultInvariant — Throws When Unmatched
```
Input: Assistant msg with tool_use(id=A) + user msg with tool_result(id=B)
Expect: throws Error with unmatched tool_use_id 'A'
```

#### Test: Empty Input
```
Input: No tool_uses
Expect: synthesis returns [] ; assertion passes silently
```

---

### E4 — Error Classifier 单元测试（纯函数，可立即写）

**位置**：`apps/chat/lib/agent/__tests__/unit/error-classifier.test.ts`

#### Tests:
```
- APIConnectionError → 'transient_network'
- Raw Error("ECONNRESET") → 'transient_network'
- Raw Error("socket hang up") → 'transient_network'
- APIError(529) with overloaded body → 'overloaded'
- APIError(429) → 'rate_limit'
- APIError(408) → 'timeout'
- APIError(401) → 'auth'
- APIError(403) → 'auth'
- APIError(400, "prompt is too long: 200000 > 199999") → 'context_overflow'
- APIError(500) → 'server_error'
- APIUserAbortError → 'aborted'
- Raw Error("aborted") → 'aborted'
- Generic Error("something") → 'unknown'
- parseMaxTokensContextOverflow: parses Anthropic format correctly
- parseMaxTokensContextOverflow: null for non-matching error
```

---

### E5 — withRetry 单元测试

**位置**：`apps/chat/lib/agent/__tests__/unit/with-retry.test.ts`

#### Tests:
```
- Successful first attempt: result returned, ctx.attempt=0
- Retries on transient network: 2 failures → 2 onRetry calls → succeeds
- Respects maxRetries: fails every time → exactly maxRetries+1 attempts → CannotRetryError
- Context overflow with room: maxTokensOverride set, retry happens
- Context overflow with no room + fallback: FallbackTriggeredError
- Context overflow with no room + no fallback: CannotRetryError
- Abort during operation: CannotRetryError with 'aborted'
- Abort during backoff delay: retry cancelled, CannotRetryError
- 3 consecutive 529s: FallbackTriggeredError
- bailOn529 for policy_eval: 529 → CannotRetryError immediately
- Non-retryable error (auth): CannotRetryError immediately
- Exponential backoff timing: verify delays follow pattern (use vi.useFakeTimers)
```

---

### E6 — Stream Handler 单元测试

**位置**：`apps/chat/lib/agent/__tests__/unit/stream-handler.test.ts`

#### Tests:
```
- Text streaming: text_delta events → fullText accumulated, text_delta SSE emitted
- Tool use completion: content_block_start(tool_use) + input_json_delta + content_block_stop → onToolUseCompleted called
- MiniMax/DeepSeek input in content_block_start: pre-set input → content seeded
- Thinking block: thinking_delta events → only emitted when showThinking=true
- Stop reason + usage: message_delta captured
- Malformed JSON in tool_use: bad JSON → runs with empty input (no crash)
```

---

### E7 — 集成测试

**位置**：`apps/chat/lib/agent/__tests__/integration/`

#### Test: Full AgentLoop — Conversational Mode
```
Given: No active case, user asks "what can you do?"
Mock: Stream returns text only
Expect: text_delta emitted, message_stop emitted, messages array updated
```

#### Test: Full AgentLoop — Case Creation + Investigation
```
Given: Case created mid-loop via create_case tool
Expect: case_created event, caseLoop initialized, stage prompt built
```

#### Test: CC Mode With todo_write
```
Given: CC mode active, mock stream calls todo_write
Expect: todos in CaseMemory, dashboard version bumped
```

#### Test: Orchestrator dispatch
```
Given: OrchestratorAgent with sub-agent config, SubAgentTask created
Mock: SubAgent returns findings
Expect: dispatch() runs sub-agent, returns results, trace written
```

---

## 执行顺序与依赖关系

> **架构师 review 调整重点**：
> - **Step 0（F1 baseline）必须在 A1 之前完成**
> - **E1 烟测从 Day 3 提前到 Day 2 下午**（D3 测试工厂之后立即写），让 A 块改完每次都能 `pnpm test:smoke` 快速验证
> - **B2 / C1 / C2 / C3-original 全部推迟出窗口**

```
开工前必做:
  [F1] Trace baseline — 1 小时

Day 1 上午（信心建设 — 全是纯函数测试，零生产风险）:
  [D1] Test infra (vitest setup) — 无依赖
  [D2] Mock Anthropic client — 依赖 D1
  [E3] Invariant 测试 — 无依赖（纯函数）
  [E4] Classifier 测试 — 无依赖（纯函数）
  [E5] withRetry 测试 — 无依赖

Day 1 下午 — Day 2 上午（P0 第一组）:
  [A1] withRetry 接主循环（已修复 ctx.model bug） — 无依赖
  [A2] Mid-stream synthesis — 无依赖
  [D3] AgentLoop 测试工厂 — 依赖 D2

Day 2 下午（P0 第二组 + 烟测起飞）:
  [A3] 子代理修复（已补 fallback catch） — 依赖 A1
  [A4] dispatch_subagent 激活（走旧 SkillRouter 拦截路径） — 依赖 A3
  [E1] 烟测 — 依赖 D3，A1-A4 同步落地后立即跑过
  ⭐ 此后每次 PR 必须 `pnpm test:smoke` 通过

Day 3（覆盖剩余 LLM 站点 + 回归测试）:
  [B1] 所有 LLM 站点接 withRetry — 依赖 A1 模式验证
  [E2] P0 回归测试 — 依赖 A1-A4
  [E6] Stream handler 测试 — 可前置

Day 4（最小范围 B3 + 集成测试）:
  [B3-砍后] renderHints SSE pipeline + human_task_created 修复 — 不依赖 B2
  [E7] 集成测试 — 依赖 D3

Day 5（buffer + 真实演练）:
  - 用真 LLM key 跑完整 case 一次（5 个 chat session）
  - 比对 trace 与 baseline，确认无意外行为变化
  - 修最后的小问题
  - 准备演示

推迟出窗口（独立周）:
  [B2] S4 builtin tools 真正接入（StreamingToolExecutor 改造） — ≥1 周
  [C1] SOP→CC 重命名 — 0.5 周（含 migration + 全项目 grep）
  [C2] DB migrations — 跟 C1 一起
  [C3-original] Human Ops 频道配置完整 UI + humanTaskBehavior — ≥1 周
  [C4] Dashboards — 独立 spec
```

---

## 验证清单（5 天窗口结束时）

### 必须通过（不通过不发布）

- [ ] **Step 0 baseline 已建立**（F1）
- [ ] `pnpm test` 通过（D1 + E3 + E4 + E5 + E6 + E7）
- [ ] `pnpm test:smoke` 通过（E1）
- [ ] **A1**：主循环 transient network 错误自动重试，不升级人工
- [ ] **A1**：FallbackTriggeredError 触发后用 `ctx.model`，不是 `this.deps.config.model`（演示前手动 grep 确认）
- [ ] **A2**：Mid-stream 非连接错误后 S1 invariant synthesis 运行，messages 数组无未匹配 tool_use
- [ ] **A3**：子代理使用 `SubAgentConfig.model`，硬编码 `'claude-sonnet-4-20250514'` 已删除
- [ ] **A3**：子代理 LLM 错误 catch 处理了 FallbackTriggeredError 和 CannotRetryError 两个分支
- [ ] **A4**：CC 模式下 dispatch_subagent 可被 SkillRouter 找到、可被 model 调用、调用后 orchestrator 真的 dispatch 子代理
- [ ] **B1**：6 个其余 LLM 站点都走 withRetry（grep `messages.create\|messages.stream` 应该全部位于 withRetry callback 内部）
- [ ] **B3-砍后**：LiveChat `human_task_created` 事件不再静默丢弃
- [ ] **Trace baseline 比对**：A1-A4 + B1 + B3 全部完成后，重跑 baseline 场景，trace 序列与 `withdrawal_case_pre_a1.jsonl` 比对，差异都能解释

### 已知留待后续 spec（演示前向客户说明）

- ⏳ S4 builtin Tool<I,O> 真正接入引擎（B2 推迟）
- ⏳ renderHints 端到端（含 BUILT_IN_SKILLS 配 hints、Prisma migration、Console 编辑器 — B3-original）
- ⏳ Console Human Ops 页面频道差异化 human task 行为完整 UI（C3-original）
- ⏳ Console Integrations 页面频道技能绑定 UI（C3-original）
- ⏳ SOP → CC 全项目重命名 + DB migration（C1 + C2）
- ⏳ Dashboards（C4）

### 演示前的真实操作（Day 5 必做）

- [ ] 至少 5 个真实 chat session（用真 LLM key，不用 mock）走通
- [ ] 至少 1 session 触发 sub-agent dispatch
- [ ] 至少 1 session 触发 retry（人为切断网络或限速）
- [ ] 没有 unhandled exception 进入 `traceWriter` 的 fallback 路径
- [ ] LiveChat 端测试一次 `human_task_created`（确认 widget 出现，不再静默）