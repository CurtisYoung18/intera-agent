# Intera Console 重设计 — 综合方案

> 合并自：`console-information-architecture.md`（高层 IA）+ `console-ux-critique.md`（具体问题）。
> 单文档供开发人员通读 + 实现。
>
> 总诊断：当前 Console **按字段堆**而不是**按抽象组织**，导致同一概念多处出现且行为不一致。
> 重设计目标：把 8 个核心抽象想清楚 + 画清 3 条边界 + 让每个抽象有自己的"真理之源"页面。

---

## 0. TL;DR — 4-5 周完成的工作概览

### 0.1 现状一句话

7 个 UX 问题，6 个是同一根因——"抽象层 / 渠道层 / 配置层" 三条边界没分清。

### 0.2 优先级总表（按"对演示直接价值"排）

| # | 项 | 工作量 | 是否阻塞演示 | 详见 |
|---|---|---|---|---|
| 1 | 修 system skills 显示 `mock` mode 的 bug | 2h | 🔴 演示时被运营当场看到 | §4.5 |
| 2 | 删 Skills 页面的 sub-agent 卡片 section | 5min | 🟡 | §4.4 |
| 3 | Skills 页加 "Model preview"（LLM 视角） | 1h | 🟢 推荐 | §4.4 |
| 4 | 修 sub-agents 页面跳转混乱（隐藏或独立编辑） | 30min | 🔴 当前体验断裂 | §4.4 |
| 5 | 删 `/admin/routing`（如确认无人用） | 5min | 🟡 | §6 |
| 6 | HumanOps 按渠道重塑 + 卫星卡片变 summary | 1 周 | 🔴 LiveChat 演示核心 | §4.1 |
| 7 | LiveChat Integrations 加 iframe + rich-message preview | 1.5 周 | 🔴 演示核心卖点 | §4.2 |
| 8 | Guardrails 4 要素卡片 + 命中统计 + sentence builder | 1 周 | 🟡 客户问 policy 怎么用时讲不清 | §4.3 |
| 9 | HTTP skills outputSchema 填充 + "Test endpoint" 自动 infer | 1.5 天 | 🟡 阻塞 LiveChat renderHints 配置 | §4.4 |
| 10 | 卫星图改成 read-only 导航 chip（不再 drawer 内编辑） | 1 天 | 🟢 IA 强制对齐 | §3.7 |
| 11 | Skills 页改名为 Capabilities + 加 Sub-agents tab | 2 天 | 🟢 IA 对齐 | §3.6 |
| 12 | Integrations 改名为 Channels + 4-tab 详情页 | 2 周 | 🟢 IA 对齐（吸收 6/7） | §3.4 |
| 13 | Policies 改名为 Guardrails（§4.3 重塑的副产品） | 含在 8 内 | 🟢 IA 对齐 | §4.3 |
| 14 | Export / Import 配置 JSON | 1 天 | 🟢 v2 | §7.4 |
| 15 | 配置版本 + 回滚 | 2 天 | 🟢 v2 | §7.1 |
| 16 | Onboarding checklist | 1 天 | 🟢 v2 | §7.3 |
| 17 | Skills → Tools 完整重命名（含代码） | 跟 S4 完整版 | 🟢 v2 | §4.4 |

**演示前 Day 1 必做（4 小时）**：#1 + #2 + #3 + #4 + #5。这 5 个加起来不到半天，但能消灭大部分"演示时翻车"的可能。

**演示前 1-2 周必做**：#6 + #7 + #8 + #9。

**演示后再做**：#10–#17。

---

## 1. 先把 Intera 的核心抽象想清楚

读完代码，Intera 有且只有 **8 个一级抽象**：

```
                        ┌─── CUSTOMER (deployment unit)
                        │      ↓
                        │   "一个 Intera 实例服务一个客户"
                        │
       ┌────────────────┼────────────────────────────┐
       │                │                            │
   ENTRY POINT      AGENT BRAIN                  BUSINESS MODEL
   ┌─────────┐      ┌──────────────┐            ┌──────────────────┐
   │CHANNEL  │      │ AGENT        │            │  CASE TYPE       │
   │(web/LC) │ ──→  │ (prompt+model│  ──reads→  │ (stages, facts)  │
   │         │      │ +memory)     │            │                  │
   └─────────┘      └──────┬───────┘            └────────┬─────────┘
                           │                             │
                           │ uses                        │ defines
                           ↓                             ↓
                    ┌──────────────┐            ┌──────────────────┐
                    │  CAPABILITY  │            │  SUB-AGENT       │
                    │ (skill/tool) │  ──may──→  │ (specialist with │
                    │              │   spawn    │  own brain+cap)  │
                    └──────┬───────┘            └────────┬─────────┘
                           │                             │
                           │ constrained by              │ constrained by
                           ↓                             ↓
                    ┌──────────────────────────────────────┐
                    │  GUARDRAIL                           │
                    │ (preTool / postTool / preFinalize)   │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │  KNOWLEDGE                           │
                    │ (RAG sources, indexed for retrieval) │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │  HUMAN OPS                           │
                    │ (escalation strategy, per channel)   │
                    └──────────────────────────────────────┘
```

