# Console 可视化配置取舍

> **原则**：Console 是给产品交付人员用的，不是给工程师用的。
> 交付人员的思维模型是 "这个 case 走什么流程、用什么能力、什么时候升级人工"，
> 不是 "temperature 设多少、compaction 阈值多少 token、embedding 用哪个 provider"。
>
> 对照 CC 源码：CC 把 Tool 定义、Agent Loop、权限引擎全部 hardcode，只把 Skill
> （SKILL.md + frontmatter）开放给用户。Intera 作为 SaaS，Console 配置面应该比 CC
> 宽（因为有 case flow 这个维度），但不能把工程实现细节暴露出去。

---

## 一、总览

| 决策 | 含义 | 数量 |
|------|------|------|
| **KEEP** | 保留可视化配置，交付人员操作 | 约 35 项 |
| **SIMPLIFY** | 保留配置意图，但 UI 从技术参数改为业务语义 | 约 15 项 |
| **HARDCODE** | 从 Console 移除，写进代码或 Prisma seed | 约 45 项 |
| **REMOVE** | 删除，连代码层也不需要 | 约 10 项 |
| **ADD** | 当前缺失，建议新增 | 约 8 项 |

---

## 二、Skills 管理（`apps/console/app/admin/skills/`）

当前暴露了 14 个可配置字段。其中大部分是工程细节，交付人员只需要关心 "这个能力叫什么、做什么、怎么展示"。

### 逐字段决策

| 字段 | 决策 | 理由 |
|------|------|------|
| `name` | **KEEP** | 技能标识，交付人员需要知道技能名称 |
| `description` | **KEEP** | 描述技能功能，注入 LLM prompt 和 Console 展示 |
| `mode` (mock/http) | **HARDCODE** | 对交付人员无意义。内置系统技能永远是 mock（代码执行），外部业务技能永远是 http。写进 `SKILL_DEFAULTS` |
| `endpoint` | **HARDCODE** | URL 是工程集成细节。外部服务接入时由工程师配置一次，交付人员不碰 |
| `httpMethod` | **HARDCODE** | 同样，由工程师设定 |
| `headers` | **HARDCODE** | 认证 token 等敏感信息，不应暴露在 Console |
| `timeoutMs` | **HARDCODE** | 工程优化参数，用 `SKILL_DEFAULTS.timeoutMs = 10000` |
| `mockFixture` | **HARDCODE** | 开发/测试用，生产无意义。内置技能写进代码，外部技能无此字段 |
| `inputSchema` | **KEEP**（只读） | 技能的输入参数定义是**契约**——集成方需要知道有哪些字段。但不应由交付人员手写 JSON Schema。改为：从代码/外部服务自动推导，Console 只读展示 |
| `outputSchema` | **REMOVE** | 当前未实际使用，仅展示。output 的渲染方式应由 `uiHints.resultRenderAs` 替代 |
| `guardPhase` | **HARDCODE** | pre/post 是 PolicyEngine 的职责，不应挂在 Skill 上 |
| `isConcurrencySafe` | **HARDCODE** | 工程决策。查询类=true，写入类=false。写进 `SKILL_DEFAULTS` |
| `enabled` | **KEEP** | 交付人员需要能开关技能 |
| `displayVerb` | **KEEP** | "正在查询订单..." 这类进行时文案，交付人员应能定制 |

### 建议新增

| 新增字段 | 说明 |
|----------|------|
| `uiHints` | **ADD** — 集成方渲染提示：`renderAs`（form/confirm/picker/card）、`fields`（每字段的 widget 类型/label/校验规则）、`resultRenderAs`。这是 "能力在 Intera，体验在集成层" 的关键契约 |
| `triggerConditions` | **ADD** — 关键词/意图匹配时才注入 prompt。减少无关技能占用上下文 |
| `allowedIntegrations` | **ADD** — 此技能暴露给哪些集成通道（chat / livechat / api / 全部） |

