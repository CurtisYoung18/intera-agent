# Claude Code vs Intera — 差距分析与闪光点

> 基于 `claude-code-source-code-ref-only/` 源码与 Intera 当前实现的对比。
> 目的：识别可借鉴的设计，为 Intera 重构提供方向。

---

## 1. 统一 Agent Loop（最关键差距）

**CC**：主 Agent 和 Sub-Agent 跑完全相同的 `query()` async generator。上下文压缩、自动降级、错误恢复、tool 执行——全部共享同一套逻辑。

**Intera**：[`apps/chat/lib/agent/loop.ts`](apps/chat/lib/agent/loop.ts) 的 `AgentLoop` 和 [`apps/chat/lib/agent/sub-agent.ts`](apps/chat/lib/agent/sub-agent.ts) 的 `SubAgent` 是两套独立实现。SubAgent 缺少：
- `StreamingTextSanitizer` 保护
- `StageExecutor` 阶段流转评估（[`apps/chat/lib/agent/stage-executor.ts`](apps/chat/lib/agent/stage-executor.ts)）
- 完整的 Policy 三层 Hook（[`apps/chat/lib/agent/policy.ts`](apps/chat/lib/agent/policy.ts) 的 `preTool`/`postTool`/`preFinalize`）
- 上下文压缩只做简单截断，缺少 [`apps/chat/lib/agent/compact.ts`](apps/chat/lib/agent/compact.ts) 的 LLM 压缩

**影响**：SubAgent 更笨、更容易崩溃、更少护栏。

---

## 2. Fork Sub-Agent + Prompt Cache 共享

**CC**：Fork 模式下，子代理**继承父 Agent 的完整系统提示词和工具定义**。Anthropic API 按请求前缀匹配 cache——N 个并行子代理共享同一份 prompt cache。

**Intera**：[`apps/chat/lib/agent/orchestrator.ts`](apps/chat/lib/agent/orchestrator.ts) 的 `OrchestratorAgent.dispatch()` 为每个 SubAgent 从零构建 tools 和 prompt，无 cache 共享。

---

## 3. 四层上下文压缩

**CC**：microcompact / history snip / context collapse / auto-compact / reactive compact

**Intera** 当前实现：
- [`apps/chat/lib/agent/microCompact.ts`](apps/chat/lib/agent/microCompact.ts) — microcompact（每轮 tool result 清理）
- [`apps/chat/lib/agent/compact.ts`](apps/chat/lib/agent/compact.ts) — LLM 压缩
- [`apps/chat/lib/agent/sessionMemoryCompact.ts`](apps/chat/lib/agent/sessionMemoryCompact.ts) — 会话记忆复用

**缺失**：context collapse 跨轮持久化摘要、reactive compact 413 兜底。

---

## 4. 三个自动错误恢复路径

**CC** 的 loop 内置三层恢复：model fallback / max_output_tokens 升档重试 / 413 prompt-too-long 兜底。

**Intera**：[`apps/chat/lib/agent/loop.ts`](apps/chat/lib/agent/loop.ts) 遇到这些错误基本是 `catch → break`，退出 loop。用户看到"Agent 处理失败"。

---

## 5. `isConcurrencySafe()` 粒度

**CC**：`isConcurrencySafe(input)` 接受输入参数，按参数判断。同一个 tool 不同调用可能不同安全策略。

**Intera**：[`apps/chat/lib/agent/streaming-tool-executor.ts`](apps/chat/lib/agent/streaming-tool-executor.ts) 的并发判断基于 [`packages/shared/types/index.ts`](packages/shared/types/index.ts) 中 `SkillDefinition.isConcurrencySafe` 静态 boolean。粒度粗糙。

---

## 6. In-Process Teammate + SendMessage

**CC**：同一进程内多个 Agent 通过 `SendMessage({to: name})` 实时通信。

**Intera**：[`apps/chat/lib/agent/orchestrator.ts`](apps/chat/lib/agent/orchestrator.ts) 的 SubAgent 间通信只能靠 Dashboard 轮询 [`apps/chat/lib/agent/memory.ts`](apps/chat/lib/agent/memory.ts) 的 `dashboardVersion`。延迟至少一个迭代周期。

---

## 7. Query Chain Tracking

**CC**：每次 `query()` 携带 `chainId`（UUID）+ `depth`（递归层级递增），提供完整 Agent 树的可观测性。

**Intera**：[`packages/shared/types/index.ts`](packages/shared/types/index.ts) 的 `AgentContext` 类型（line 587-608）已定义了 `chainId` + `depth` 字段，但 [`apps/chat/lib/agent/trace.ts`](apps/chat/lib/agent/trace.ts) 的 `TraceWriter` 未在 SubAgent 链路中传递。**类型已就绪，缺的是执行层的透传。**

