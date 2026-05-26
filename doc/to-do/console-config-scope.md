# Console 可视化配置取舍 — v4

> **原则**：
> 1. 交付人员懂 Agent。Console 默认姿态是**全面可配**，仅锁定系统契约字段和纯引擎内部字段
> 2. **不确定时，查 CC 源码**。CC 暴露什么给用户，Intera 就暴露什么。Intera 设计哲学与 CC 保持一致
> 3. 基于当前代码状态（2026-05-26）：`stage` / `sop` 双模式，统一 `runReActLoop()` Sub-Agent 引擎，MessageBus 替代 DashboardReader

---

## 一、CC 对齐基准

以下字段的决策来自 CC 源码对照：

| 字段 | CC 做法 | Intera 决策 |
|------|---------|------------|
| `showThinking` | `alwaysThinkingEnabled` + `showThinkingSummaries`，用户在 `settings.json` 可配 | **CONFIGURABLE** — 交付人员 debug 时需要 |
| `isConcurrencySafe` | 每个 Tool 硬编码默认 `false`，仅 Read/Glob/Grep 等只读工具设 `true`。用户不可配 | **HARDCODE** — 纯引擎内部决策 |
| `isReadOnly` | 硬编码 per-tool，用于权限 UI 展示 | **HARDCODE** |
| `isDestructive` | 硬编码 per-tool | **HARDCODE** |
| `AskUserQuestion`（=`propose_interaction`） | 内置 Tool，LLM 主动调用。**所有 sub-agent 不可用**（在 `ALL_AGENT_DISALLOWED_TOOLS` 中） | **KEEP** — 同名 `propose_interaction`，仅主 Agent 可用 |
| Sub-Agent 触发 | **LLM 自主决定**调用 `Agent()` tool。无 config 强制触发 | Intera 不同：**Stage Config 强制触发**（`StageConfig.subAgents` 非空即 dispatch）。这是客服场景的结构化需求，与 CC 的开放式探索场景互补 |
| Sub-Agent 运行模型 | 同进程 async generator，非 worker thread | 同进程 `Promise.allSettled`，与 CC 一致 |

---

## 二、权限模型

| 级别 | 含义 | 示例 |
|------|------|------|
| **READ-ONLY** | 界面展示当前值，不可编辑。改了会破坏系统契约 | Built-in Critical Skill 的 `name`、`inputSchema`、`mode` |
| **CONFIGURABLE** | 交付人员可直接修改，有合理默认值 | `model`、`temperature`、`systemPrompt`、`showThinking` |
| **HARDCODE** | 界面不展示。纯引擎内部字段 | `isConcurrencySafe`、`guardPhase` |

---

## 三、Skills 权限分级

### 三级 Skill 分类

| 级别 | 包含 | Console 行为 | 示例 |
|------|------|-------------|------|
| **Built-in Critical** | 影响系统契约和 case 生命周期的核心工具 | name/inputSchema/mode **READ-ONLY**。enabled/displayVerb/description CONFIGURABLE | `create_case`、`finalize_case`、`create_human_task`、`finalize_sub_agent`、`todo_write`、`todo_read` |
| **Built-in Standard** | 业务技能 | **全部 CONFIGURABLE**（含 mockFixture） | `query_order_status`、`get_account_status`、`get_transaction_history` 等 |
| **Built-in Special** | 有独立配置页面的特殊技能 | 在 Skills 页面 READ-ONLY，通过专属页面管理 | `kb_hybrid_retrieve`（由 Knowledge 页面 + Agent Config 卫星卡片控制） |
| **Business** | 交付人员自建 | 全部 CONFIGURABLE | `handle_refund` 等 |

### `kb_hybrid_retrieve` 的特殊性

- **不在 Skills 页面编辑**。它的 enabled/参数配置通过 **Knowledge 页面**（知识源管理 + GPTBots API Key）+ **Agent Config 卫星卡片**（Knowledge Retrieval 开关）完成
- Skills 页面展示其为 Built-in Special，标注 "Configure in Knowledge page"，点击跳转

---

## 四、逐页面改造

### 4.1 Skills 页面

| 字段 | Built-in Critical | Built-in Standard | Business |
|------|-------------------|-------------------|----------|
| `name` | **READ-ONLY** | CONFIGURABLE | CONFIGURABLE |
| `inputSchema` | **READ-ONLY** | CONFIGURABLE | CONFIGURABLE |
| `mode` | **READ-ONLY** | CONFIGURABLE | CONFIGURABLE |
| `description` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `displayVerb` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `enabled` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `mockFixture` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `endpoint` / `httpMethod` / `headers` / `timeoutMs` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `outputSchema` | CONFIGURABLE | CONFIGURABLE | CONFIGURABLE |
| `guardPhase` | **HARDCODE** | **HARDCODE** | **HARDCODE** |
| `isConcurrencySafe` | **HARDCODE** | **HARDCODE** | **HARDCODE** |

