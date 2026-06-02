# Console 重设计：从字段堆到抽象组织

> **来源合并**: `console-audit-v5.md` + `console-config-scope.md` + `case-type-subagent-ux.md` + `console-redesign-master.md` + `policy-guardrails-fix.md` + `channels-dashboard-plan.md`
> **总诊断**: 当前 Console 按字段堆而非按抽象组织，同一概念多处出现且行为不一致。重设计目标：把 8 个核心抽象想清楚 + 画清 3 条边界 + 让每个抽象有"真理之源"页面。
> **工作量**: 4-5 周。已含 audit v5 修复 + guardrails 重塑 + channels 重组 + subagent UX。

---

## 1. 根因：三条边界没分清

7 个 UX 问题，6 个是同一根因——"抽象层 / 渠道层 / 配置层"三边界混淆。

### 1.1 抽象层 vs 渠道层

| 抽象层（Agent 内核） | 渠道层（集成行为） |
|---|---|
| prompt / model / memory | credentials & connection |
| capabilities (skills/sub-agents) | per-channel render hints |
| guardrails | per-channel human escalation |
| case types | per-channel routing rules |
| knowledge | — |

**判定规则**: 一个字段如果在 Web Chat 和 LiveChat 应该不同 → 渠道层；如果两边应该一样 → 抽象层。**不允许两边都改**。

典型错位：`consultationPrompt` 在 agent config 里 → 应为 `Channel(web-chat).humanOps.consultationPrompt`，因为 LiveChat 走 `transfer_chat`。

### 1.2 配置层 vs 运营层

| 配置层（Admin） | 运营层（Ops） |
|---|---|
| 定义 agent 怎么工作 | 观察 agent 怎么工作 |
| 改后下次 case 生效 | 实时/历史的 case/trace/dashboard |

Ops 页面不要嵌入配置入口（跳转链接可以，但不应有可编辑字段）。

### 1.3 真理之源 vs 镜像

每个抽象在一个页面被编辑（真理之源），其它页面只读显示摘要 + 跳转。

---

## 2. 8 个核心抽象 + 关系链

```
CHANNEL ──→ AGENT ──→ CASE TYPE
               │           │
               │ uses      │ defines
               ↓           ↓
          CAPABILITY   SUB-AGENT
               │
               │ constrained by
               ↓
          GUARDRAIL

          KNOWLEDGE (RAG)
          HUMAN OPS (per-channel escalation)
```

---

## 3. Config Scope：CC 对齐原则

交付人员懂 Agent。Console 默认**全面可配**，仅锁定系统契约字段和引擎内部字段。不确定时查 CC 源码——CC 暴露什么给用户，Intera 就暴露什么。

| 字段 | CC 做法 | Intera 决策 |
|------|---------|------------|
| `showThinking` | 用户可配 | CONFIGURABLE |
| `isConcurrencySafe` | 硬编码 per-tool | HARDCODE |
| `isReadOnly` / `isDestructive` | 硬编码 | HARDCODE |
| `propose_interaction` | 内置，sub-agent 不可用 | KEEP — 仅主 Agent |

---

## 4. Audit v5：五项修复

### 4.1 Agent Config 卫星重组

当前 6 个卫星卡片：Brain (prompt+model)、Capabilities、Guardrails、Case Types、Channels、Human Ops。改为 **read-only nav chip**，点击跳转到对应真理之源页面，不再在 drawer 里编辑。

### 4.2 Sidebar 路由清理

- 新增 `/admin/human-ops`（operate 区）
- `/admin/routing` → 融入 Channels 详情页（routing tab）
- 系统 skills 严格分为 7 个 system + 其余 → Business
- `kb_hybrid_retrieve` → Special skill（toggle-only，config 在 `/admin/knowledge`）

### 4.3 Integrations → Channels

页面从低密度卡片+隐藏 save button 改为 **Channels landing grid** + 活跃 LiveChat 详情面板。Save button 修复：`bg-indigo-500` → `bg-indigo`（project token）。

### 4.4 Policy → Guardrail 重命名

UI labels 改，engine 字段 `policyHooks` 保留。Drawer 改为 read-only chip summary，完整编辑在 `/admin/policies`（→ `/admin/guardrails`）。

---

## 5. Policy/Guardrails 系统修复

