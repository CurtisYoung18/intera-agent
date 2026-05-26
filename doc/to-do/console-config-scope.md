# Console 可视化配置取舍 — v3

> **原则**：交付人员懂 Agent。Console 默认姿态是**全面可配**，只有极少数会破坏系统契约或属于纯引擎内部的字段才不可编辑（但仍在界面展示）。
>
> **基于当前代码状态**（2026-05-26）：两种执行模式 `stage` / `sop`，统一 `runReActLoop()` Sub-Agent 引擎。

---

## 一、权限模型

| 级别 | 含义 | 示例 |
|------|------|------|
| **READ-ONLY** | 界面展示当前值，不可编辑。改了会破坏系统契约 | System Skill 的 `name`、`inputSchema`、`mode` |
| **CONFIGURABLE** | 交付人员可直接修改，有合理默认值 | `model`、`temperature`、`maxIterations`、`systemPrompt` |
| **HARDCODE** | 界面不展示。纯引擎内部决策，改了反而容易出错 | `guardPhase`、`isConcurrencySafe`、`showThinking` |

---

## 附：Sub-Agent 在客服场景的定位

### 设计哲学（对齐 CC）

Sub-Agent = **纯粹的后台执行者**，不是对话者。不和顾客交互。

- CC 把 `AskUserQuestion` 放在 `ALL_AGENT_DISALLOWED_TOOLS` 中——所有 sub-agent 都不能问用户问题
- `request_user_input` / `propose_interaction` 同理，只在主 Agent 可用
- Sub-agent 发现缺信息 → `finalize_sub_agent({ recommendation: "NEED_INPUT:xxx" })` → 主 Agent 收集 → 重新 dispatch

### 客服场景下 Sub-Agent 的价值

| 场景 | 为什么适合 Sub-Agent | 示例 |
|------|---------------------|------|
| **多系统并行核查** | 充值问题需要同时查：支付网关 + 银行流水 + 账户余额。每个独立查询可并行 | `investigate_deposit` × 3 并行 |
| **后台静默调查** | 主 Agent 在安抚顾客时，sub-agent 在后台拉历史工单、查风控标记 | "请您稍等，我帮您查一下" ← 主 Agent 说；sub-agent 在查 |
| **结构化数据提取** | OCR 小票 → 核对订单系统 → 交叉验证金额 | 一个 sub-agent 链式执行 |
| **跨系统证据链** | 顾客说"充了500只到了300"→ sub-agent 对比支付网关 + 平台入账 | 发现差异 → findings 带回主 Agent |

### 什么时候不用 Sub-Agent

| 场景 | 原因 | 替代方案 |
|------|------|---------|
| 单工具查询 | 一个工具就够了 | 主 Agent 直接调 |
| 需要给顾客看进度 | StatusTrack 只展示主 Agent 的 tool | 主 Agent 自己调 |
| 需要顾客交互 | Sub-agent 不能对话 | 主 Agent 收集后重新 dispatch |

### Stateless 的价值

Sub-agent 不维护自己的对话历史。每次 dispatch 从 CaseMemory 读 facts、调工具、写回 findings：

- **可被多次 dispatch** — 收集到新信息后重新 dispatch，从更完整的 CaseMemory 出发
- **并行安全** — 不同 sub-agent 写不同的 fact key，互不覆盖
- **可中断可恢复** — MessageBus 通知 → sub-agent 调整方向或 finalize 返回
- **成本可控** — 不需要长对话上下文，每次是"拿任务 → 执行 → 返回"

---

## 二、Skills 页面

### System Skill vs Business Skill

区分逻辑：`name` 在 `BUILT_IN_SKILLS` 列表中的为 System Skill。不新增 DB 字段。

| | System Skill | Business Skill |
|---|---|---|
| 核心契约（name、inputSchema、mode） | **READ-ONLY**（展示但不可改） | CONFIGURABLE |
| 工程内部字段（guardPhase、isConcurrencySafe） | **HARDCODE**（不展示） | HARDCODE |
| 其余所有字段 | **CONFIGURABLE** | CONFIGURABLE |

### 逐字段决策