**关系链**（因果）：
- Channel **触发** Agent
- Agent **依据** Case Type 工作
- Agent **使用** Capabilities & Sub-agents
- Agent **受限于** Guardrails
- Agent **查询** Knowledge
- Agent **失败时** 走 Human Ops（按当前 Channel 的策略）

**Customer 是自身**，通常不在 UI 显示（除非多租户管理）。Human Ops 是"渠道行为"，不是独立抽象——见下文。

---

## 2. 三条正交边界

**这是当前 Console 最大的混乱来源**。所有配置必须只属一条边界，不允许双归属。

### 2.1 抽象层 vs 渠道层（最重要）

| 抽象层 | 渠道层 |
|---|---|
| 跟"用户从哪进来"无关的 Agent 内核行为 | 每个集成自身的接入 + 呈现 + 升级策略 |
| Agent profile（prompt / model / memory） | Channel credentials & connection |
| Capabilities（skills / sub-agents） | Per-channel render hints |
| Guardrails | Per-channel human escalation behavior |
| Case types | Per-channel routing rules |
| Knowledge | |

**判定规则**：一个字段如果"在 Web Chat 和 LiveChat 应该不同"，它就属于渠道层；如果"在两个渠道应该一样"，它就属于抽象层。**不允许一个字段两边都改**。

**典型错位**：`consultationPrompt` 当前在 `agent config` 里 = 错。它只在 chat-app 的 LLM 咨询场景被读（[loop.ts](apps/chat/lib/agent/loop.ts)），LiveChat 走 `transfer_chat`（[channels/livechat/renderer.ts:113](apps/chat/channels/livechat/renderer.ts:113)）。它**应该属于 `Channel(web-chat).humanOps.consultationPrompt`**。

### 2.2 配置层 vs 运营层

| 配置层（Admin） | 运营层（Ops） |
|---|---|
| 定义 agent 怎么工作 | 观察 agent 怎么工作 |
| 改完后下次新 case 生效 | 实时 / 历史的 case、trace、dashboard、human task |

**规则**：Ops 页面不要嵌入配置入口（"在 trace 里点 skill 名跳到 Skills 配置页"这种**跳转**可以，但 Ops 页面本身不应有可编辑的配置字段）。

### 2.3 真理之源 vs 镜像 / 仪表盘

| 真理之源 | 镜像 |
|---|---|
| 每个抽象在一个页面被编辑 | 其它页面只读地显示该抽象的摘要 + 跳转链接 |

**规则示例**：
- Sub-agent 定义：CC 模式 → `/admin/capabilities` 的 Sub-agents tab；Stage 模式 → Case Type detail 的 stage 嵌套
- Guardrail：`/admin/guardrails`
- Human Ops 策略：嵌在每个 Channel 详情里
- 当前显示 sub-agent / guardrail 状态的 satellite cards 都是 read-only summary

**当前违反**：很多页面"想编辑这个又编辑那个"。例如 `agent-config` drawer 里的 HumanOps 编辑 vs `/admin/human-ops` 子页 = 两边都能改。

---

## 3. 新 IA（信息架构）

### 3.1 新侧边栏：10 项（4 Ops + 6 Configure）

```
Ops
├ Chats              当前对话 + 实时 trace（已有，扩展 trace 视图属 S6）
├ Human Tasks        人工工单队列（已有）
├ Dashboards         引擎健康 + 数据 dashboard（S6 未做）
└ Guide              操作手册（已有）

Configure
├ Agent              ⭐ brain only：prompt + model + memory + generation
├ Capabilities       Skills tab + Sub-agents tab（合并）
├ Guardrails         🔄 按业务语义重塑（4 要素卡片 + sentence builder）
├ Case Types         案例定义、stages、stage-mode sub-agents nested
├ Channels           🔄 重命名 Integrations，详情页含 human ops + render hints
└ Knowledge          知识源管理（已有）
```

### 3.2 当前 → 新 对照表

