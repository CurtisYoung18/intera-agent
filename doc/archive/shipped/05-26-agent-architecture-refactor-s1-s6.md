> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Agent 引擎架构重构：S1-S6 + CC 差距分析

> **来源合并**: `s1-tool-result-invariant.md` + `s2-centralized-retry-fallback.md` + `s3-loop-slimming.md` + `s4-tool-interface-unification.md` + `s5-channel-binding.md` + `s6-console-visualization-parity.md` + `Intera Agent — 修复与测试计划.md` + `cc-vs-intera-gap-analysis.md`
> **动机**: Claude Code 源码审计暴露 Intera 引擎与 CC 之间的结构性差距。S1-S6 是对标 CC 的 6 步重构程序。

---

## 0. CC vs Intera 差距分析

Claude Code 源码审计（`claude-code-source-code-ref-only/`）识别出可借鉴的关键设计：

### 统一 Agent Loop（最关键差距）

CC 的主 Agent 和 Sub-Agent 跑完全相同的 `query()` async generator。Intera 的 `AgentLoop` 和 `SubAgent` 是两套独立实现，SubAgent 缺少：
- `StreamingTextSanitizer` 保护
- `StageExecutor` 阶段流转评估
- 完整的 Policy 三层 Hook（preTool / postTool / preFinalize）
- LLM 上下文压缩（仅做简单截断）

**影响**: SubAgent 更笨、更易崩溃、更少护栏。

### 其他关键差距

| 差距 | CC | Intera |
|------|-----|--------|
| 错误恢复 | 单点 `retryWithBackoff`，所有 LLM 调用都经过 | 5+ 处 LLM 调用无统一重试 |
| Tool 接口 | 统一 `Tool<I,O>` 接口 | 双系统并存（`SkillDefinition` + 新 `Tool`） |
| 上下文压缩 | 历史消息 vs 关键事实分开压缩 | 只做简单截断 |
| Channel 抽象 | 单一事件流 + per-channel renderer | 引擎直接输出 channel-specific 格式 |
| 测试 | ~1,500 单测 | 仅 ~158，缺 engine-level integration tests |

---

## S1 — Tool-Result Invariant（Wave 1，地基）

**目标**: 每个 `tool_use` 块都有恰好一个匹配的 `tool_result` 块。

**为什么是 P0**: Anthropic Messages API 强制匹配。不变量被破坏时 API 会拒绝请求 → 主循环静默崩溃 → 人工被调。

**修复**:
- `tool_use_id` 追踪器：每次 API 调用后比对 `tool_use` 和 `tool_result` 的数量
- 合成结果：流截断时生成 `{ error: "truncated", partial: true, content }` 而非空
- Abort 后保证：主循环 abort 时若还有 pending tool_use → 注入 synthesis result 再调一次 API

---

## S2 — Centralized Retry & Fallback（Wave 1，稳定性）

**目标**: 每个 LLM API 调用经一个 wrapper，分类错误、退避重试、流式→非流式降级、返回 typed terminal outcome。

**为什么是 P0**: 当前 5+ 处 LLM 调用站点各有自己的错误处理（大多没有），瞬时网络错误 → 主循环退出 → silent break。

**架构**:
```
LLMClient.call(messages, options) → LLMResult
  ├── classifyError(status, body) → ErrorCategory
  ├── retryWithBackoff(retryable: true, attempt) → delay
  ├── fallbackToNonStreaming(streamError) → Result
  └── always returns LLMResult or LLMError(typed)
```

**修复完成后**: 再不会有"Intera quits the loop for no reason"。

---

## S3 — Loop Slimming（Wave 1，可维护性）

**目标**: 将 `loop.ts` 从 2884 行减到 <800 行。

**策略**:
- 提取共享的 `performIteration()`：单一流式迭代体，参数化 policy + memory + tool-set
- 删除死的 `runReActLoop` 实例方法
- Sub-agent 路径不再是非流式特殊路径 → 复用同一迭代体
- 主 loop 变成薄状态机对迭代体的编排

**依赖**: S1（合成结果）和 S2（重试 wrapper）先落地，它们的原语是本重构的缝合边界。

---

## S4 — Tool Interface Unification（Wave 2，架构基石）