### 改造后的 Skill 表单

```
┌─ Skill Builder ─────────────────────────────────────┐
│                                                       │
│  Name: [query_order_status_________________]          │
│  Description: [查询用户订单的当前状态和物流信息___]     │
│                                                       │
│  ── UI Hints ────────────────────────────────────    │
│  How should integrations render this skill?           │
│  Render as: [Card ▾]                                  │
│  Result as: [Table ▾]                                 │
│  Display verb: [正在查询订单状态..._______________]    │
│                                                       │
│  ── Activation ──────────────────────────────────    │
│  Trigger keywords: [订单, 物流, 配送__________]       │
│  Trigger intents:  [order_inquiry________________]    │
│                                                       │
│  ── Integration Binding ────────────────────────     │
│  Expose to:  [✓] Chat  [✓] LiveChat  [ ] API         │
│                                                       │
│  [Enabled ✓]                          [Save]          │
└───────────────────────────────────────────────────────┘
```

### 2.1 System Skill vs Business Skill：只读 + 默认开启 + 置顶

**完全同意。** 这和 CC 的 Tool（硬编码、不可改）vs Skill（用户可扩展）的分离逻辑一致，适配到 SaaS Console 场景：

| | System Skill | Business Skill |
|---|---|---|
| **来源** | `BUILT_IN_SKILLS` 代码定义 | Prisma `skill` 表，Console 创建 |
| **核心定义** | **只读**（name, inputSchema, mode, endpoint） | 可编辑 |
| **运行设置** | 可配（enabled, displayVerb, uiHints, triggerConditions） | 全部可配 |
| **默认状态** | **默认开启**（`enabled: true`） | 创建时默认关闭，手动开启 |
| **删除** | **不可删除** | 可删除 |
| **列表位置** | **置顶 + 高亮** | System Skills 下方 |
| **视觉区分** | 左侧 "System" 徽章 + 浅蓝底色 | 无徽章 |

#### 为什么运行设置仍然可配

`name`、`inputSchema`、`mode` 锁定是因为它们是**契约**——改了会导致集成方和 LLM 行为错乱。

但 `enabled`、`displayVerb`、`uiHints`、`triggerConditions` 是**运营配置**——不同客户/不同集成通道可能需要不同的展示方式和触发条件。例如同一个 `query_order_status`：
- 客户 A（电商）→ displayVerb: "正在查询订单状态..."
- 客户 B（金融）→ displayVerb: "正在核实交易记录..."

#### 为什么默认开启

System Skill 是 Intera 开箱即用的核心能力。新 customer 接入时，`SkillRouter.create()` 从 `BUILT_IN_SKILLS` 初始化，全部 `enabled: true`。交付人员在 Console 看到的是 "这些都是可用的"，只需要关掉不需要的——比 "这些都是关着的，你需要一个个打开" 的学习成本低得多。

#### Skills 页面布局