| 当前 | 改造 | 理由 |
|---|---|---|
| `/admin/agent`（6 satellites with drawer-edit） | **保留卫星图** 作为概览，但卡片改成 read-only nav chip（跳页，不展开 drawer） | 卫星图有视觉价值；但当成全局编辑入口让其它子页变成镜像就错位了 |
| `/admin/skills` | → `/admin/capabilities`（Skills + Sub-agents tab） | Skills + Sub-agents 是同一类抽象（agent 能做什么） |
| `/admin/sub-agents` | **删除路由** | 合并到 Capabilities |
| `/admin/policies` | → `/admin/guardrails`（4 要素卡片化） | 业务术语，跟代码 `policyHooks` 字段名解耦 |
| `/admin/human-ops` | **删除独立路由**，内容拆到 Channels 详情 + Guardrails 升级触发 | "人工介入"不是独立抽象，是渠道行为 + 全局触发规则 |
| `/admin/routing` | **删除路由** | 当前内容是 "channel → case type" 路由 — 融入 Channels 详情页（每个渠道一个 routing tab） |
| `/admin/case-types` | 保留，但 stage detail 内嵌完整 sub-agent 编辑 | "配置就近"原则 |
| `/admin/knowledge` | 不动 | 已是合理抽象 |
| `/admin/integrations` | → `/admin/channels` 4-tab 详情页 | 名实相符：连接的是"渠道" |

净变化：**8 admin pages → 6**（删 3 + 改 3 + 不动 3）。

### 3.3 每个页面的"职责契约"

每个页面只编辑"它的真理"，其它信息都是镜像 + 链接。

| 页面 | 唯一职责（真理） | 镜像显示（只读 + 跳转） |
|---|---|---|
| **Agent** | systemPrompt、model、temperature、thinkingBudget、maxIterations、maxOutputTokens、memoryStrategy、fallbackModel | 卫星卡片显示 capability count / guardrail count / case-type count / channel status |
| **Capabilities** | skill enable + business skill CRUD + sub-agent registry CRUD（cc 模式时） | 引用了多少 guardrail / 哪些 case type 在用 |
| **Guardrails** | policyHooks JSON 真理之源 + 自然语言描述 | 命中统计（聚合 trace）+ 跳转到对应 skill |
| **Case Types** | type、displayName、stages、stageConfigs、subAgents（stage 模式）、requiredFacts、escalateOn、resolutionTemplate | 跳转到引用的 skill / guardrail |
| **Channels** | channel credentials、enabled、routing rules、render hints overrides、per-channel human ops 策略 | 健康度（实时）+ 最近 24h 消息数 |
| **Knowledge** | KnowledgeSource CRUD、GPTBots API key、嵌入配置 | 哪些 skill 在用 |
| **Chats** (ops) | — | 实时 trace、案例状态 |
| **Human Tasks** (ops) | task 状态、operator 处理 | — |
| **Dashboards** (ops) | — | trace 聚合 |
| **Guide** (ops) | 操作手册 | — |

### 3.4 Channel 详情页结构（解决最大错位）

**每个 channel 详情页 4 个 tab**：

```
Channel: LiveChat
├ Connection     credentials (botToken, licenseId, webhookSecret) + health status
├ Routing        哪些 chat 走 Intera vs 直接转人工 + 哪些 case type 在此渠道启用
├ Rendering      🆕 per-channel UI 偏好
│                  • Channel defaults（card / quick_reply / plain 默认样式）
│                  • Per-skill overrides（覆盖 Skill 自带的 renderHints）
│                  • Iframe preview + 模拟对话窗口（左半屏配置、右半屏 mock chat）
└ Human Ops      🆕 当此渠道下发生升级时怎么处理
                  • 策略：transfer_chat / consult LLM / silent task
                  • 目标 group / queue（如果 transfer）
                  • 用户可见提示文案
                  • consultationPrompt + allowedHumanSkills（如果 consult）
                  • 触发条件覆盖（全局 + 本渠道）
```

LiveChat 演示时运营在**一个页面内**能调完所有相关字段。Web Chat 同理。

### 3.5 Guardrails 页面结构

业务化呈现，不再是引擎术语三栏：

```
Guardrails
├ Active Rules（卡片列表）
│   每条卡片显示四要素：
│   ┌─ 自然语言描述 ──────────────────────────────┐
│   │ 在升级到人工之前，必须先调用至少一个调查工具      │
│   ├─ 触发时机 ─────────────────────────────────┤
│   │ 每次 LLM 调用 create_human_task 之前           │
│   ├─ 检查失败时 ───────────────────────────────┤
│   │ 拒绝调用并提示 LLM 收集证据                    │
│   ├─ 命中统计（最近 7 天）────────────────────┤
│   │ 23 次（21 重定向，2 升级）  [详情] [编辑] [禁用] │
│   └──────────────────────────────────────────────┘
├ Builder（新建）
│   三个模板入口：
│   • "必须先做 A 再做 B"
│   • "禁止做 X"
│   • "AI 评估某个条件"
└ Advanced JSON 折叠区（高级用户，与 Builder 双向同步）

旁置 tab：Sub-agent overrides（看每个 sub-agent 的 inherit + disabled + added）
```