### 4.2 Agent 配置页面

| 字段 | 决策 | 理由 |
|------|------|------|
| `systemPrompt` | CONFIGURABLE | 核心差异化 |
| `model` | CONFIGURABLE | 不同客户不同模型 |
| `temperature` | CONFIGURABLE（slider: 0.1 精准 ←→ 1.0 创意） | |
| `evaluationModel` | CONFIGURABLE | |
| `thinkingBudget` | CONFIGURABLE | |
| `maxIterations` | CONFIGURABLE | |
| `maxOutputTokens` | CONFIGURABLE | |
| `showThinking` | **CONFIGURABLE**（对齐 CC `alwaysThinkingEnabled`） | 交付人员 debug 需要 |
| `enableLlmSanitization` | **HARDCODE** | 始终开启 |
| `debugMode` | **HARDCODE** | 开发者功能 |
| `prefixContinuation*` | **REMOVE** | Composer Assist 独立功能 |

### 4.3 Memory

**Slider 快捷入口 + Advanced 逐字段覆盖**：

- Short-term / Balanced / Long-term 三档 slider
- Advanced 展开可逐参数微调
- 手动修改后 slider 显示 "Custom"

### 4.4 Policies → Guardrails

保留底层 Policy JSON 存储。Console UI 增加业务语义层：

| Guardrail 表达 | 引擎映射 |
|---------------|---------|
| Must call `[skills]` | `require_skills` + `hook: 'preFinalize'` |
| Never allow `[skills]` | `deny_skills` + `hook: 'preTool'` |
| AI evaluation | `enableLlm: true` + `evaluationPrompt` |

### 4.5 Case Types

全部 CONFIGURABLE。执行模式 `executionMode`: `'stage'` / `'sop'` 二选一。

**Sub-Agent 触发机制**（与 CC 的关键差异）：

| | CC | Intera |
|---|---|---|
| 触发方式 | LLM 自主决定调用 `Agent()` 工具 | Stage Config 强制触发 |
| 配置入口 | Agent definition frontmatter | `StageConfig.subAgents[]` |
| Console 配置面 | 无（CLI 配置文件） | **可视化**：每个 stage 的子代理列表 + 每个子代理的 model/systemPrompt/skills/taskTemplate |

交付人员在 Console 通过 `StageConfig.subAgents` 配置 "这个阶段需要并行调查哪些系统"。

**Case Memory 传递 + Trace**：Sub-agent dispatch 时传递 `CaseMemoryData` 全量，返回时 `mergeSingleResult()` 写回。需新增两个 ActionType：

| ActionType | 触发时机 | payload |
|-----------|---------|---------|
| `sub_agent_dispatched` | Orchestrator dispatch | `{ agentNames[], stage, caseMemorySnapshot }` |
| `sub_agent_merged` | mergeSingleResult | `{ agentName, findings, newFacts[], durationMs }` |

### 4.6 Routing

全部 CONFIGURABLE。

### 4.7 Knowledge

全部 CONFIGURABLE（已有独立页面）。`kb_hybrid_retrieve` 不通过 Skills 页面管理。

### 4.8 Integrations

全部 CONFIGURABLE。建议新增 `channelSkillBinding`。

---

## 五、汇总

| 级别 | 数量 | 关键项 |
|------|------|--------|
| **READ-ONLY** | 3 字段 × 6 技能 | Built-in Critical 的 `name`、`inputSchema`、`mode` |
| **HARDCODE** | 3 字段 | `guardPhase`、`isConcurrencySafe`、`enableLlmSanitization` |
| **REMOVE** | 1 组 | `prefixContinuation*`（移到 Composer Assist） |
| **CONFIGURABLE** | 其余全部 | 含 `showThinking`、`debugMode`、memory 参数、sub-agent 参数 |

---

## 六、实施 Roadmap

| 优先级 | 范围 |
|--------|------|
| **P0** | Skills 页面三级分类 + READ-ONLY 锁定 + `kb_hybrid_retrieve` 跳转 Knowledge |
| **P0** | `showThinking` 改为 CONFIGURABLE，`isConcurrencySafe`/`guardPhase` 改为 HARDCODE |
| **P1** | Memory slider + Advanced 展开 |
| **P1** | Policies → Guardrails 业务语义 UI |
| **P1** | `sub_agent_dispatched` / `sub_agent_merged` trace 新增 |
| **P2** | Agent Config 移除 `prefixContinuation*` |
| **P2** | Case Types Sub-Agent 配置编辑器（Console 可视化 StageConfig.subAgents） |
| **P3** | Integrations channelSkillBinding |