| 字段 | 决策 | 理由 |
|------|------|------|
| `name` | System: **READ-ONLY** / Business: **CONFIGURABLE** | System Skill 名称是代码契约 |
| `description` | **CONFIGURABLE** | 注入 LLM prompt，需要定制 |
| `inputSchema` | System: **READ-ONLY** / Business: **CONFIGURABLE** | System Skill 的输入契约不可改 |
| `outputSchema` | **CONFIGURABLE** | 保留，可编辑 |
| `mode` (mock/http) | System: **READ-ONLY** / Business: **CONFIGURABLE** | System Skill 永远是 mock |
| `endpoint` | **CONFIGURABLE** | Business Skill 需要配置外部 API |
| `httpMethod` | **CONFIGURABLE** | 同上 |
| `headers` | **CONFIGURABLE** | API Key 等。支持 `${ENV_VAR}` 占位符 |
| `timeoutMs` | **CONFIGURABLE** | 默认 10000 |
| `mockFixture` | **CONFIGURABLE** | 交付人员可能需要修改 mock 返回 |
| `guardPhase` | **HARDCODE** | PolicyEngine 内部 |
| `isConcurrencySafe` | **HARDCODE** | 查询类=true，写入类=false，不由交付人员判断 |
| `enabled` | **CONFIGURABLE** | 开关 |
| `displayVerb` | **CONFIGURABLE** | "正在查询订单..." |

### 建议新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `uiHints` | JSON | 集成方渲染提示。`renderAs` / `resultRenderAs` |
| `triggerKeywords` | string[] | 关键词匹配时强调此技能 |
| `allowedChannels` | string[] | chat / livechat / api，交付人员勾选 |

### Skills 页面布局

```
┌─ Skills ──────────────────────────────────────────────────────────┐
│ [ + New Business Skill ]                           [Search...]    │
│                                                                     │
│ ┌─ System Skills ─────────────────────────────────────────────┐  │
│ │  🔵 query_order_status      ✓   [Configure]                   │  │
│ │  🔵 create_case             ✓   [Configure]                   │  │
│ │  ...                                                           │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│ ┌─ Business Skills ───────────────────────────────────────────┐  │
│ │  handle_refund              ✓   [Edit] [Delete]                │  │
│ └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

System Skill Configure 弹窗：

```
┌─ query_order_status (System) ──────────────────────────────────┐
│  🔒 Contract (read-only)                                        │
│  name: query_order_status     mode: mock                        │
│  inputSchema: { orderId: string, userId?: string }              │
│                                                                  │
│  ── Configurable ──────────────────────────────────────────    │
│  Enabled: [✓]                                                   │
│  Display Verb: [正在查询订单状态..._________________________]    │
│  Description: [查询用户订单的当前状态和物流信息_____________]     │
│                                                                  │
│  ── UI Hints ─────────────────────────────────────────────    │
│  Render as: [Card ▾]           Result as: [Table ▾]             │
│                                                                  │
│  ── Channels ─────────────────────────────────────────────    │
│  [✓] Chat   [✓] LiveChat   [ ] API                              │
│                                                                  │
│  Trigger keywords: [订单, 物流, 配送_______________________]     │
│                                              [Save]              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、Agent 配置页面

### 3.1 Model & Prompt

| 字段 | 决策 | 理由 |
|------|------|------|
| `systemPrompt` | **CONFIGURABLE** | 核心差异化 |
| `model` | **CONFIGURABLE** | 不同客户用不同模型 |
| `temperature` | **CONFIGURABLE**（slider） | `0.1 精准` ←→ `1.0 创意` |
| `evaluationModel` | **CONFIGURABLE** | 交付人员可能想用不同模型做评估 |
| `thinkingBudget` | **CONFIGURABLE** | 推理深度 |
| `maxIterations` | **CONFIGURABLE** | 循环上限 |
| `maxOutputTokens` | **CONFIGURABLE** | 输出长度 |
| `showThinking` | **HARDCODE** | 调试功能 |
| `enableLlmSanitization` | **HARDCODE** | 始终开启 |
| `debugMode` | **HARDCODE** | 开发者功能 |
| `prefixContinuation*` | **REMOVE** | Composer Assist 独立功能 |

### 3.2 Memory

**Slider 快捷入口 + Advanced 逐字段覆盖**：

```
Memory:  ( ) Short-term  (•) Balanced  ( ) Long-term    [Advanced ▾]

  ▼ Advanced（点开后可逐字段覆盖 slider 预设）
  ┌─────────────────────────────────────────────────────────────┐
  │ autocompact threshold: [40000____] tokens                   │
  │ warning threshold:     [35000____] tokens                   │
  │ compaction keep min:   [6________] messages                 │
  │ ... (其余字段)                                              │
  └─────────────────────────────────────────────────────────────┘
```