**四要素来源**：
1. **自然语言描述** — 由 LLM 一次性翻译 policy JSON 生成（保存时调用，存一份在 DB）
2. **触发时机** — 把 `preTool` / `postTool` / `preFinalize` 翻译成业务时序
3. **检查失败时** — 显示 `feedbackMessage` + 结果（拒绝/提示/升级）
4. **命中频率** — 从 trace 表聚合 `policy_hit` 事件

### 3.6 Capabilities 页面结构

```
Capabilities
├ Tab: Skills (Tools)
│   ├ Section: System (engine-managed)    🔒 read-only，显示 mode='engine_managed'
│   │   create_case, finalize_case, todo_*, read_case_history, ...
│   ├ Section: Special (separately configured)   kb_hybrid_retrieve → Knowledge page
│   ├ Section: Business (HTTP / mock)     可编辑
│   │   query_order_status, get_account_status, ...
│   │   每卡片显示：mode badge / channel render hints summary / 7d 调用次数
│   └ [+ New business skill]
└ Tab: Sub-agents（条件显示——customer 用 cc 模式时）
    ├ Registry list
    └ [+ New sub-agent]
```

**重要**：**删掉**当前 Skills 页面下的 "sub-agent 卡片 section"（混淆 — sub-agent 不是 skill）。Sub-agents 走 tab 切换。

### 3.7 Agent Profile 页面（"Brain"）

收敛为 4 个 section（不再 6 satellites）：

```
Agent (Brain)
├ Identity
│   systemPrompt（含 placeholder chip）+ Reset to default
├ Reasoning
│   model + fallbackModel + evaluationModel + temperature
│   + thinkingBudget + showThinking + maxIterations + maxOutputTokens
├ Memory
│   Tier slider (Short / Balanced / Long / Custom) + Advanced
└ Overview Map（卫星图保留，作为 read-only 全景）
    指向：Capabilities · Guardrails · Case Types · Channels · Knowledge
```

把"Sub-agents / Knowledge / HumanOps / Guardrails" 4 个卫星卡变成 read-only 的"指向其它页"导航 chip。点击不开 drawer，直接 navigate。**卫星图变成 dashboard 而不是编辑面板**。

---

## 4. 逐项问题诊断（你提的 7 个问题映射到新 IA）

### 4.1 HumanOps 配置错位

**症状**：agent-config 卫星图的 HumanOps 卡片，编辑的是 `consultationPrompt` + `humanSkills`，但 LiveChat 根本不读这些字段。

**证据**：
- [apps/console/app/admin/human-ops/page.tsx](apps/console/app/admin/human-ops/page.tsx) 整页就这两个字段
- [loop.ts](apps/chat/lib/agent/loop.ts) `consultationPrompt` 只在 ConversationLoop 走 chat-app 路径时被读
- [channels/livechat/renderer.ts:113](apps/chat/channels/livechat/renderer.ts:113) LiveChat 直接 `transfer_chat`，不读 consultationPrompt

**根因**：违反 §2.1 抽象层 vs 渠道层边界。"人工介入" 被当成全局 agent 行为去配置，实际上是**每个渠道独立的策略**。

**修复**（详见 §3.4 Channel 详情页 Human Ops tab）：
- 删除独立 `/admin/human-ops` 路由
- 把内容拆进每个 Channel 详情页的 Human Ops tab
- agent-config 卫星图的 HumanOps 卡片改为 read-only summary："3 channels configured · default: transfer"，点击跳 `/admin/channels`

**工作量**：1 周（含 schema 变更 + 多 channel 适配 + UI）

---

### 4.2 Integrations 页面没 iframe / preview

**症状**：[apps/console/app/admin/integrations/page.tsx](apps/console/app/admin/integrations/page.tsx) 287 行，`grep "iframe|preview|renderHints"` 零结果。第 256-259 行还有 placeholder：
```tsx
<div className="...italic">
  Channel-to-skill binding — available in a future release
</div>
```

**根因**：S5 spec 砍后版本明确说 "per-channel render override 推迟"，做的人没违反 spec。但你的预期是"看到 LiveChat 配置时能 preview"。

**修复**（详见 §3.4 Channel 详情页 Rendering tab）：
- 重塑成 4-tab 详情页
- Rendering tab 必须有：channel defaults + per-skill renderHints overrides + **iframe preview** + **rich-message preview**
- 没有 preview 的 Integrations 页面 = 运营"盲配"，改字段都不知道效果

**工作量**：1.5 周（含 mock LiveChat 渲染组件、preview 组件）

---

### 4.3 Guardrails 展示太抽象

**症状**：当前 `/admin/policies` 是 `AgentPolicyHooksPicker` 三栏（preTool / postTool / preFinalize）+ 一堆 skill 名。运营看完后不知道：
- 某条 policy **何时触发**
- 触发了之后**做了什么**
- 真实情况下**命中过几次**

**根因**：违反 §2 中 "业务语义优先于引擎术语" 原则。把 `preTool/postTool/preFinalize` 这些引擎概念直接暴露给运营。