```
┌─ Skills ──────────────────────────────────────────────────────────┐
│ [ + New Business Skill ]                           [Search...]    │
│                                                                     │
│ ┌─ System Skills ─────────────────────────────────────────────┐  │
│ │                                                               │  │
│ │ ┌──────────────────────────────────────────────────────────┐ │  │
│ │ │ 🔵 SYSTEM  query_order_status    [✓] enabled              │ │  │
│ │ │ 查询订单状态和物流信息                                     │ │  │
│ │ │ displayVerb: 正在查询订单...   trigger: 订单, 物流        │ │  │
│ │ │                                              [Configure]  │ │  │
│ │ └──────────────────────────────────────────────────────────┘ │  │
│ │ ┌──────────────────────────────────────────────────────────┐ │  │
│ │ │ 🔵 SYSTEM  create_case           [✓] enabled              │ │  │
│ │ │ 创建新的客服工单                                           │ │  │
│ │ │ displayVerb: 正在创建工单...   trigger: (always active)   │ │  │
│ │ │                                              [Configure]  │ │  │
│ │ └──────────────────────────────────────────────────────────┘ │  │
│ │ ┌──────────────────────────────────────────────────────────┐ │  │
│ │ │ 🔵 SYSTEM  finalize_case         [✓] enabled              │ │  │
│ │ │ 结案并生成处理报告                                         │ │  │
│ │ │ displayVerb: 正在生成报告...   trigger: (terminal)        │ │  │
│ │ │                                              [Configure]  │ │  │
│ │ └──────────────────────────────────────────────────────────┘ │  │
│ │ ... 其余 15 个 System Skills ...                               │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│ ┌─ Business Skills ───────────────────────────────────────────┐  │
│ │                                                               │  │
│ │ ┌──────────────────────────────────────────────────────────┐ │  │
│ │ │ handle_refund              [✓] enabled                   │ │  │
│ │ │ 处理退款请求，验证订单后发起退款                           │ │  │
│ │ │ endpoint: https://api.crm.com/refund                     │ │  │
│ │ │                                    [Edit] [Delete]       │ │  │
│ │ └──────────────────────────────────────────────────────────┘ │  │
│ │ ┌──────────────────────────────────────────────────────────┐ │  │
│ │ │ send_satisfaction_survey    [ ] disabled                 │ │  │
│ │ │ 发送满意度调查问卷                                         │ │  │
│ │ │                                    [Edit] [Delete]       │ │  │
│ │ └──────────────────────────────────────────────────────────┘ │  │
│ └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Configure 弹窗（System Skill）

System Skill 点击后不是全量编辑表单，而是一个**精简配置面板**——只能改运行设置：

```
┌─ query_order_status (System) ──────────────────────────────┐
│                                                              │
│  🔒 Core Definition (read-only)                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ name: query_order_status                                ││
│  │ mode: mock (built-in execution)                         ││
│  │ inputSchema: { orderId: string, userId?: string }       ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ── Operational Settings ───────────────────────────────    │
│  Enabled: [✓]                                               │
│  Display Verb: [正在查询订单状态...___________________]      │
│                                                              │
│  ── UI Hints ──────────────────────────────────────        │
│  Render as: [Card ▾]                                        │
│  Result as: [Table ▾]                                       │
│                                                              │
│  ── Activation ────────────────────────────────────        │
│  Trigger keywords: [订单, 物流, 配送________________]        │
│  Trigger intents:  [order_inquiry___________________]        │
│                                                              │
│  ── Integration Binding ──────────────────────────         │
│  [✓] Chat  [✓] LiveChat  [ ] API                            │
│                                                              │
│                                        [Save]                │
└──────────────────────────────────────────────────────────────┘
```

#### 实现

```typescript
// apps/chat/lib/agent/skills.ts

interface SystemSkillDefinition extends SkillDefinition {
  readonly system: true
  readonly coreFields: {
    name: string
    inputSchema: object
    mode: 'mock' | 'http'
    endpoint?: string
    isConcurrencySafe: boolean
  }
}