**目标**: 替换 `SkillDefinition`（DB 行 + 分支执行器）为 `Tool<I,O>` 接口，所有工具（内置 code-defined + 业务 DB-backed）对引擎完全一致。

**之后**:
- 内置 skills 是 code modules → 自含 input schema、validation、动态 concurrency、render hints
- 业务 skills 保持 DB 存储但通过 adapter 暴露相同 `Tool<I,O>` 接口
- 执行器调 `tool.execute(input, ctx)` → 从不分支 `mode === 'http' | 'mock'`
- `dispatch_subagent` 成为真正内置工具；`executionMode: 'sop'` → `'cc'`

**为 S5 铺路**: render hints 活在 tool 上；为 S6 铺路：tool metadata 驱动编辑器。

---

## S5 — Channel Binding（Wave 2，渠道抽象）

**目标**: 引擎 emit **canonical** SSE 事件，每个 channel 有 renderer 把 canonical 事件翻译为 channel-native UX。

**之后**:
- 引擎不知自己服务于哪个 channel
- `propose_interaction` → chat widget 内嵌按钮 / LiveChat rich card / Slack block-kit message
- Per-tool render hints（来自 S4）让运营按 channel 调每个工具的呈现
- Console `/admin/integrations` 里配置 channel 是否活跃、defaults、per-tool overrides

**工程决策**: `renderHints` 在 tool level（S4 产出），不在 channel level → tool 的 renderer 查找 `renderHints[channel]`，缺失则 fallback 到默认。

---

## S6 — Console Visualization Parity（Wave 2，Console 门槛）

**目标**: Console 达到"运营人员不读代码即可配置、观察、调试一个已部署 agent"的程度。

**依赖**: S1-S5 全部落地。S6 把它们变成 Console 里的一等公民。

**新 Console 能力**:
- **Live Trace Viewer**: 引擎状态机实时可视化 — 迭代边界、S1 不变量断言、S2 重试事件、sub-agent dispatch、channel render 决策
- **Sub-Agent Execution Graph**: 树形展示 parent + sub-agents，status + model + tool calls + findings
- **Render-Hint Preview**: 运营不启动真实对话就能看 tool 在不同 channel 上的呈现效果
- **Tool Source Labels**: built-in vs business vs sub-agent → 编辑器的权限模型可视化
- **Trace Dashboards**: 聚合 retry、fallback、invariant、channel-filter 事件

---

## 修复与测试计划（整体协调）

### 三层问题

1. **P0 — 生产事故级**: 主循环无重试 → 瞬时错误直接升级人工、mid-stream silent break 破坏消息不变量、sub-agent 硬编码模型 + 无重试、`dispatch_subagent` 是死代码
2. **P1 — 稳定性/体验**: S4 双工具系统并存、renderHints 链路断开、5 个 LLM 调用站点缺重试、零测试
3. **P2 — 完善性**: SOP→CC 重命名、DB 迁移、dashboards、Human Ops UI

### 目标

5 个工作日内从"能跑 happy path"提升到"可演示给客户"，并建立测试基础设施。

### 架构师 review 后的范围调整

原计划 5 天范围超载，B2/C3 有会让 PR 走不通的工程细节。调整为聚焦 S1-S6 核心重构 + 测试骨架。S1-S6 共 ~8-10 天全额工期。

---

## 依赖关系图

```
S1 (tool-result invariant) ──→ S2 (retry) ──→ S3 (loop slimming)
                                                    │
                          ┌─────────────────────────┘
                          ↓
                    S4 (tool interface) ──→ S5 (channel binding)
                                                    │
                                              ┌─────┘
                                              ↓
                                        S6 (console viz)
```

**关键约束**: S1 先上（地基）；S2 紧接（所有 place 的 retry wrapper 在 S3 解耦前必须有）；S3 依赖 S1+S2 的原语做缝合边界；S4 是 S5 的前提（render hints on tool）；S6 是终点（S1-S5 的 UI 化）。

---

## 当前测试状态（修复后）

- Agent engine 单测: 158/158 passing
- LiveChat integration 单测: included in 158
- TypeScript: `tsc --noEmit` 零错误（chat + console）
- 代码覆盖: ~30%（engine-level integration tests 缺失）