**修复**（详见 §3.5）：4 要素卡片 + sentence builder + 命中统计。Advanced JSON 折叠区给真懂的人。

**工作量**：1 周（自然语言生成 1 天 + sentence builder 2 天 + 命中统计 2 天）

---

### 4.4 Skills 五连问

#### 4.4.1 System skills 显示 `mode: 'mock'` —— **真 bug，必须修**

**症状**：[apps/chat/lib/agent/skills.ts](apps/chat/lib/agent/skills.ts:34) 所有 BUILT_IN_SKILLS 都标 `mode: 'mock'` + `mockFixture`。但 `create_case` 真的写 DB，`finalize_case` 真的更新 Case status，`todo_write` 真的改 CaseMemory。

**根因**：S4 没真正落地（B2 推迟），这些 skill 没成为 Tool<I,O> 实例，仍是 SkillDefinition 数据行；为让 executor 跑得通，伪装成 mock。运营看到 "mock" 字样会以为是占位测试数据。

**修复**：加第三个 mode `'engine_managed'`：
```ts
mode: 'mock' | 'http' | 'engine_managed'
```
- BUILT_IN_SKILLS 改为 `engine_managed`
- Editor 隐藏 mockFixture 字段（运营改不了）
- Display 显示 "引擎接管 — 由 Intera 自身实现，不读 mockFixture"
- Read-only

**工作量**：2 小时（不依赖 S4 完整版）

#### 4.4.2 HTTP skills outputSchema 都是空

**症状**：jayabaji.* 那批 HTTP skill seed 时 `outputSchema: '{}'`。

**影响**：
- 运营不知道 skill 返回什么字段 → 配 LiveChat renderHints 时盲猜
- LLM 看不到 outputSchema（CC 不传给模型，但 description 通常列字段名）
- 调试时找不到 schema 契约

**修复**：
1. 填充 seed 的 outputSchema（jayabaji 所有 endpoint 的真实响应字段）
2. Skills 编辑页加 "Test endpoint" 按钮 → 调一次真 endpoint（固定 dummy input）→ 把响应填进 outputSchema（auto-inference）
3. outputSchema 在 LiveChat renderHints 编辑器里作为字段补全候选（"title field" 下拉选 outputSchema 字段）

**工作量**：1.5 天

#### 4.4.3 Skills 该不该叫 Tools？

**结论**：严格意义上是 LLM function calling tools。

**建议**：UI 上保留 "Skill"（客服域语义友好），代码统一 `Tool`。一个外向语义、一个内向语义。

**短期 v1**：不动。
**长期**：跟 S4 完整版一起做。

#### 4.4.4 Skills 页面有 sub-agent 卡片 —— **抽象违例**

**症状**：[apps/console/app/admin/skills/page.tsx:444](apps/console/app/admin/skills/page.tsx:444) 加了 sub-agents section。

**根因**：违反 §2.3 "每个抽象只有一个真理之源" + "One Source of Truth"。

**修复**：从 Skills 页面**删除** sub-agent 卡片 section。运营要看 sub-agent → 去 `/admin/capabilities` 的 Sub-agents tab（建议改名后）或 case-types detail（stage 模式）。

**工作量**：5 分钟

#### 4.4.5 应该显示 "input schema → prompt" 的呈现吗？

**强烈建议要**。运营经常困惑："我改了 description 后 LLM 实际看到什么？"

最少要有：
- "Model preview" 折叠区 — 显示 LLM 实际接收的 tool definition（`buildAnthropicTools()` 输出）
- 包括展开的 inputSchema、description、name

**工作量**：1 小时（把 buildAnthropicTools 移到 packages/shared，console 端调一次）

---

### 4.5 Sub-agent 编辑跳回 Case Types —— 抽象断了

**症状**：[apps/console/app/admin/sub-agents/page.tsx:62](apps/console/app/admin/sub-agents/page.tsx:62) `href="/admin/case-types"`。sub-agents 列表页只是把 case-types 里嵌套的 `stageConfigs.*.subAgents` 抽出来显示，点编辑跳回 case-types。

**根因**：违反 "Stage 模式 sub-agent 在 case-type 嵌套 / CC 模式 sub-agent 在独立注册表" 的设计。当前是"既在又不在"。

**还有更深一层 — policy hooks 没串联**：sub-agent 的 guardrail 应该 inherit from global + per-sub-agent override（按之前的 spec §2.4 设计），但代码里：
- sub-agent 编辑没 guardrail section
- 引擎只用全局 `policyHooks`，不读 sub-agent override

**修复**：