---

## 8. 安全分类（Handoff Classification）

**CC**：Auto-mode 下，sub-agent 完成后运行二次模型调用评估安全性。

**Intera**：[`apps/chat/lib/agent/policy.ts`](apps/chat/lib/agent/policy.ts) 的 `PolicyEngine` 在 `AgentLoop` 中运行 preTool/postTool/preFinalize。SubAgent 结果合并时没有独立的安全评估层。

---

## 9. Skill 注册管线：`createSkillDefinition()` 工厂 + 多层过滤

**CC 精华**：`buildTool()` 工厂 → `getAllBaseTools()` → `getTools()` → `assembleToolPool()` 四层管线，每层职责清晰。

**Intera 现状**：[`apps/chat/lib/agent/skills.ts`](apps/chat/lib/agent/skills.ts) 的 `SkillRouter` 用一个 `Map<string, SkillDefinition>` 平铺所有技能。`BUILT_IN_SKILLS`（line 19-684）是硬编码数组，`SkillRouter.create()` 从 Prisma 加载 DB 技能覆盖同名内置项。`getTools()` 一次性全量返回 Anthropic 格式。

**差距**：
- 无工厂模式——每个 `SkillDefinition` 是手写的对象字面量，缺少安全默认值
- 无分层过滤——`getTools()` 只做 `enabled` 过滤，没有 deny-rules、没有 feature-gate、没有 `isEnabled()` 运行时检查
- 工具过滤分散在各处——`StageExecutor.filterTools()`（[`apps/chat/lib/agent/stage-executor.ts:170-216`](apps/chat/lib/agent/stage-executor.ts#L170-L216)）、`ConversationLoop.filterTools()`（[`apps/chat/lib/agent/conversation-loop.ts:48-50`](apps/chat/lib/agent/conversation-loop.ts#L48-L50)）、`SubAgent.buildTools()`（[`apps/chat/lib/agent/sub-agent.ts:261-278`](apps/chat/lib/agent/sub-agent.ts#L261-L278)）各自实现过滤逻辑，无统一入口

---

## 10. Skills 延迟加载 vs 全量加载

**CC 精华**：六层延迟加载（条件性 path-based / 动态目录发现 / 捆绑惰性提取 / MCP 动态注册 / 远程按需加载 / 文件监视器）。Skills 列表预算为上下文窗口的 1%。

**Intera 现状**：`SkillRouter.create()` 启动时全量加载 `BUILT_IN_SKILLS` + Prisma 数据库技能。无按需激活、无 prompt 预算。

**Intera 的优势**：作为 SaaS 系统，Skills 天然存储在数据库中，天然支持**热更新**——Console 修改 Skill 后，Chat runtime 通过 [`apps/chat/lib/agent/config-cache.ts`](apps/chat/lib/agent/config-cache.ts) 的缓存失效机制重新加载。这比 CC 的文件监视器更适合 SaaS 场景。

**应借鉴的**：
- **条件激活**：Skill 可以绑定 `triggerIntents: string[]`（意图匹配）或 `triggerKeywords: string[]`（关键词匹配），只有匹配时才注入 prompt，减少无关 Skill 的 prompt 占用
- **Prompt 预算**：`SkillRouter.getTools()` 返回的工具描述总长度应有上限，超出部分按使用频率截断

---

## 11. 内置 Skill vs 可配置 Skill 架构分离

**CC 精华**：Tool = `buildTool()` 硬编码（`tools/` 目录），Skill = SKILL.md 用户可扩展。两者定义方式、注册时机、扩展方式、权限模型完全不同。

**Intera 现状**：`BUILT_IN_SKILLS` 和数据库 Skills 共用同一个 `SkillDefinition` 类型（[`packages/shared/types/index.ts:81-101`](packages/shared/types/index.ts#L81-L101)），通过 `mode: 'mock' | 'http'` 区分执行方式。**没有架构层面的分离**——内置技能和可配置技能在 `SkillRouter` 的 `Map` 里平权。

**应借鉴的**：分离为两层：

| | 系统 Skill（Hardcoded） | 业务 Skill（Console 配置） |
|---|---|---|
| **Intera 命名** | `SystemSkill` | `BusinessSkill` |
| **定义位置** | `apps/chat/lib/agent/skills.ts` 的 `BUILT_IN_SKILLS` | Console 数据库 `skill` 表 |
| **执行方式** | `StreamingToolExecutor` 直接执行 `call()` | `StreamingToolExecutor` 的 `executeHttp()` 调用外部端点 |
| **可修改性** | 发版更新 | Console UI 即时修改 |
| **权限模型** | 系统级 deny-rules | `PolicyEngine` 的 `allowedSkills` 白名单 |
| **uiHints** | 硬编码在 `SystemSkill` 定义中 | Console "Skill Builder" 中配置 |

---

## 12. Sub-Agent 工具权限分级

**CC 精华**：三级权限集——`ALL_AGENT_DISALLOWED_TOOLS`、`ASYNC_AGENT_ALLOWED_TOOLS`、`COORDINATOR_MODE_ALLOWED_TOOLS`。

**Intera 现状**：SubAgent 权限通过 [`packages/shared/types/index.ts:475-483`](packages/shared/types/index.ts#L475-L483) 的 `SubAgentConfig.skills[]` 白名单控制。[`apps/chat/lib/agent/sub-agent.ts:261-278`](apps/chat/lib/agent/sub-agent.ts#L261-L278) 的 `buildTools()` 只取 `config.skills` 中列出的技能。`StageExecutor.filterTools()` 在 stage 级别再做一层过滤。

**已有的好东西**：`StageExecutor` 的阶段级工具过滤（`availableSkills` / `requiredSkills`）+ `ConversationLoop` 的 `CORE_ALLOWED_TOOLS` 已经是一种分层权限。**比 CC 更精细的地方**：Intera 可以按 stage 动态调整工具可用性，CC 没有这个维度。

**应补齐的**：缺少**全局禁止列表**——某些 Skill（如 `delete_account`）应该在任何 Agent 类型中都禁用，不应依赖每个 `SubAgentConfig` 各自配置。建议在 `PolicyEngine` 中增加 `globalDenySkills: string[]`。

---

## 13. 提示词工程

**CC**：system prompt 是 Anthropic 多年迭代的产物，对 tool use 行为约束极其精准。

**Intera**：prompt 分散在多个文件中（[`apps/chat/lib/agent/prompt-resolver.ts`](apps/chat/lib/agent/prompt-resolver.ts) 的模板解析 + [`apps/chat/lib/agent/case-agent-loop.ts`](apps/chat/lib/agent/case-agent-loop.ts) 的 stage prompt + [`apps/chat/lib/agent/conversation-loop.ts`](apps/chat/lib/agent/conversation-loop.ts) 的 core prompt），缺少统一 prompt 组装管线。

---

## 优先级建议

| 优先级 | 改进项 | 涉及文件 | 收益 | 复杂度 |
|--------|--------|---------|------|--------|
| P0 | 统一 Agent Loop（SubAgent 复用 AgentLoop 的压缩/恢复/策略） | `loop.ts`, `sub-agent.ts` | SubAgent 立即获得全部护栏 | 高 |
| P0 | SendMessage 实时通信（SubAgent 间低延迟协作） | `orchestrator.ts`, `memory.ts` | 替代 Dashboard 轮询 | 中 |
| P1 | SystemSkill vs BusinessSkill 架构分离 | `skills.ts`, `packages/shared/types/index.ts` | Console 可安全配置，Core 不可破坏 | 中 |
| P1 | `createSkillDefinition()` 工厂 + 统一过滤管线 | `skills.ts`, `streaming-tool-executor.ts` | 消除分散的 filterTools 逻辑 | 中 |
| P1 | Fork 式 cache 共享 | `orchestrator.ts`, `sub-agent.ts` | N 个并行 SubAgent 成本降 60-80% | 中 |
| P1 | 自动错误恢复（model fallback / token 升档 / 413 兜底） | `loop.ts` | Agent 不因临时故障中断 | 中 |
| P2 | Query Chain Tracking 执行层透传 | `trace.ts`, `loop.ts`, `sub-agent.ts` | 全链路可观测（类型已就绪） | 低 |
| P2 | Skills 条件激活（意图/关键词触发）+ prompt 预算 | `skills.ts`, `config-cache.ts` | Skills 增长时 prompt 不膨胀 | 中 |
| P2 | 全局禁止列表 `globalDenySkills` | `policy.ts` | SubAgent 安全隔离 | 低 |
| P2 | 上下文压缩补齐 context collapse + reactive compact | `compact.ts`, `loop.ts` | 更长对话，更好记忆 | 高 |
| P3 | MCP 协议支持，第三方工具动态接入 | 新增 `apps/chat/lib/agent/mcp/` | 外部 CRM/工单系统集成 | 低 |
| P3 | Handoff Classification（SubAgent 结果安全审计） | `policy.ts`, `orchestrator.ts` | 安全审计 | 低 |

---

# Intera 改造方案：从 CC 精华到 SaaS 产品

> **终极目标**：在 CC 源码精华之上，构建 AI 客服场景的 SaaS 系统。
> - **Console**（`apps/console/`）是核心——产品交付人员可视化配置 Agent 行为
> - **Chat**（`apps/chat/`）是终端窗口——精美交互由集成方自行适配，不与 SaaS 核心能力耦合
> - **LiveChat Widget**（`apps/chat/app/livechat-widget/`）是另一种集成形态——同一套 Intera 配置，不同的 UI/UX

---

## 核心设计原则：能力在 Intera，体验在集成层

```
同一个 Intera 配置（Console 数据库中的 Skills + Policies + Agent Config）
     ├─ Chat App 集成       → 表单提交 + 过渡动画 + 富文本卡片（Chat 自己实现）
     ├─ Live Chat Widget     → 嵌入式气泡 + 快捷回复 + 满意度评分（Widget 自己实现）
     └─ API / Webhook        → 纯 JSON 交互（无 UI）
```

**Intera 核心只做一件事**：定义 Skill 的**能力契约**（name + inputSchema + uiHints）。集成方读取契约，自己决定如何渲染。同一套 Skills 配置，换一个集成方式，UI/UX 完全不同，但核心能力完全一致。

这意味着 [`packages/shared/types/index.ts`](packages/shared/types/index.ts) 中的 `SkillDefinition` 需要扩展一层——**UI 渲染提示**。

---

## Hardcoded vs Console 可配置：一刀切的分界线

### 硬编码（Intera Core，不开放配置）

这些是 Agent 引擎本身。改动需要发版，Console 只能**观测**不能**修改**：

| 模块 | Intera 文件 | 理由 |
|------|------------|------|
| **统一 Agent Loop** | [`apps/chat/lib/agent/loop.ts`](apps/chat/lib/agent/loop.ts) | 压缩、恢复、tool 执行是引擎核心 |
| **Skill 注册管线** | [`apps/chat/lib/agent/skills.ts`](apps/chat/lib/agent/skills.ts) | `SkillRouter.create()` → `getTools()` 的流程是安全边界 |
| **SystemSkill 实现** | [`apps/chat/lib/agent/skills.ts`](apps/chat/lib/agent/skills.ts) 的 `BUILT_IN_SKILLS` | `create_case`、`finalize_case` 等核心流程是代码 |
| **StreamingToolExecutor** | [`apps/chat/lib/agent/streaming-tool-executor.ts`](apps/chat/lib/agent/streaming-tool-executor.ts) | 并发调度、Zod 校验、mock/http 执行分流 |
| **PolicyEngine 执行** | [`apps/chat/lib/agent/policy.ts`](apps/chat/lib/agent/policy.ts) | deny/require/hook 规则的匹配和执行逻辑 |
| **SubAgent 隔离** | [`apps/chat/lib/agent/sub-agent.ts`](apps/chat/lib/agent/sub-agent.ts) + [`apps/chat/lib/agent/orchestrator.ts`](apps/chat/lib/agent/orchestrator.ts) | fork 子代理的模型/预算/工具过滤 |
| **上下文压缩** | [`apps/chat/lib/agent/compact.ts`](apps/chat/lib/agent/compact.ts) + [`apps/chat/lib/agent/microCompact.ts`](apps/chat/lib/agent/microCompact.ts) | 压缩策略是引擎性能的根本 |
| **CaseMemory** | [`apps/chat/lib/agent/memory.ts`](apps/chat/lib/agent/memory.ts) | 四层记忆结构（facts/skills/events/summary） |
| **TraceWriter** | [`apps/chat/lib/agent/trace.ts`](apps/chat/lib/agent/trace.ts) | 全链路追踪是基础设施 |

### Console 可视化配置

这些是交付人员通过 [`apps/console/app/admin/`](apps/console/app/admin/) 页面操作的，改动即时生效：

| 配置项 | Console 页面 | 存储 | Intera 对应模块 |
|--------|-------------|------|----------------|
| **BusinessSkill 定义** | `apps/console/app/admin/skills/` | Prisma `skill` 表 | `SkillRouter.create()` 加载 |
| **Agent 配置** | `apps/console/app/admin/agent/` | Prisma `agent_config` 表 | `AgentConfigData` 类型（[`packages/shared/types/index.ts:255-292`](packages/shared/types/index.ts#L255-L292)） |
| **Policy 规则** | `apps/console/app/admin/policies/` | Prisma `policy` 表 | `PolicyEngine.create()` 加载 |
| **Case Type 定义** | `apps/console/app/admin/case-types/` | Prisma `case_type` 表 | `StageExecutor` 的阶段配置 |
| **Stage 配置** | `apps/console/app/admin/agent/` 的 flow editor | Prisma `stage_config` | `StageConfig` 类型（[`packages/shared/types/index.ts:429-443`](packages/shared/types/index.ts#L429-L443)） |
| **Knowledge 源** | `apps/console/app/admin/knowledge/` | Prisma | `kb_hybrid_retrieve` Skill |
| **Routing 规则** | `apps/console/app/admin/routing/` | Prisma | `case-agent-loop.ts` 的 case type 检测 |
| **集成绑定** | `apps/console/app/admin/integrations/` | Prisma | Chat / LiveChat / API 通道的 Skill 暴露列表 |

---

## Skill 契约扩展：让集成层知道"怎么渲染"

当前 [`packages/shared/types/index.ts:81-101`](packages/shared/types/index.ts#L81-L101) 的 `SkillDefinition`：

```typescript
// 当前 Intera
interface SkillDefinition {
  name: string
  description: string
  inputSchema: Tool['input_schema']  // → 给 LLM 的参数约束
  mode: 'mock' | 'http'
  endpoint?: string
  httpMethod?: string
  headers?: Record<string, string>
  timeoutMs?: number
  mockFixture?: unknown
  isConcurrencySafe: boolean
  enabled: boolean
  displayVerb?: { text: string; icon: SpinnerIcon }
  zodSchema?: ZodType
}
```

**建议扩展**——增加 `uiHints` 字段，声明式描述集成方应如何渲染此 Skill：

```typescript
// 扩展后的 SkillDefinition
interface SkillDefinition {
  // ... 现有字段保持不变 ...

  // 新增：给集成方的渲染提示（不是 UI 代码，是声明式描述）
  uiHints?: {
    // 此 Skill 被调用时，集成方应展示什么形态
    renderAs: 'form' | 'confirm' | 'picker' | 'inline' | 'card' | 'none'
    // 如果 renderAs === 'form'，每个 inputSchema 字段对应的 widget
    fields?: Record<string, {
      widget: 'text' | 'textarea' | 'select' | 'datepicker' | 'file' | 'tel' | 'email'
      label: string              // i18n key
      placeholder?: string
      options?: { label: string; value: string }[]  // select widget
      required?: boolean
      validation?: {             // 客户端校验，减少无效 LLM 调用
        minLength?: number
        maxLength?: number
        pattern?: string
      }
    }>
    confirmText?: string         // 确认对话框文案
    progress?: 'spinner' | 'steps' | 'typing' | 'none'
    resultRenderAs?: 'text' | 'card' | 'table' | 'link' | 'custom'
  }
}
```

**关键**：`uiHints` 不是 UI 代码。Chat App 读 `uiHints.renderAs === 'form'` 用自己的组件库渲染；LiveChat Widget 读同一个 hint 用自己的设计系统渲染。互不依赖。

**SystemSkill 的 uiHints 硬编码在 `BUILT_IN_SKILLS` 中**，**BusinessSkill 的 uiHints 在 Console "Skill Builder" 中配置**。

---

## 各 CC 闪光点在 Intera 中的落地方式

### 1. 统一 Agent Loop → 合并 `AgentLoop` + `SubAgent`

**CC 精华**：主 Agent 和 Sub-Agent 跑同一套 `query()` async generator。

**Intera 落地**：

当前 [`apps/chat/lib/agent/sub-agent.ts`](apps/chat/lib/agent/sub-agent.ts) 的 `SubAgent.investigateStreaming()` 自建了一个简化的 ReAct 循环（line 42-258），与 [`apps/chat/lib/agent/loop.ts`](apps/chat/lib/agent/loop.ts) 的 `AgentLoop.run()` 是两套代码。

**改造方向**：让 `SubAgent` 复用 `AgentLoop` 的核心循环逻辑。提取 `AgentLoop` 中的 ReAct 迭代、工具执行、错误恢复为 `runReActLoop()` 函数，`AgentLoop` 和 `SubAgent` 都调用它。差异仅在于：
- 提示词组装不同（`CaseAgentLoop` vs SubAgent 的 `taskTemplate`）
- 工具列表不同（全量 vs `config.skills[]` 白名单）
- 上下文压缩策略不同（完整四层 vs 精简版）

**Console 不可配置**。但 Run History 面板可观测每次 SubAgent 调用的 chain tracking。

---

### 2. SystemSkill vs BusinessSkill 架构分离

**CC 精华**：Tool（硬编码 `buildTool()`）和 Skill（用户可扩展 SKILL.md）是不同的概念，不同的注册和执行路径。

**Intera 落地**：

当前 [`apps/chat/lib/agent/skills.ts`](apps/chat/lib/agent/skills.ts) 中两者混在同一个 `Map<string, SkillDefinition>` 里。改造后：

```
SkillDefinition（基类型，packages/shared/types/index.ts）
├─ SystemSkill（apps/chat/lib/agent/skills.ts 的 BUILT_IN_SKILLS）
│   └─ mode: 'mock' | 'http'
│   └─ call() 或 executeHttp() 由 StreamingToolExecutor 执行
│   └─ Console "Tool Registry" 页面只读展示
│
└─ BusinessSkill（Prisma skill 表，Console "Skill Builder" 创建）
    └─ mode: 'http'（必须指向外部端点）
    └─ allowedSystemSkills: string[]（可调用哪些 SystemSkill）
    └─ uiHints 在 Console 中配置
```

**Console UI——Skill Builder**：

```
┌─ Skill Builder ─────────────────────────────────┐
│ Name: [handle_refund__________________]          │
│ Description: [处理退款请求，验证订单后发起退款___] │
│ Execution: (•) HTTP Endpoint                     │
│   URL: [https://api.crm.com/refund_____________] │
│                                                  │
│ Allowed System Skills:   Model:    Context:      │
│ [x] query_order_status   ( ) Opus  ( ) Inline   │
│ [x] get_account_status   (•) Sonnet(•) Fork     │
│ [x] send_notification    ( ) Haiku               │
│                                                  │
│ UI Hints:                                        │
│ Render As: [Form ▾]                              │
│ Fields:  orderId → text (required)               │
│          reason  → select [damaged, not_received] │
│ Progress: [Steps ▾]                              │
│ Result:   [Card ▾]                               │
│                                                  │
│ Trigger:                                         │
│ Keywords: [退款, 退货, 订单问题_________________] │
│ Intents:  [refund_request, order_complaint______] │
│                              [Test] [Save]       │
└──────────────────────────────────────────────────┘
```

---

### 3. `createSkillDefinition()` 工厂 + 统一过滤管线

**CC 精华**：`buildTool()` + `TOOL_DEFAULTS` 确保每个 Tool 有安全默认值。`getAllBaseTools()` → `getTools()` → `assembleToolPool()` 是唯一入口。

**Intera 落地**：

当前 `BUILT_IN_SKILLS` 是手写对象数组，每个 Skill 重复声明 `mode: 'mock'`、`isConcurrencySafe: false`、`enabled: true` 等。改造为工厂函数：

```typescript
// apps/chat/lib/agent/skills.ts

const SKILL_DEFAULTS = {
  mode: 'mock' as const,
  isConcurrencySafe: false,
  enabled: true,
  timeoutMs: 10000,
}

function createSystemSkill(def: Partial<SkillDefinition> & { name: string }): SkillDefinition {
  return { ...SKILL_DEFAULTS, ...def }
}

// 使用
const BUILT_IN_SKILLS: SkillDefinition[] = [
  createSystemSkill({
    name: 'query_order_status',
    description: '查询订单状态...',
    inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
    isConcurrencySafe: true,  // 只 override 需要改的
    mockFixture: { status: 'shipped' },
    uiHints: { renderAs: 'inline', resultRenderAs: 'card' },
  }),
  // ...
]
```

**统一过滤管线**——消除分散的 filterTools 逻辑：

```typescript
// apps/chat/lib/agent/skills.ts — SkillRouter 新增方法

getToolsForContext(ctx: ToolContext): Tool[] {
  return this.getAllDefinitions()
    .filter(s => s.enabled)                          // 第一层：启用检查
    .filter(s => !this.globalDenySet.has(s.name))    // 第二层：全局禁止列表
    .filter(s => ctx.allowedSkills?.includes(s.name) ?? true)  // 第三层：上下文白名单
    .filter(s => ctx.stageRequiredSkills?.includes(s.name) || !ctx.isStageMode || ...)  // 第四层：Stage
    .map(s => toAnthropicTool(s))
}
```

`StageExecutor.filterTools()`、`ConversationLoop.filterTools()`、`SubAgent.buildTools()` 都通过 `ToolContext` 参数驱动同一个 `getToolsForContext()`，不再各自实现过滤。

---

### 4. Skills 条件激活 + Prompt 预算

**CC 精华**：Skills 不是全量注入 prompt。条件性 Skills 按路径匹配激活，prompt 预算控制在上下文窗口的 1%。

**Intera 落地**：

Intera 的 Skills 存储在数据库，天然支持热更新。应在此基础上增加：

**条件激活**——`SkillDefinition` 增加触发条件字段：

```typescript
// packages/shared/types/index.ts — SkillDefinition 扩展
interface SkillDefinition {
  // ... 现有字段 ...
  triggerConditions?: {
    keywords?: string[]       // 用户消息包含这些关键词时激活
    intents?: string[]        // 意图分类匹配时激活
    caseTypes?: string[]      // 特定 case type 时激活
    stages?: string[]         // 特定 stage 时激活（已有 StageExecutor.filterTools）
  }
}
```

**Prompt 预算**——`SkillRouter.getTools()` 返回的工具描述总字符数设上限：

```typescript
// apps/chat/lib/agent/skills.ts
getTools(ctx: ToolContext): Tool[] {
  const allTools = this.getToolsForContext(ctx)
  const MAX_DESCRIPTION_CHARS = 4000  // 工具描述总预算
  // SystemSkill 始终完整描述，BusinessSkill 按使用频率截断
  return budgetDescriptions(allTools, MAX_DESCRIPTION_CHARS)
}
```

**热更新**——Console 修改 Skill 后，通过已有的 [`apps/chat/lib/agent/config-cache.ts`](apps/chat/lib/agent/config-cache.ts) 缓存失效机制 + WebSocket 通知 Chat runtime 重新加载 `SkillRouter`。

---

### 5. Sub-Agent 权限分级 → 全局禁止列表 + Stage 白名单

**CC 精华**：三级权限集（ALL_DISALLOWED / ASYNC_ALLOWED / COORDINATOR_ALLOWED）。

**Intera 落地**：

Intera 已有的分层比 CC 更丰富：

| Intera 已有 | 对应 CC 概念 | 位置 |
|------------|------------|------|
| `ConversationLoop.CORE_ALLOWED_TOOLS` | 类似 ASYNC_ALLOWED | [`apps/chat/lib/agent/conversation-loop.ts:28-33`](apps/chat/lib/agent/conversation-loop.ts#L28-L33) |
| `StageExecutor.filterTools()` 的 `availableSkills` / `requiredSkills` | CC 没有的阶段维度 | [`apps/chat/lib/agent/stage-executor.ts:170-216`](apps/chat/lib/agent/stage-executor.ts#L170-L216) |
| `SubAgentConfig.skills[]` | 单个 SubAgent 白名单 | [`packages/shared/types/index.ts:475-483`](packages/shared/types/index.ts#L475-L483) |

**需补齐**：全局禁止列表。在 `PolicyEngine` 中增加：

```typescript
// apps/chat/lib/agent/policy.ts
class PolicyEngine {
  private globalDenySkills: Set<string>  // 从 Prisma policy 表加载

  isSkillAllowed(skillName: string): boolean {
    if (this.globalDenySkills.has(skillName)) return false  // 全局禁止优先
    // ... 后续 stage/context 白名单检查
  }
}
```

Console 的 "Policy Management" 页面（`apps/console/app/admin/policies/`）增加 "Global Deny List" 配置区域。

---

### 6. Fork + Cache 共享 → 自动优化，Console 不可见

**CC 精华**：Fork 子代理继承父 Agent 的 prompt 前缀，Anthropic API 按前缀匹配 cache。

**Intera 落地**：当 `BusinessSkill` 在 Console 中配置为 `context: 'fork'` 时，[`apps/chat/lib/agent/orchestrator.ts`](apps/chat/lib/agent/orchestrator.ts) 的 `dispatch()` 创建 SubAgent。Cache 共享策略是 runtime 实现细节——确保 fork 子代理复用父 Agent 的 system prompt 前缀。

Console 的 "Cost Analysis" 面板展示 cache 命中率，让交付人员看到效果。不需要配置。

---

### 7. Query Chain Tracking → TraceWriter 透传

**CC 精华**：`chainId` + `depth` 贯穿整个 Agent 调用树。

**Intera 落地**：[`packages/shared/types/index.ts:587-608`](packages/shared/types/index.ts#L587-L608) 的 `AgentContext` 已经定义了 `chainId` + `depth` 字段。**类型已就绪**。

需补齐的是执行层透传：

1. [`apps/chat/lib/agent/loop.ts`](apps/chat/lib/agent/loop.ts) 的 `AgentLoop.run()` 创建顶层 `chainId`
2. [`apps/chat/lib/agent/orchestrator.ts`](apps/chat/lib/agent/orchestrator.ts) 的 `dispatch()` 创建 SubAgent 时传递 `chainId` + `depth + 1`
3. [`apps/chat/lib/agent/trace.ts`](apps/chat/lib/agent/trace.ts) 的 `TraceWriter` 在所有 Agent（主/子）的工具调用中记录 `chainId` + `depth`

Console 的 Run History 面板用树形图展示：

```
Run #a1b2c3 (2026-05-26 14:32)
├─ AgentLoop (depth=0)
│   ├─ tool: query_order_status [200ms, 400 tokens]
│   └─ SubAgent: order-investigator (depth=1, fork)
│       ├─ tool: get_transaction_history [150ms, 300 tokens]
│       └─ tool: get_account_status [100ms, 200 tokens]
```

---

### 8. 自动错误恢复 → Console 告警配置

**CC 精华**：model fallback / max_output_tokens 升档 / 413 prompt-too-long 三层层恢复。

**Intera 落地**：CC 的三层恢复硬编码在 `AgentLoop` 中。Console 不配置**如何恢复**，但配置**何时告警**。

在 [`apps/console/app/ops/`](apps/console/app/ops/) 增加 "Alert Rules" 配置：
- model fallback 次数 > N → 告警
- 413 错误频率 > M → 告警
- SubAgent 超时次数 > K → 告警

---

## 集成层的职责边界

### Intera 提供（运行时 API）

```
GET /api/intera/config?integration=chat
→ {
    skills: SkillDefinition[],   // 包含 uiHints
    policies: PolicyRule[],      // 客户端可用的校验规则
  }

SSE /api/cases/:id/message
→ event: tool_use        { toolName, input }
→ event: tool_executing   { toolName, progress }
→ event: skill_result     { toolName, output, latencyMs }
```

### 集成方负责

- 读取 `SkillDefinition.uiHints`，用**自己的组件库**渲染 Tool 调用
- 根据 `renderAs` 选择展示策略（表单 / 确认框 / 内联文本 / 卡片）
- 动画、过渡、错误提示等纯 UI 逻辑
- 用户输入校验（基于 `uiHints.fields[].validation` 规则）
- 提交 tool_result 回 Intera

### 集成方最小适配示例

```typescript
// apps/chat/app/chat/use-intera-chat.ts — Chat App 的 hook
const { skills } = useInteraConfig()

// 监听 SSE 事件流
for await (const event of interaStream) {
  if (event.type === 'tool_use') {
    const skill = skills.find(s => s.name === event.toolName)

    // 用 Chat App 自己的组件渲染
    if (skill?.uiHints?.renderAs === 'form') {
      return <ChatForm fields={skill.uiHints.fields} onSubmit={submitResult} />
    }
    if (skill?.uiHints?.renderAs === 'confirm') {
      return <ConfirmDialog text={skill.uiHints.confirmText} onConfirm={...} />
    }
  }
}
```

**关键**：Chat App 不需要知道 `handle_refund` 的业务逻辑。它只知道 "这是一个表单，有 orderId 和 reason 两个字段"。

---

## 改造 Roadmap

| 阶段 | 内容 | 涉及文件 | 产出 |
|------|------|---------|------|
| **Phase 0** | `AgentLoop` 核心循环提取为 `runReActLoop()`，`SubAgent` 复用 | `loop.ts`, `sub-agent.ts` | 所有 Agent 共享压缩/恢复/策略 |
| **Phase 1** | `createSystemSkill()` 工厂 + `SKILL_DEFAULTS` + 统一 `getToolsForContext()` | `skills.ts`, `streaming-tool-executor.ts`, `packages/shared/types/index.ts` | 消除分散的 filterTools，Skill 注册可测试 |
| **Phase 2** | `SkillDefinition` 增加 `uiHints` + `triggerConditions`，`SystemSkill` vs `BusinessSkill` 类型分离 | `packages/shared/types/index.ts`, `skills.ts` | 集成方可读取渲染提示 |
| **Phase 3** | Console：Skill Builder + globalDenySkills + uiHints 配置 | `apps/console/app/admin/skills/`, `apps/console/app/admin/policies/` | 交付人员可视化配置 |
| **Phase 4** | Fork SubAgent cache 共享 + `PolicyEngine.globalDenySkills` | `orchestrator.ts`, `sub-agent.ts`, `policy.ts` | 并行 SubAgent 低成本安全执行 |
| **Phase 5** | `AgentContext.chainId/depth` 透传 + TraceWriter 全链路记录 | `trace.ts`, `loop.ts`, `orchestrator.ts` | Run History 树形图（类型已就绪） |
| **Phase 6** | Skills 条件激活 + prompt 预算 + 热更新（Console WebSocket push） | `skills.ts`, `config-cache.ts` | Skills 增长时 prompt 不膨胀，配置即时生效 |
| **Phase 7** | MCP 协议支持，第三方工具动态接入 | 新增 `apps/chat/lib/agent/mcp/` | 外部 CRM/工单系统集成 |