// SkillRouter 加载时，System Skills 的 coreFields 不可被 DB 覆盖
async create(customerId: string): Promise<SkillRouter> {
  const router = new SkillRouter()

  // 1. 加载 System Skills（默认全部 enabled）
  for (const sys of BUILT_IN_SYSTEM_SKILLS) {
    router.registerSystem(sys)
  }

  // 2. 加载 DB 中的覆盖（只覆盖运行设置：enabled, displayVerb, uiHints, triggerConditions）
  const dbOverrides = await prisma.skill.findMany({ where: { customerId, system: false } })
  for (const override of dbOverrides) {
    router.applyOverride(override.name, {
      enabled: override.enabled,
      displayVerb: override.displayVerb,
      uiHints: override.uiHints,
      triggerConditions: override.triggerConditions,
    })
  }

  // 3. 加载 Business Skills
  const businessSkills = await prisma.skill.findMany({ where: { customerId, system: false } })
  for (const biz of businessSkills) {
    router.registerBusiness(biz)
  }

  return router
}
```

#### 对应 Prisma Schema

```prisma
model Skill {
  name        String   @id
  customerId  String
  system      Boolean  @default(false)  // NEW: true = System Skill

  // 核心定义（System Skill 时只读）
  description   String
  inputSchema   Json
  mode          String   @default("mock")
  endpoint      String?
  httpMethod    String?
  headers       Json?
  timeoutMs     Int      @default(10000)
  isConcurrencySafe Boolean @default(false)

  // 运行设置（System Skill 和 Business Skill 都可配）
  enabled      Boolean  @default(false)
  displayVerb  Json?

  // 运营配置（新增字段）
  uiHints           Json?    // renderAs, fields, resultRenderAs
  triggerConditions Json?    // keywords, intents
  allowedIntegrations String[] // chat, livechat, api

  // Business Skill 专属
  mockFixture Json?

  customer Customer @relation(fields: [customerId], references: [id])
}
```

---

## 三、Agent 配置（`apps/console/app/admin/agent/`）

这是当前最过载的页面——6 个 drawer section，暴露了 50+ 个可配置字段。大部分是工程调参，交付人员不该碰。

### 3.1 Prompt 区域

| 字段 | 决策 | 理由 |
|------|------|------|
| `systemPrompt` | **KEEP** | **核心差异化配置。** 决定了 Agent "怎么说话"、行为风格、边界约束。不同客户/不同 case type 的 prompt 完全不同。模板变量（`{{case_types}}` 等）保留 |

### 3.2 Model 区域

| 字段 | 决策 | 理由 |
|------|------|------|
| `model` | **HARDCODE** | 交付人员不需要知道用 Sonnet 还是 Haiku。模型选型是工程/成本决策。写进 `packages/shared/defaults/index.ts`，按部署环境覆盖 |
| `evaluationModel` | **HARDCODE** | Stage 过渡评估、Policy LLM 评估统一用轻量模型（如 Haiku），不应暴露 |
| `temperature` | **HARDCODE** | 客服场景应固定低温度（0.1-0.3），交付人员调这个容易让 Agent 行为不稳定 |
| `thinkingBudget` | **HARDCODE** | 成本/性能权衡，工程决策 |
| `maxIterations` | **HARDCODE** | 固定 15-20，防止死循环。写进 `AgentLoop` 默认值 |
| `maxOutputTokens` | **HARDCODE** | 基础设施参数 |
| `showThinking` | **REMOVE** | 调试功能。如果 Chat 需要展示思考过程，由 Chat 的 UI 配置决定，不是 Agent 配置 |
| `enableLlmSanitization` | **HARDCODE** | 安全检查应始终开启，不应该有开关 |
| `prefixContinuation*` (5 个字段) | **REMOVE** | Composer Assist 是独立的聊天输入辅助功能，不属于 Agent 配置。如果保留此功能，移到独立的 `/admin/composer-assist` 页面 |

### 3.3 Memory 区域（最需要动刀的区域）

**全部 20+ 字段 → HARDCODE**

| 当前暴露的字段 | 问题 |
|--------------|------|
| `autocompactThresholdTokens` / `warningThresholdTokens` / `errorThresholdTokens` / `blockingThresholdTokens` | token 数是工程概念，交付人员的思维是 "对话长了会不会丢上下文" |
| `l1MaxMessages` / `l2SummaryMaxTokens` / `l4MaxHistoricalCases` / `maxRecentTraces` | 四层记忆的内部参数，没有人能调对 |
| `compactModel` / `compactTemperature` / `compactMaxTokensCap` / `compactionKeepMin` / `compactionKeepRatio` | LLM 压缩的内部参数 |
| `enableAutocompact` / `enableMicrocompact` / `enableContextCollapse` / `enableSnip` | 压缩策略应始终全开，不应是开关 |
| `debugMode` | 开发者工具，写入 `.env` 或开发者文档 |

**替代方案**：用**一个业务语义的 slider** 替代 20+ 个工程参数：

```
Memory:  ( ) Short-term  (•) Balanced  ( ) Long-term

  Short-term: 保留最近 ~8 轮对话，适合快速解决的简单 case
  Balanced:   保留 ~20 轮 + 压缩摘要，适合一般客服工单
  Long-term:  保留 ~40 轮 + 详细摘要，适合复杂调查 case