| 阶段 | 行动 | 工作量 |
|---|---|---|
| **短期（演示前）** | 隐藏 sub-agents 侧栏入口；统一回 case-types detail 嵌套编辑 | 30 分钟 |
| **中期（v2）** | Stage 模式：在 case-types detail 完整 sub-agent 编辑器；CC 模式：在 `/admin/capabilities` 的 Sub-agents tab 独立注册表 | 2 周 |
| **中期** | 两种模式都支持 guardrail inherit + override（引擎读 SubAgentGuardrailOverrides） | 含在上面 |

---

### 4.6 关于 "Bash + Skills MD" 能力的建议

**你问的**：是否让 Intera 具备 bash 读 skills md 的能力，类似 CC 的 `loadAgentsDir.ts`。

**结论：不要做**。

**理由**：

1. **Railway ephemeral filesystem** — 每次 deploy md 文件丢失。挂载 volume 或绑 Git → 引入两层基础设施复杂度
2. **多租户** — Intera 是 multi-customer。CC 是单用户 CLI。md 文件按目录组织在单用户场景天然 work；在 customer × stage × sub-agent 三维 namespace 下没合适目录结构
3. **已有更好的存储** — Prisma DB 已经是真理之源，Console UI 已经在做可视化编辑。md 是退步体验

**CC 用 md 是因为 IDE 单用户场景，开发者习惯文件 + git。Intera 用户是客服运营 + 交付工程师，Console 是他们的工作流**。

**替代方案 — Export/Import 配置 JSON**（详见 §7.4）：
- 导出 customer 完整配置成单个 JSON
- 客户可以提交 git
- 另一个 customer 可以导入
- Console 仍是单一真理之源

---

## 5. 6 条设计原则（PR review checklist）

每条都从已发现的混乱里提炼出来，可作为 PR review 时的规则：

1. **One Source of Truth** — 一个抽象有且仅有一个编辑页面。其它显示它都是 read-only + 跳转
2. **Orthogonal Axes** — 配置字段要么属于抽象层（跨渠道一致），要么属于渠道层（按渠道差异化）。不允许双归属
3. **Configure ≠ Operate** — Configure 子菜单改配置，Ops 子菜单看运行。Ops 页面不要嵌入配置入口（跳转可以）
4. **Business Language Wins** — "Guardrail" 而不是 "policyHook"；"何时触发" 而不是 "preTool/postTool"。引擎术语只在 Advanced JSON 区出现
5. **Who & When** — 每个页面都答得出"谁编辑 / 何时编辑"：
   - Agent：交付工程师，建立时配，低频
   - Capabilities (skills)：运营 + 交付，中频
   - Guardrails：合规 + 交付，低频
   - Case Types：业务专家，中频
   - Channels：IT 部门，低频
   - Knowledge：内容运营，高频
6. **Consistent Preview** — 涉及"改了配置 LLM 或用户会看到什么"的页面都要 inline preview：
   - Skill 编辑 → "Model preview"（LLM 看到的 tool definition）
   - Channel render hint 编辑 → "Channel preview"（用户看到的 UI）
   - Prompt 编辑 → "Resolved prompt"（占位符填充后）
   - Guardrail 编辑 → "Sample scenarios"（举 3 个真实 case trace 命中此 rule）

---

## 6. 完整迁移路径（4-5 周）

按"最大效益 / 最小风险"排序：

### 阶段 A — Day 1 Quick Wins（4 小时）

| 改造 | 工作量 | 风险 | 优先级 |
|---|---|---|---|
| 修 system skills `mode='engine_managed'`（4.4.1） | 2h | 低 | 🔴 P0 |
| 删 Skills 页 sub-agent section（4.4.4） | 5min | 极低 | 🔴 |
| 加 Skills "Model preview"（4.4.5） | 1h | 极低 | 🟡 |
| 隐藏 sub-agents 侧栏入口（4.5 短期） | 30min | 低 | 🔴 |
| 删 `/admin/routing` 路由（确认无人用后） | 5min | 极低 | 🟢 |

**Day 1 结束后**：演示翻车率 / 运营困惑度大幅下降。

### 阶段 B — Week 1 P0（含演示阻塞项）

| 改造 | 工作量 | 风险 |
|---|---|---|
| HumanOps 重塑（4.1）：删独立页 + 拆进 Channels Human Ops tab | 1 周 | 中（schema 变更） |
| HTTP skills outputSchema 填充 + Test endpoint（4.4.2） | 1.5 天 | 低 |

### 阶段 C — Week 2 P1（演示打磨）

| 改造 | 工作量 | 风险 |
|---|---|---|
| Channels 4-tab 详情页（§3.4）：Connection / Routing / Rendering / Human Ops | 1.5 周 | 高（重塑 ChannelBinding 数据 + LiveChat plan L2/L3 协同） |
| LiveChat Rendering tab 内 **iframe preview + rich-message preview** | 包含在上面 | 中 |

### 阶段 D — Week 3 P1（业务化）

