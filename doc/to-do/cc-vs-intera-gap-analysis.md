# Claude Code vs Intera — 差距分析与闪光点

> 基于 `claude-code-source-code-ref-only/` 源码与 Intera 当前实现的对比。
> 目的：识别可借鉴的设计，为 Intera sub-agent 重构提供方向。

---

## 1. 统一 Agent Loop（最关键差距）

**CC**：主 Agent 和 Sub-Agent 跑完全相同的 `query()` async generator。上下文压缩、自动降级、错误恢复、tool 执行——全部共享同一套逻辑。Agent 嵌套深度 N 不会引入新代码路径。

**Intera**：`loop.ts`（主 Agent）和 `sub-agent.ts` 是两套独立实现。sub-agent 缺少：
- `StreamingTextSanitizer` 保护
- `StageExecutor` 阶段流转评估
- 完整的 Policy 三层 Hook
- 上下文压缩只做简单截断

**影响**：Sub-Agent 更笨、更容易崩溃、更少护栏。

---

## 2. Fork Sub-Agent + Prompt Cache 共享

**CC**：Fork 模式下，子代理**继承父 Agent 的完整系统提示词和工具定义**。Anthropic API 按请求前缀匹配 cache——N 个并行子代理共享同一份 prompt cache，只有最终指令块不同。成本几乎不增加。

```
父消息（含 N 个 tool_use）→ 工具占位 → fork children
  ├─ 子 1: [共享 cache 前缀...] + "分析 auth 模块"
  ├─ 子 2: [共享 cache 前缀...] + "分析 payment 模块"
  └─ 子 3: [共享 cache 前缀...] + "分析 database 模块"
              ↑ 只有最后一段不同 → 90%+ cache 命中率
```

**Intera**：每个 sub-agent 从零构建 tools 和 prompt，无 cache 共享。3 个并行 sub-agent = 3 份完整的 prompt input tokens。

---

## 3. 四层上下文压缩

**CC**：
| 层 | 触发时机 | 持久化 |
|---|---|---|
| microcompact | 每轮（tool result 压缩） | 否 |
| history snip | 压缩边界附近的旧消息 | 否 |
| context collapse | 达到阈值时，跨轮持久化摘要 | 是 |
| auto-compact | 接近 context limit 时，全量摘要 + Haiku 模型 | 否 |
| reactive compact | 413 错误兜底 | 否 |

**Intera**：只有 microcompact + autocompact + snip，缺少 context collapse 这种跨轮持久化能力。

---

## 4. 三个自动错误恢复路径

**CC** 的 loop 内置三层恢复：

| 恢复路径 | 触发条件 | 行为 |
|---|---|---|
| model fallback | 主模型故障 | 切换 fallback 模型，清理孤儿消息，重建 executor，重试 |
| max_output_tokens | token 打满 | 先升档 64K retry，再打满则注入 "pick up mid-thought" 恢复消息 |
| 413 prompt-too-long | 上下文超限 | 先 drain context collapse → 不行则 reactive compact |

**Intera**：遇到这些错误基本是 `catch → break`，退出 loop。用户看到"Agent 处理失败"。

---

## 5. `isConcurrencySafe()` 粒度

**CC**：每个 tool 的 `isConcurrencySafe(input)` 接受输入参数，按参数判断。同一个 tool 不同调用可能不同安全策略。Bash/Read/Glob/Grep 标记为安全后可以并行执行。

**Intera**：`isConcurrencySafe` 是静态 boolean。粒度粗糙，容易过度串行化。

---

## 6. In-Process Teammate + SendMessage

**CC**：同一 Node.js 进程内多个 Agent 通过 `SendMessage({to: name})` 实时通信。`pendingUserMessages` 队列支持任意时刻的消息注入。Agent A 可以中途发指令给 Agent B。

**Intera**：Sub-Agent 间通信只能靠 Dashboard 轮询 `dashboardVersion`。延迟至少一个迭代周期，且只能传递状态变更（不能传递具体指令）。

---

## 7. Query Chain Tracking

**CC**：每次 `query()` 调用携带 `QueryChainTracking`：`chainId`（UUID，同一调用链共享）+ `depth`（递归层级递增）。提供完整 Agent 树的可观测性。

**Intera**：无此机制。无法追踪某个 API 调用在 Agent 树中的位置。

---

## 8. 安全分类（Handoff Classification）

**CC**：Auto-mode 下，`classifyHandoffIfNeeded()` 在 sub-agent 完成后运行一次**二次模型调用**，评估其工作是否符合安全策略，再决定是否将结果流回主 Agent。

**Intera**：Policy 的 preTool/postTool/preFinalize 在主 Agent 运行。Sub-Agent 结果合并时没有独立的安全评估层。

---

## 9. Tool Search / Deferred Loading

**CC**：工具定义可以**延迟加载**。`ToolSearchTool` 允许 LLM 按 keyword 搜索工具，工具定义不全部塞进 system prompt。减少 prompt 体积，提高 cache 命中率。

**Intera**：所有工具定义全量塞进 system prompt（`SkillRouter.getTools()`）。工具数量增长时 prompt 膨胀严重。

---

## 10. 提示词工程

**CC**：system prompt 是 Anthropic 多年迭代的产物，对 tool use 行为约束极其精准。包含详细的边界场景处理、错误恢复指引、并行执行规范。

**Intera**：prompt 相对简洁。LLM 在复杂场景下的决策质量直接受限于 prompt 质量。

---

## 优先级建议

| 优先级 | 改进项 | 收益 | 复杂度 |
|--------|--------|------|--------|
| P0 | 统一 Agent Loop | Sub-Agent 立即获得全部护栏和压缩能力 | 高 |
| P0 | SendMessage 实时通信 | Sub-Agent 间低延迟协作 | 中 |
| P1 | Fork 式 cache 共享 | N 个并行 sub-agent 成本降低 60-80% | 中 |
| P1 | 自动错误恢复 | Agent 不因临时故障中断 | 中 |
| P2 | Query Chain Tracking | 全链路可观测 | 低 |
| P2 | 四层上下文压缩补齐 | 更长对话，更好记忆 | 高 |
| P3 | Tool Deferred Loading | 工具数量增长时 prompt 不膨胀 | 中 |
| P3 | Handoff Classification | 安全审计 | 低 |
