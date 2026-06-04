# Trace 清理：Profiler Snapshot actionType 修正 + 冗余项评估 + 可观测性提升

**来源：** trace 可观测性 review
**风险：** 低（仅 trace 写入 & 前端渲染，不影响运行时）

---

## 1. Profiler Snapshot actionType 修正

**现状：** `profiler-utils.ts` 写 Profiler Snapshot 时复用 `loop_decision` 作为 actionType，导致 trace 列表里出现 `loop_decision / Profiler Snapshot`，语义混乱。

**根因文件：**
- `apps/console/lib/agent/profiler-utils.ts:15` — `traceWriter.write('loop_decision', 'Profiler Snapshot', ...)`
- `apps/console/lib/agent/trace.ts` — `ActionType` union 缺少 `profiler_snapshot`
- `apps/console/components/ops/case-trace-view.tsx` — `ACCENTS` 映射缺少 `profiler_snapshot` 条目

**方案：**
1. `trace.ts` — `ActionType` 新增 `'profiler_snapshot'`
2. `profiler-utils.ts` — 改用 `'profiler_snapshot'` 替代 `'loop_decision'`
3. `case-trace-view.tsx` — `ACCENTS` 加一条 `profiler_snapshot`

---

## 2. Profiler Snapshot 是否可移除？

**分析：** 前端 case detail 全部指标从单条 trace 重算，完全不依赖 Profiler Snapshot。页面有专属跳过逻辑。

**建议：直接移除** `writeProfilerSnapshot()` 调用 + `profiler-utils.ts` + `Profiler.snapshot()`。

---

## 3. Case Detail 右上角"查看对话"按钮是否冗余？

**现状：** 跳转到 `/ops/chats/{chatId}`。

**分析：** Case detail 底部已有 Messages 面板。Chat 页若无额外功能则冗余。

**建议：** 确认 chat 页面功能后决定。

---

## 4. Tool call input/output 可见性

**现状：**
- `loop.ts:972-974` 写 `skill_result` 时 payload 包含 `input` + `output`。
- Case detail 有 "Tool calls with I/O" 独立区块（`ToolCallCard`），**但默认折叠**。
- Timeline 内单个 skill_result 卡片也默认折叠 (`payloadDefaultOpen = false`)。

**问题：** 需要两次点击才能看到入参/出参。

**建议：** Tool calls 区块默认展开，或给 input/output 做更醒目的非 JSON 渲染。

---

## 5. Playground 实时 trace 看不到 LLM prompt（含完整 prompt 需求）

### 现状根因

Playground 的 trace 数据流是两条路径：

**路径 A（SOP/工具类 trace）**：AgentLoop 通过 SSE `sendEvent` 发射 `tool_executing` / `skill_result` 等事件 → playground runner 捕获进 `memoryTraces` → `aggregateTraces` 聚合。**这条路径工作正常。**

**路径 B（LLM prompt trace）**：AgentLoop 通过 `traceWriter.writeLlmRequestStart()` 写 trace → 但在 dryRun 模式下 `TraceWriter.write()` 直接 `return entry`，**不经过 persistence port，也不发射 SSE 事件**。因此 playground runner 的 `memoryTraces` 永远收不到 `llm_request_start` 数据。

**结果：** playground runner 末尾的 fallback 补了一条裸记录：
```ts
// playground-runner.ts 末尾
if (!memoryTraces.some(t => t.actionType === 'llm_request_start')) {
  memoryTraces.push({ ..., title: 'LLM request' })  // ← 无 payload！
}
```

然后 `trace-aggregator.ts` 把这个裸记录归入 `'Model generation'` stage，summary 就是 `"LLM request"`。**展开后没有任何 prompt 内容。**

前端 playground sidebar 里只有开 "Show raw JSON" 才能在 `step.json` 看到数据——但即便开了，json 也是空的（因为源头就没传）。

### 截断问题（影响 case detail 页面）

生产环境（非 playground）的 `writeLlmRequestStart` 在 `trace.ts` 里有硬截断：
- `systemPrompt`：最多 8000 字符
- `lastMessages`：最多 6 条，每条 2000 字符

debug 模式下用户想看到完整 prompt，但这个截断在写入 trace 时就发生了，改前端也没用。

### 方案

**A. Playground：让 prompt 数据真正进入 trace**

1. 修改 AgentLoop，在 dryRun 模式下调用 `writeLlmRequestStart` 时也把数据写入 persistence port（`this.persistence.saveTrace()`），而不是仅 return entry。
2. 或者：在 playground runner 里，在调用 `agentLoop.run()` 之前捕获 `assembled.prompt` + 用户消息，run 完后显式插入 `memoryTraces`。
3. 或者（更简洁）：AgentLoop 在调用 `writeLlmRequestStart` 的同时发射一个 SSE 事件 `{ type: 'llm_request_start', data: { systemPrompt, messages } }`，playground runner 已有的 SSE 捕获逻辑就能收到。

**B. 去掉截断（debug 模式下完整 prompt）**

1. `trace.ts` 的 `writeLlmRequestStart`：区分 debug/非 debug 模式。debug 模式不截断 systemPrompt 和 messages。
2. 但需要传递 debug flag 进去——可以在 `AgentConfig` 里带 `debugMode`，`TraceWriter` 读这个标志决定是否截断。

**C. Playground 前端渲染**

1. `trace-aggregator.ts`：`llm_request_start` 的 `json` 始终输出（不依赖 `debug` flag），因为 playground 的 toggle 控制的是前端显示，不是数据输出。
2. Playground sidebar：给 `llm_request_start` / `llm_response` 步（`Model generation` stage）加专用渲染组件——system prompt 用 italic 代码块、消息用对话气泡，仅在 debug toggle 开启时展示。

### 改动面

| 文件 | 改动 |
|---|---|
| `trace.ts` | `writeLlmRequestStart` 支持不截断（debug 模式） |
| `loop.ts` | 调用 `writeLlmRequestStart` 时传入 debug flag |
| `playground-runner.ts` | 捕获 prompt 数据（方案 A.1/A.2/A.3 三选一） |
| `trace-aggregator.ts` | `llm_request_start` 的 json 不依赖 debug flag |
| `playground/page.tsx` | 给 Model generation stage 加 prompt 渲染（debug 时展示） |