| 改造 | 工作量 | 风险 |
|---|---|---|
| Policies → Guardrails 重塑（§3.5）：4 要素卡片 + sentence builder + 命中统计 | 1 周 | 中 |

### 阶段 E — Week 4 IA 对齐（演示后或同步）

| 改造 | 工作量 | 风险 |
|---|---|---|
| Skills → Capabilities 重命名 + 加 Sub-agents tab（§3.6） | 2 天 | 低 |
| 卫星图改 read-only nav chip（§3.7） | 1 天 | 中 |
| 删 `/admin/human-ops` 独立页（B 完成后） | 5 分钟 | 低 |
| Integrations → Channels 重命名（含在 C 内） | 包含 | — |

### 阶段 F — V2 / 演示后

| 改造 | 工作量 |
|---|---|
| `/ops/dashboards`（S6 dashboards 工作） | 1 周 |
| 配置版本 + 回滚（§7.1） | 2 天 |
| Draft / Publish 模式（§7.2） | 1 周 |
| Onboarding checklist（§7.3） | 1 天 |
| Export / Import JSON（§7.4） | 1 天 |
| Skills → Tools 完整重命名（含代码层） | 跟 S4 完整版一起 |

---

## 7. 非紧急但重要的设计建议（V2）

### 7.1 配置版本与回滚

每次保存任何配置都应该有版本号 + 操作日志。生产改坏了能一键回滚。当前没有这层。

**简化做法**：每个核心表加 `version: number @default(1)` + `revisionHistory: Json[]`，每次 update 时 push 旧值。Console 顶部加 "View history" 按钮。

**工作量**：2 天

### 7.2 Draft / Publish 模式

改生产配置之前能不能先在 staging 试？

- **轻量**：每个 customer 配 2 套：production + sandbox。Console 顶部切换。改 sandbox → 触发一次自动化测试场景 → ok 再"复制到 production"
- **重量**：所有配置加 `status: 'draft' | 'published'`。改 draft 不影响生产；点 "Publish" 原子切换

建议**先轻量**。**工作量 1 周**。

### 7.3 Onboarding Checklist

新交付工程师第一次开 Console 应该看到什么？建议在 dashboard 顶部展示 6 步：

```
□ 1. Configure Agent (prompt + model)
□ 2. Enable at least 1 business skill
□ 3. Define at least 1 case type
□ 4. Connect at least 1 channel
□ 5. Configure 1 guardrail (or accept defaults)
□ 6. Run test chat — see results in /ops/chats
```

完成度持久化到 customer 表（`onboardingProgress: Json`）。0/6 显示，6/6 自动隐藏。**演示客户的环境是预配置好的，自然不出现，不会显得不专业**。

**工作量**：1 天

### 7.4 Export / Import 配置 JSON（替代 md 文件方案）

- Export：从 Console 一键导出某 customer 的完整配置（agent + capabilities + guardrails + case-types + channels + knowledge）成一个 JSON 文件
- Import：另一个 customer 可以导入，自动重命名冲突字段
- 客户可以把这个 JSON 提交 git

这是对 §4.6 "不做 md" 的替代方案 — 满足客户的 IaC 需求但不引入 Railway filesystem 复杂度。

**工作量**：1 天

### 7.5 Configure 时的"影响范围"提示

改 systemPrompt 时，UI 应该警告"这会影响接下来 N 个进行中的 case + N 个新 case"。改 case type 的 escalation 规则时警告"已经在进行中的 N 个 case 不会受影响"。

避免误改。**工作量 3 天**。

---

## 8. 待你回答的产品决策

这些定了才能动手：

| # | 问题 | 我的建议默认值 | 影响 |
|---|---|---|---|
| 1 | 6 个 Configure 页面太多吗？要不要再合并（如把 Knowledge 合到 Capabilities）？ | **保留 6 个**。Knowledge 有独立 RAG 后端 + 内容运营 | §3 IA |
| 2 | "Human Ops 是渠道行为，不是独立抽象" 你认同吗？ | **认同**，按 §3.4 拆 | §4.1 全部 |
| 3 | `/admin/routing` 当前实际做什么？跟 case-types 的 trigger words 重叠吗？ | **删除路由**（先 grep 确认无引用） | 阶段 A |
| 4 | 卫星图保留作 Agent 概览还是改 dashboard 风格？ | **保留**但改 read-only nav chip（§3.7） | 阶段 E |
| 5 | Guardrails 自然语言描述：LLM 翻译还是运营手写？ | **LLM 翻译**（保存时调一次，需要 prompt 成本），运营可手动覆盖 | §4.3 |
| 6 | Skills UI 改名 Tools 还是保留？ | **保留 "Skill"**（客服域友好），代码统一 Tool | §4.4.3 |
| 7 | Export/Import 范围是单个 agent 全配置还是分部分？ | **全配置**单文件 | §7.4 |
| 8 | 配置版本回滚（§7.1）演示前要不要？ | **不要**，等出过一次事故再做 | 阶段 F |
| 9 | Onboarding checklist（§7.3）演示客户看不看？ | **0/6 显示，6/6 自动隐藏**，演示客户预配置好自然不出现 | 阶段 F |
| 10 | "演示前"窗口实际多少天？影响是否砍阶段 B / C | — | 排期 |