### 5.1 两套 "Policy" 的命名冲突

| | ExecutionPolicy (`strategies/`) | PolicyEngine (`policy.ts`) |
|---|---|---|
| 职责 | Agent Loop 执行流程控制 | 护栏规则合规检查 |
| 使用时 | 工具白名单、终止/继续 | preTool / postTool / preFinalize |

**修复**: `ExecutionPolicy` → `ExecutionStrategy`，`policies/` → `strategies/`。"Policy" 一词保留给 PolicyEngine + Console Guardrails。

### 5.2 policyHooks 初始化覆盖 bug

`loadBuiltInPolicies()` 先设 hooks 再被 DB `push` 覆盖 → AgentConfig 的自定义配置被冲掉。

**修复**: 优先级改为 `AgentConfig.policyHooks > DB defaults > 内置 fallback`。删除 `loadBuiltInPolicies()` 中的 hooks 赋值；`create()` 按优先级链设置。

### 5.3 Guardrail Builder 增强

新增 `require_skills_any` 和 `hook_skills` 类型支持。防切换类型丢失数据、补全 `summarizeRule()`、修图标颜色硬编码 bug、加上"Used by"关联列。

### 5.4 Hit Stats 后端

新增 `GET /api/admin/policies/stats`，从 `action_traces` 聚合 7 天命中统计。

---

## 6. Case-Type Subagent UX（双模式）

`executionMode: 'stage' | 'cc'` 两种模式，sub-agent 定义位置不同：

| Mode | Sub-agent 定义位置 | 编辑位置 |
|------|-------------------|---------|
| `'stage'` | `StageConfig.subAgents[]` | Case Type detail 的 per-stage panel |
| `'cc'` | 全局 registry | `/admin/sub-agents`（→ 合并进 Capabilities） |

当前 sub-agent 配置是 JSON-only，无真正 UI 编辑器。此 addendum 填补 stage 和 cc 两种模式的编辑空白。

---

## 7. 新 IA：10 项侧边栏

**Operate (4)**:
- Chats — 实时对话 + trace（扩展 trace 视图属 S6）
- Human Tasks — 人工工单队列
- Dashboards — 引擎健康 + 数据
- Guide — 操作手册

**Configure (6)**:
- **Agent** — brain only：prompt + model + memory + generation
- **Capabilities** — Skills tab + Sub-agents tab（合并 `/admin/sub-agents`）
- **Guardrails** — 4 要素卡片 + sentence builder
- **Case Types** — 案例定义、stages、per-stage sub-agents
- **Channels** — 4-tab 详情页（Connection / Routing / Rendering / Human Ops）
- **Knowledge** — 知识源管理

净变化：8 admin pages → 6（删 routing + sub-agents + human-ops 独立路由）。

---

## 8. Channel 详情页结构（4 tabs）

每个 channel（LiveChat / WebChat / Telegram）的详情页统一：

| Tab | 内容 |
|-----|------|
| **Connection** | credentials + health + status toggle |
| **Routing** | 该 channel 的 incoming → case type 路由规则 |
| **Rendering** | render hints overrides + per-skill 预览 |
| **Human Ops** | escalation threshold、transfer 策略、consultationPrompt |

Telegram + LiveDesk → 初始为占位卡。

---

## 9. Channels Dashboard（附加）

Human Tasks → 重塑为"按渠道的 Web Chat"。Dashboard 聚合全部 channel 的活动统计：活跃对话数（带 channel 细分）、消息量趋势、escalation 率、健康度指示。

---

## 10. 实现优先级

### 演示前 Day 1（4h，消灭翻车点）
1. 修 system skills `mock` mode 显示 bug
2. 删 Skills 页 sub-agent section
3. Skills 页加 "Model preview"
4. 修 sub-agents 页面跳转
5. 删 `/admin/routing`

### 演示前 1-2 周
6. HumanOps 按渠道重塑 + 卫星→summary
7. LiveChat iframe + rich-message preview
8. Guardrails 4 要素卡片 + sentence builder + hit stats
9. HTTP skills outputSchema 填充 + "Test endpoint" 自动 infer

### 演示后 v2
10. 卫星→nav chip、Skills→Capabilities 重命名、Channels 重组、配置版本/回滚、Export/Import、Onboarding checklist