```

引擎内部把这三个档位映射到对应的 token 阈值和压缩参数。**交付人员选档位，引擎处理细节。**

### 3.4 Policy Hooks 区域

| 当前实现 | 决策 | 理由 |
|---------|------|------|
| 三列拖拽分配器（preTool/postTool/preFinalize） | **SIMPLIFY** | 见 §四 "Policy → Guardrails 改造" |

### 3.5 Human Interaction 区域

| 字段 | 决策 | 理由 |
|------|------|------|
| `consultationPrompt` | **KEEP** | 人工坐席与 Agent 协作时的系统提示，交付人员需要定制 |
| `humanSkills` | **KEEP** | 人工坐席可用哪些技能 |

### 3.6 Knowledge Retrieval 区域

| 字段 | 决策 | 理由 |
|------|------|------|
| `mode` | **SIMPLIFY** | 改为 boolean `enableKnowledge`。底层用 external-api 还是 intera-native 是工程决策 |
| `externalEndpoint` / `externalApiKeyEnvVar` | **HARDCODE** | API 密钥和端点由工程师配置 |
| `embeddingProvider` / `embeddingModel` / `embeddingBaseUrl` | **HARDCODE** | Embedding 基础设施选型 |
| `enableReranker` / `rerankProvider` | **HARDCODE** | Rerank 策略是工程优化 |
| `enableContextualRetrieval` / `contextualModel` | **HARDCODE** | 实验性功能 |
| `topK` | **KEEP** | "返回多少条相关文档"是交付人员能理解的业务概念 |
| `minRelevanceScore` | **KEEP** | "相关度多低就不返回"同样是业务概念 |

---

## 四、Policy → Guardrails 改造（`apps/console/app/admin/policies/`）

### 问题

当前 Policy 配置是底层引擎概念的 1:1 映射：
- `deny_skills` / `require_skills` / `require_skills_any` / `hook_skills`
- `enableLlm` + `evaluationPrompt`
- `hook`: `preTool` / `postTool` / `preFinalize`

交付人员的思维模型不是 "在 postTool hook 上设一个 require_skills_any 规则"。
他们的思维是 "关单前必须核实身份"。

### 对照 CC

CC 把 Policy 的执行引擎完全 hardcode（`deny-rules` 匹配 + `checkPermissions()`），用户只能在 `settings.json` 里加 allow/deny 规则。Intera 作为 SaaS 需要比 CC 更可配，但不能直接把引擎 API 暴露出去。

### 改造方案：Guardrails Builder

**KEEP** 策略的存在性和启用/禁用，但改为业务语义的表达方式：

```
┌─ Guardrails ─────────────────────────────────────────────┐
│                                                            │
│  Name: [身份核实检查_______________________________]       │
│  Description: [关单前确保已完成用户身份验证_________]      │
│                                                            │
│  When:  [Before closing a case ▾]                          │
│         Options: Before any tool / After any tool /        │
│                  Before case resolution                    │
│                                                            │
│  Rule Type:  [Must verify ▾]                               │
│         Options:                                            │
│         • Must call — 必须调用了指定技能                    │
│         • Never allow — 完全禁止指定技能                    │
│         • Must verify (AI) — AI 评估是否满足条件           │
│         • Escalate if — 条件满足时升级人工                  │
│                                                            │
│  Target skills:  [verify_identity] [×]                     │
│  Applies to:     [✓] All case types                        │
│                                                            │
│  (If AI evaluation):                                       │
│  Condition: [用户身份已验证且与工单信息一致_________]       │
│                                                            │
│  [Enabled ✓]                               [Save]          │
└────────────────────────────────────────────────────────────┘
```

**底层映射**（引擎负责，Console 不感知）：

| Guardrail 表达 | 引擎映射 |
|---------------|---------|
| Must call `[skills]` | `require_skills` |
| Never allow `[skills]` | `deny_skills` |
| Must verify (AI) `[condition]` | `enableLlm` + `evaluationPrompt` |
| Escalate if `[condition]` | `hook_skills: ['create_human_task']` |

### 逐字段决策

| 当前字段 | 决策 |
|---------|------|
| `name`, `description` | **KEEP** |
| `hook` (preTool/postTool/preFinalize) | **SIMPLIFY** → "When" 选择器（Before tool / After tool / Before closing） |
| `deny_skills` / `require_skills` / `require_skills_any` / `hook_skills` | **SIMPLIFY** → "Rule Type" + "Target skills" |
| `enableLlm` + `evaluationPrompt` | **SIMPLIFY** → AI evaluation toggle + condition 文本 |
| `enabled` | **KEEP** |

---

## 五、Case Types（`apps/console/app/admin/case-types/`）

Case Type 定义是 Console 的核心价值——交付人员通过它定义 "这个业务场景走什么流程"。

### 5.1 Basic 区域

| 字段 | 决策 | 理由 |
|------|------|------|
| `type` (slug) | **KEEP** | 系统标识 |
| `displayName` | **KEEP** | Console 展示名 |
| `icon` | **KEEP** | 视觉区分 |
| `description` | **KEEP** | 交付人员理解 case 用途 |
| `defaultGoal` | **KEEP** | Agent 的目标描述 |
| `enabled` | **KEEP** | 开关 |
| `executionMode` | **KEEP**（简化为 `'stage'`/`'step'`） | 两种模式覆盖全部场景。移除 `'sop'`，SOP 文档退化为 `StageConfig.sop` 字段 |
| `stages` | **KEEP** | 阶段序列是核心配置 |
| `requiredFacts` | **KEEP** | 必须收集的信息 |
| `escalateOn` | **KEEP** | 什么条件触发人工 |
| `requireHumanReview` | **MERGE** 进 `StageConfig.transition` | "最终阶段需要人工确认" 是阶段过渡规则，不是 case 级别的独立开关 |
| `autoCloseConditions` | **SIMPLIFY** | 当前是 raw JSON。改为结构化条件：`[{ factKey, operator, value }]` |
| `sop` | **MERGE** 进 `StageConfig.sop` | SOP 文档是阶段级别的 prompt 附录。见 §5.2 |
| `sopMaxAutoTurns` | **REMOVE** | 退化为 `StepPolicy.maxRetries` |

### 5.2 Stage Config 区域（`apps/console/components/admin/stage-config-editor.tsx`）

| 字段 | 决策 | 理由 |
|------|------|------|
| `description` | **KEEP** | 阶段说明 |
| `model` / `temperature` / `thinkingBudget` | **HARDCODE** | 每阶段覆盖模型参数是过度设计。统一使用 Agent 级别的模型配置 |
| `systemPrompt` | **KEEP** | 每阶段的系统提示——核心差异化配置 |
| `requiredSkills` | **KEEP** | 建议/强制哪些技能 |
| `availableSkills` | **KEEP** | 阶段内可用技能白名单 |
| `evidenceRequirements` | **SIMPLIFY** | 当前是结构化编辑器（factKey/source/skillName/required）。保留但简化为 "需要收集: [factKey] (来自 [skillName])" |
| `guardrails` | **SIMPLIFY** | 见 §四——用 Guardrails Builder 替代 raw JSON rule |
| `transition` | **SIMPLIFY** | 当前三种 type + conditions + evaluationPrompt。改为： |
|  |  | `Auto: when [condition]`（选：all_skills_called / all_evidence / min_iterations） |
|  |  | `AI: [evaluation prompt]` |
|  |  | `Manual: operator confirms` |
| `subAgents` | **HARDCODE** | Sub-Agent 的 model/systemPrompt/taskTemplate/maxIterations 是工程配置。哪些阶段需要 Sub-Agent、Sub-Agent 能调哪些技能，由 Case Type 设计者决定——但 Sub-Agent 本身的运行参数不应暴露 |

### 5.3 建议新增

| 新增 | 说明 |
|------|------|
| `steps[]` (Step 模式) | **ADD** — 当 `executionMode === 'step'` 时，Stage Config 出现 Step 编辑器：每步的 goal / requiredTools / optionalTools / completionCriteria / onFailure。这是高确定性场景的核心配置 |
| `sop` (per-stage) | **ADD** — Markdown 编辑器，注入到该阶段的 system prompt 末尾。替代原来 case 级别的 `executionMode: 'sop'` |

---

## 六、Routing（`apps/console/app/admin/routing/`）

整体保留。路由配置是业务相关的。

| 字段 | 决策 | 理由 |
|------|------|------|
| `queue` | **KEEP** | 队列标识 |
| `description` | **KEEP** | 队列说明 |
| `priority` | **KEEP** | 优先级 |
| `maxWaitingTime` | **KEEP** | SLA 指标 |
| `skillsAllowed` | **KEEP** | 队列中允许的技能 |
| `autoAssign` | **KEEP** | 是否自动分配 |

---

## 七、Knowledge（`apps/console/app/admin/knowledge/`）

| 字段 | 决策 | 理由 |
|------|------|------|
| `name` / `description` | **KEEP** | 知识源标识 |
| `groupIds` | **KEEP** | 选择 GPTBots 知识库——交付人员能理解 |
| `enabled` | **KEEP** | 开关 |
| `topK` | **KEEP** | "返回几条"是业务概念 |
| `caseTypeTag` | **KEEP** | 知识源和 case type 的关联 |
| `embeddingRate` | **HARDCODE** | 关键词 vs 语义搜索的权重是搜索引擎调参 |
| `rerankVersion` | **HARDCODE** | Reranker 选型是工程决策 |
| `docCorrelation` | **HARDCODE** | 相关性阈值，与 `embeddingRate` 联动调参 |
| `dataIds` | **REMOVE** | 当前未在 UI 暴露，且过于细粒度 |

**简化后的 Knowledge 表单**：

```
┌─ Knowledge Source ───────────────────────────────────┐
│ Name: [支付相关FAQ___________________________]        │
│ Description: [包含充值、提现、退款相关文档____]        │
│ Knowledge Base: [Payment_FAQ ▾]                       │
│   (从 GPTBots 拉取列表)                               │
│ Applies to: [deposit_issue, withdraw_issue ▾]         │
│ Results to return: [5___]                             │
│ [Enabled ✓]                          [Test] [Save]    │
└──────────────────────────────────────────────────────┘
```

---

## 八、Integrations（`apps/console/app/admin/integrations/`）

保留并扩展。

| 字段 | 决策 | 理由 |
|------|------|------|
| `enabled` | **KEEP** | LiveChat 开关 |
| `licenseId` / `botAccessToken` | **KEEP** | LiveChat 平台凭证 |
| `showSkillStatus` | **KEEP** | 是否在对话中展示技能执行状态 |

### 建议新增

| 新增 | 说明 |
|------|------|
| `channelSkillBinding` | **ADD** — 哪些技能暴露给 Chat vs LiveChat vs API。同一套 Intera 配置，不同集成通道展示不同的技能列表。这是 "能力在 Intera，体验在集成层" 的关键配置 |
| `rateLimit` | **ADD** — 每个集成通道的速率限制（每用户/每分钟） |
| `webhookEvents` | **ADD** — 哪些事件推送给外部 webhook（case_created / case_closed / human_escalated） |

---

## 九、决策汇总

### 从 Console 移除（HARDCODE 到代码/defaults/seed）

这些字段从 UI 消失，值由工程团队管理：

```
Agent Config:
  model, evaluationModel, temperature, thinkingBudget
  maxIterations, maxOutputTokens, showThinking
  enableLlmSanitization
  prefixContinuation* (5 个字段)
  Memory 全部 20+ 字段 → 一个三档 slider 替代