---

## 9. 给开发人员的开工说明

### 9.1 Day 1（4 小时，组建信心 + 消灭明显尴尬）

按这个顺序做，每完成一个 commit + 部署：

1. **修 system skills mock mode bug**
   - 改 [packages/shared/types/index.ts](packages/shared/types/index.ts) `SkillDefinition.mode`：加 `'engine_managed'`
   - 改 [apps/chat/lib/agent/skills.ts](apps/chat/lib/agent/skills.ts) 所有 BUILT_IN_SKILLS 的 `mode: 'mock'` → `mode: 'engine_managed'`
   - 删除这些 skill 的 mockFixture（保留 fallback 行为）
   - StreamingToolExecutor 加分支：`mode === 'engine_managed'` 时不走 executeMock，调用引擎本身的实现（具体内置 skill 已经在 loop / processTodoTools 等处理）
   - Skills 页 editor 当 `editing.mode === 'engine_managed'` 时隐藏 mockFixture 字段
   - 显示 badge "引擎接管" 替代 "MOCK"
   - 写测试

2. **删 Skills 页 sub-agent section** — [apps/console/app/admin/skills/page.tsx:444](apps/console/app/admin/skills/page.tsx:444) 整块删

3. **加 Skills "Model preview"**
   - `buildAnthropicTools` 从 [loop.ts](apps/chat/lib/agent/loop.ts) 抽到 packages/shared
   - Skills editor 加折叠区 "Model preview"，显示该 skill 的 Anthropic tool definition JSON

4. **隐藏 sub-agents 侧栏入口** — [apps/console/components/console-sidebar.tsx](apps/console/components/console-sidebar.tsx) 从 ADMIN_ITEMS 注释掉 subAgents 那行

5. **确认 `/admin/routing` 能删** — `grep -r "routing" apps/console/app apps/console/components` 确认只有侧栏 link 和 page 自身；如果有真实跳转引用，先保留

每个 commit 都该有：
- 改的简短说明
- "演示前 Day 1 必做"标记

### 9.2 Week 1（HumanOps 重塑 + outputSchema）

按 §4.1 + §4.4.2 详细列表实施。新增 schema migration（HumanOps 字段从 Agent 表搬到 ChannelBinding 表，注意 backfill）。

### 9.3 Week 2-3（Channels + Guardrails）

并行：
- 一个开发：Channels 4-tab 详情页 + iframe / rich-message preview
- 另一个开发：Guardrails 重塑

### 9.4 Week 4 / 演示后

IA 对齐 + V2 项目（§7）

### 9.5 PR review 必检清单

收到任何 Console PR，按 §5 6 条原则查：

- [ ] One Source of Truth：这个改动有没有让某字段在两个页面都能改？
- [ ] Orthogonal Axes：新字段在抽象层还是渠道层？归属清晰吗？
- [ ] Configure ≠ Operate：Ops 页有没有新加编辑入口？
- [ ] Business Language：用户可见文案有没有引擎术语（preTool / hook / etc）？
- [ ] Who & When：这个页面"谁来编辑 / 何时编辑" 的答案清晰吗？
- [ ] Preview：涉及"改了 LLM/用户看到什么"的有 preview 吗？

---

## 10. 总结

**真正要解决的问题**：当前 Console 设计反映了"按字段堆"，不是"按抽象组织"。把 §1 的 8 个抽象想清楚 + §2 的 3 条边界画清楚 + §5 的 6 条原则当成 PR review checklist，剩下的工作都是机械执行。

**这份文档怎么用**：

| 场景 | 查哪一节 |
|---|---|
| 不知道某字段该放哪个页面 | §3.3 "职责契约" 表 |
| 新需求 "我想加一个 XX 配置" | §2 判断抽象层 vs 渠道层 |
| "在 Skills 里塞点 sub-agent 信息很方便"的诱惑 | §5.1 One Source of Truth |
| PR review | §9.5 检查清单 |
| 不知道下周做什么 | §6 + §9 排期 |
| Day 1 应该做什么 | §9.1 五件事 |

**给执行的两条硬纪律**：

1. **每个 PR 必须独立合理**（不能"先建模块 + 后接通"两段提交，那是死代码温床；要么就做完整的一片接通）
2. **每个 PR 必须能演示**（即使是一个 schema migration，也要演示完成后 UI 上能看到的变化）

读到这里如果有任何不认同的点，先回 §8 的 10 个问题。问题答完，按 §6 阶段化推进。
