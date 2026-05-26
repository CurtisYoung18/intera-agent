# Console 可视化配置范围 — 设计规范

> **状态**：已批准，待实施  
> **日期**：2026-05-26  
> **来源**：`doc/to-do/console-config-scope.md` brainstorm 会话

---

## 目标

Console 是给**产品交付人员**用的，不是给工程师用的。交付人员的思维模型是"这个 case 走什么流程、用什么能力、什么时候升级人工"，不是"temperature 设多少、compaction 阈值多少 token"。

参照 Claude Code 的取舍哲学：CC 把 Tool 定义、Agent Loop、权限引擎全部 hardcode，只把 Skill（SKILL.md + frontmatter）开放给用户。Intera Console 配置面应比 CC 宽（因为有 case flow 这个维度），但不能把工程实现细节暴露出去。

**终极目标**：Intera 是一套高通用性 SaaS——

- **Intera** = 能力契约（skills + case types + guardrails）
- **集成层**（Chat App / LiveChat / API）= UX 表达——各自根据 Intera 的能力契约适配自己的交互体验
- 同一套 Intera 配置，切换集成方式，UI/UX 不同，但核心能力相同

---

## 架构决策

### A1 — Agent Config 发散图：5 卡 @ 72°

不引入第 6 张卡。5 张卡均匀分布，每张都有实质可配置内容：

| 角度 | 卡片 | 核心内容 |
|------|------|---------|
| -90° | **Model & Prompt** | system prompt（主区域）+ model + temperature（Advanced 折叠） |
| -18° | **Memory** | 三档 slider（Short-term / Balanced / Long-term） |
| 54° | **Guardrails** | Guardrails Builder（业务语义） |
| 126° | **Human Ops** | consultation prompt + human skills |
| 198° | **Knowledge** | KB 配置简化版 |

> **实施**：前端 `SATELLITE_ANGLES` 常量从 60° 间隔改为 72° 间隔。

### A2 — Model & Prompt 卡合并

Prompt 不再独立成卡，并入 Model 卡。两者强相关："怎么说话"（prompt）+"用什么模型说"（model + temperature）。

Drawer 布局：
- 主区域：`systemPrompt`（模板变量：`{{case_types}}` `{{skills}}` `{{policies}}`）
- Advanced 折叠区：`model` 选择器 + `temperature` 语义 slider（0.1 精准 ←→ 1.0 创意，推荐 0.1–0.4）
- Hardcode（从 UI 移除）：`evaluationModel`、`thinkingBudget`、`maxIterations`、`maxOutputTokens`、`enableLlmSanitization`

### A3 — Memory：20+ 字段 → 三档 slider

```
Memory:  ( ) Short-term  (•) Balanced  ( ) Long-term

  Short-term: 保留最近 ~8 轮，适合快速简单 case
  Balanced:   保留 ~20 轮 + 压缩摘要，适合一般客服工单
  Long-term:  保留 ~40 轮 + 详细摘要，适合复杂调查 case
```

引擎内部把档位映射到 token 阈值和压缩参数。交付人员选档位，引擎处理细节。

### A4 — ExecutionMode：`'stage' | 'step'`（引擎已落地）

引擎已实现两种执行模式，Console 需要跟上：

| | `stage` 模式 | `step` 模式 |
|---|---|---|
| **Policy** | `StagePolicy` | `StepPolicy` |
| **工具过滤** | `stage.availableSkills` 白名单 | 锁定 `requiredTools ∪ optionalTools` |
| **推进条件** | 显式 transition（auto / AI / manual） | `completionCriteria` 全部满足后自动推进 |
| **Console UI** | Stage 列表 + Stage 抽屉 | Stage 抽屉内出现 Step 序列编辑器 |

`sop` 字段不再是执行模式，而是 prompt appendix（case 级和 stage 级都可配）。

**Step 序列编辑器**（Console 缺失的 UI）：每步配置 `name / goal / requiredTools / optionalTools / completionCriteria / onFailure / maxRetries`。

`completionCriteria.type`：`tool_called` / `fact_extracted` / `output_matches`  
`onFailure.action`：`retry` / `skip_step` / `escalate_to_human` / `abort_case`

### A5 — Policy → Guardrails Builder

用业务语义表达替代底层引擎 API。交付人员的思维是"关单前必须核实身份"，不是"在 postTool hook 上设 require_skills_any 规则"。

```
When:       [Before closing a case ▾]
Rule Type:  [Must call ▾]
Target:     [verify_identity] [×]
Condition:  (AI eval) [用户身份已验证且与工单信息一致]
[Enabled ✓]
```

底层映射（Console 不感知）：`require_skills` / `deny_skills` / `enableLlm + evaluationPrompt` / `hook_skills`

### A6 — Skills：uiHints 契约

新增三个字段：

```typescript
uiHints: {
  renderAs: 'form' | 'confirm' | 'picker' | 'card'
  fields?: FieldHint[]       // 每字段的 widget/label/校验
  resultRenderAs: 'text' | 'table' | 'card' | 'list'
}
triggerConditions: {
  keywords: string[]
  intents: string[]
}
allowedIntegrations: ('chat' | 'livechat' | 'api')[]
```

**降级策略**：绑定约束，不做运行时降级。Console 绑定 UI 在渠道不支持该 skill 的 `uiHints.renderAs` 时直接 disable 对应渠道开关，悬停显示原因。

移除工程字段：`mode`、`endpoint`、`httpMethod`、`headers`、`timeoutMs`、`mockFixture`、`guardPhase`、`isConcurrencySafe`、`outputSchema`。

### A7 — System Skill vs Business Skill

| | System Skill | Business Skill |
|---|---|---|
| 核心定义 | **只读** | 可编辑 |
| 运行设置 | 可配（enabled / displayVerb / uiHints / triggerConditions） | 全部可配 |
| 默认状态 | **默认开启** | 创建时默认关闭 |
| 删除 | **不可删除** | 可删除 |
| 视觉 | "System" 徽章 + 浅蓝底色 + 置顶 | 无徽章 |

---

## 实施 Roadmap

| 优先级 | 范围 | 工作量 |
|--------|------|--------|
| **P0** | Memory 区域简化（20+ 字段 → 三档 slider） | 小 |
| **P0** | Model & Prompt 卡重构（合并，model/temperature 入 Advanced 折叠） | 小 |
| **P0** | 发散图 5 卡 @ 72°（更新 `SATELLITE_ANGLES`） | 小 |
| **P1** | Case Type：executionMode 切换 + Step 序列编辑器 | 中 |
| **P1** | Policy → Guardrails Builder | 中 |
| **P1** | Skills 移除工程字段 + uiHints / triggerConditions / allowedIntegrations | 中 |
| **P2** | Case Types 简化（autoCloseConditions 结构化、evidence 简化） | 中 |
| **P2** | Knowledge 移除工程字段 | 小 |
| **P3** | Integrations 新增 channelSkillBinding / rateLimit / webhookEvents | 中 |

---

## 不做的事

- **Console 用户分层**（超级管理员 / 交付人员）：暂不引入，当前单层即可
- **Persona 卡**（语气/语言）：与 Model+Prompt 卡重叠，不引入
- **第 6 张卫星卡**：5 卡已够，不为对称凑数
- **Step 模式的 per-stage strict flag**：成本大，现有 step mode + stage mode 已够用
- **运行时 uiHints 降级**：配置阶段约束即可，不做自动降级逻辑