Stage Config (per-stage):
  model, temperature, thinkingBudget
  subAgents 的运行参数 (model, maxIterations, taskTemplate 保留但只读)

Skills:
  mode, endpoint, httpMethod, headers, timeoutMs, mockFixture
  guardPhase, isConcurrencySafe

Knowledge:
  embeddingRate, rerankVersion, docCorrelation

Case Types:
  sopMaxAutoTurns
```

### 从代码层删除（REMOVE）

```
Agent Config:
  showThinking (调试功能)
  debugMode (开发者功能)
  prefixContinuation* (独立功能，不属于 Agent 配置)

Skills:
  outputSchema (改用 uiHints.resultRenderAs)

Case Types:
  sopMaxAutoTurns (改用 StepPolicy.maxRetries)
  requireHumanReview (合并进 transition)
```

### 简化的（SIMPLIFY——保留意图，改 UI）

```
Policy page:
  deny_skills/require_skills/hook_skills/evaluationPrompt
  → Guardrails Builder (业务语义)

Case Types:
  autoCloseConditions: raw JSON → 结构化条件
  evidenceRequirements: 结构简化
  guardrails: raw JSON → Guardrails Builder
  transition: 三种 type → Auto/AI/Manual 清晰选择
  stages: JSON array → 拖拽排序的 Stage 列表