Slider 选档时自动填充 Advanced 里的值。手动修改 Advanced 里的值后 slider 显示 "Custom"。

### 3.3 Human Ops

全部 CONFIGURABLE：`consultationPrompt`、`humanSkills`、`resumePrompt`、`formResponseTemplate`

### 3.4 Knowledge Retrieval

全部 CONFIGURABLE（已在 knowledge 独立页面），Agent 页面只放一个跳转链接。

---

## 四、Policies → Guardrails

保留底层 Policy 存储格式不变。Console UI 增加业务语义层：

| Guardrail 表达 | 引擎映射 |
|---------------|---------|
| Must call `[skills]` | `require_skills` + `hook: 'preFinalize'` |
| Never allow `[skills]` | `deny_skills` + `hook: 'preTool'` |
| AI evaluation | `enableLlm: true` + `evaluationPrompt` |

Guardrails 列表页和编辑页的 UI 用业务语言，底层存为现有 Policy JSON。交付人员也可以在 Advanced 模式直接编辑 raw JSON。

---

## 五、Case Types

### 5.1 执行模式

`executionMode`: **`'stage'`** / **`'sop'`** 二选一。

| 模式 | Agent 行为 |
|------|-----------|
| **Stage** | LLM 在阶段约束内执行，`StageExecutor` 管理过渡 |
| **SOP** | CC 式完全信任，Agent 用 `todo_write`/`todo_read` 自主规划 |

### 5.2 Basic 区域

全部 CONFIGURABLE：`type`、`displayName`、`icon`、`description`、`defaultGoal`、`enabled`、`executionMode`、`stages`、`requiredFacts`、`escalateOn`、`requireHumanReview`、`autoCloseConditions`。

### 5.3 Stage Config

| 字段 | 决策 |
|------|------|
| `description`、`systemPrompt` | **CONFIGURABLE** |
| `requiredSkills`、`availableSkills` | **CONFIGURABLE** |
| `evidenceRequirements` | **CONFIGURABLE** |
| `transition` | **CONFIGURABLE**（stage 模式核心） |
| `sop`（per-stage） | **CONFIGURABLE**（SOP prompt 附录） |
| `subAgents` | **CONFIGURABLE**（含 model、taskTemplate、maxIterations 等子代理运行参数） |
| `model` / `temperature` / `thinkingBudget`（per-stage） | **CONFIGURABLE**（覆盖 Agent 级默认值） |

---

## 六、Routing

全部 CONFIGURABLE：`queue`、`description`、`priority`、`maxWaitingTime`、`skillsAllowed`、`autoAssign`。

---

## 七、Knowledge

| 字段 | 决策 |
|------|------|
| `name`、`description`、`groupIds`、`enabled`、`topK`、`caseTypeTag` | **CONFIGURABLE** |
| `gptbotsApiKey` | **CONFIGURABLE**（已支持 per-customer） |
| `embeddingRate`、`rerankVersion`、`docCorrelation` | **CONFIGURABLE**（Advanced 折叠） |

---

## 八、Integrations

全部 CONFIGURABLE。建议新增 `channelSkillBinding`（哪些 skill 暴露给 Chat vs LiveChat vs API）。

---

## 九、汇总

| 级别 | 数量 | 关键项 |
|------|------|--------|
| **READ-ONLY** | 3 项 | System Skill 的 `name`、`inputSchema`、`mode` |
| **HARDCODE** | 5 项 | `guardPhase`、`isConcurrencySafe`、`showThinking`、`debugMode`、`enableLlmSanitization` |
| **REMOVE** | 1 组 | `prefixContinuation*`（移到 Composer Assist） |
| **CONFIGURABLE** | 其余全部 | 包括 model、temperature、thinkingBudget、maxIterations、memory 参数、sub-agent 参数、endpoint、headers 等 |

---

## 十、实施 Roadmap

| 优先级 | 范围 |
|--------|------|
| **P0** | Skills 页面 System/Business 区分布局 + READ-ONLY 字段锁定 |
| **P0** | Memory slider + Advanced 展开 |
| **P1** | Policies → Guardrails 业务语义 UI |
| **P1** | Agent Config 移除 showThinking/debugMode/prefixContinuation |
| **P2** | Skills 新增 uiHints / triggerKeywords / allowedChannels |
| **P2** | Case Types SOP 模式 SOP 文档编辑器 |
| **P3** | Integrations channelSkillBinding |