Agent Config:
  Memory 全部字段 → 三档 slider (Short-term / Balanced / Long-term)
  Knowledge Retrieval mode → boolean enableKnowledge
```

### 新增的（ADD）

```
Skills:
  uiHints (renderAs, fields, validation, resultRenderAs)
  triggerConditions (keywords, intents)
  allowedIntegrations (chat/livechat/api)

Stage Config:
  steps[] (Step 模式：goal/requiredTools/completionCriteria/onFailure)
  sop (Markdown prompt 附录)

Integrations:
  channelSkillBinding
  rateLimit
  webhookEvents
```

### 保持不变的（KEEP）

```
Skills: name, description, enabled, displayVerb, inputSchema (只读)
Agent Config: systemPrompt, consultationPrompt, humanSkills
Case Types: type, displayName, icon, description, defaultGoal, enabled,
            executionMode, stages, requiredFacts, escalateOn
Stage Config: description, systemPrompt, requiredSkills, availableSkills
Routing: 全部 6 个字段
Knowledge: name, description, groupIds, enabled, topK, caseTypeTag
Integrations: enabled, licenseId, botAccessToken, showSkillStatus
```

---

## 十、实施 Roadmap

| 优先级 | 范围 | 工作量 |
|--------|------|--------|
| **P0** | Memory 区域简化（20+ 字段 → 三档 slider） | 小 |
| **P0** | Model 区域 hardcode（移除 model/temperature/threshold） | 小 |
| **P1** | Policy → Guardrails Builder 改造 | 中 |
| **P1** | Skills 移除工程字段 + 新增 uiHints/triggerConditions | 中 |
| **P2** | Case Types 简化（autoCloseConditions 结构化、evidence 简化） | 中 |
| **P2** | Knowledge 移除工程字段 | 小 |
| **P3** | Stage Config 新增 steps[] + sop 字段 | 大 |
| **P3** | Integrations 新增 channelSkillBinding/rateLimit/webhookEvents | 中 |
