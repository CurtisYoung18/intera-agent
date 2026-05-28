# Policy / Guardrails 系统修复方案

> 审计日期：2026-05-27
> 范围：PolicyEngine（护栏引擎）+ ExecutionPolicy（执行策略）+ Console Guardrails 配置 UI

---

## 0. 现状诊断

两套同名但不同质的 "Policy"：

| | ExecutionPolicy (`policies/`) | PolicyEngine (`policy.ts`) |
|---|---|---|
| 职责 | 控制 Agent Loop **执行流程** | 护栏规则 **合规检查** |
| 决定内容 | 工具白名单、终止/继续 | 某次工具调用是否违规 |
| 使用场景 | Discovery / Stage / SubAgent | preTool / postTool / preFinalize |
| 配置来源 | 硬编码 + StageConfig | 内置 + AgentConfig + DB |

另外 `policyHooks` 初始化存在**覆盖顺序 bug**，导致 AgentConfig 的配置被 DB 全局数据冲掉。

---

## 1. Bug Fix: policyHooks 初始化顺序

### 问题

[policy.ts:57-83](apps/chat/lib/agent/policy.ts#L57-L83)

```typescript
// 构造函数 — AgentConfig 覆盖内置 hooks
if (policyHooks) {
  this.hooks.preTool = policyHooks.preTool   // 替换
}
// create() — DB 追加，冲掉上面的覆盖
engine.hooks[hook].push(p.name)
```

结果：AgentConfig 想自定义 preTool = `["no_high_risk_account_change"]`（仅 1 条），但 DB 中所有 enabled 的 preTool policies 都会被 `push` 进去。Agent 无法排除自己不需要的全局 policy。

### 修复

**原则：AgentConfig.policyHooks 是唯一权威来源。**

```
优先级: AgentConfig.policyHooks > DB defaults > 内置 fallback
```

具体改动：

1. **删除 `loadBuiltInPolicies()` 中的 `this.hooks.*` 赋值**（[policy.ts:152-158](apps/chat/lib/agent/policy.ts#L152-L158)）—— 内置 policies 只注册进 `this.policies` Map，不决定 hook 绑定顺序
2. **`create()` 中按以下逻辑设置 hooks**：

```
if AgentConfig.policyHooks 存在:
  使用 AgentConfig.policyHooks（依次查 this.policies Map，缺失的跳过）
else:
  从 DB 所有 enabled policies 按 hook 分组
  if DB 为空:
    使用内置默认 hook 分配（loadBuiltInPolicies 原来的分配逻辑移到此处作为最终兜底）
```

3. **Console 的 `AgentPolicyHooksPicker` 加载时**从 catalog 拉取全部 enabled policies，按 DB `hook` 字段做初始分组，用户可自由修改。

### 文件改动

- `apps/chat/lib/agent/policy.ts` — 重构 `create()` 和 `loadBuiltInPolicies()`
- `apps/chat/lib/agent/loop.ts` — 确认 `PolicyEngine.create()` 调用处传参不变

---

## 2. 重命名: ExecutionPolicy → ExecutionStrategy

### 问题

`ExecutionPolicy`（`policies/types.ts`）和 `PolicyEngine`（`policy.ts`）都叫 "Policy"，但完全正交。新人看代码会被误导。

### 方案

文件/接口重命名：

| 当前 | 改为 |
|------|------|
| `policies/` 目录 | `strategies/` |
| `ExecutionPolicy` 接口 | `ExecutionStrategy` |
| `DiscoveryPolicy` 类 | `DiscoveryStrategy` |
| `StagePolicy` 类 | `StageStrategy` |
| `ChecklistPolicy` 类 | `ChecklistStrategy` |
| `policies/types.ts` | `strategies/types.ts` |

引用更新：
- `loop.ts`、`case-agent-loop.ts`、`sub-agent.ts`、`conversation-loop.ts` 中的 import 路径和类型名
- `__tests__/` 中的 import

**Policy 一词保留给 PolicyEngine 和 Console Guardrails 专属使用。**

### 文件改动

- `apps/chat/lib/agent/policies/` → `apps/chat/lib/agent/strategies/`
- 上述 4 个引用文件 + 测试文件

---

## 3. Console Guardrail Builder 简单模式补全

### 问题

简单模式只支持 3 种类型（Must call / Never allow / AI evaluation），缺 2 种常用规则类型：

- `require_skills_any` — "至少调用一个"（最常见："结案前至少查过一次查询工具"）
- `hook_skills` — "仅当特定技能被调用时触发"（postTool 必备）

### 方案

在 Guardrail Builder 简单模式下增加 2 种类型选项：

```
现有的 3 种：
  "Never allow"          → deny_skills
  "Must call"            → require_skills (全部)
  "AI evaluation"        → evaluationPrompt

新增：
  "Must call (any one)"  → require_skills_any  ← 新增
  "AI evaluation (filtered)" → evaluationPrompt + hook_skills  ← 新增
```

UI 改动：
- "Must call (any one)"：下拉选择 1 个 trigger skill，ChipInput 选择至少调用其一的目标技能列表
- "AI evaluation (filtered)"：同 "AI evaluation" 的 prompt textarea，外加一个 ChipInput 选择仅对哪些技能触发（映射到 `hook_skills`）
- 新增对应的 i18n 键：`guardrails.builder.type.requireAny`、`guardrails.builder.type.aiFiltered`

### 文件改动

- `apps/console/app/admin/guardrails/page.tsx` — 增加 2 种 builder 类型分支
- `apps/console/lib/i18n/dictionaries.ts` — 补充中英文标签

---

## 4. Hook 不匹配校验

### 问题

Console 的 `AgentPolicyHooksPicker` 允许将 policy 分配到与其自身 `hook` 字段不一致的 hook phase（如将 `postTool` policy 放到 `preTool` 列），运行时行为不确定。

### 方案

两种选择：

**A. 容忍（推荐）**：AgentConfig.policyHooks 覆盖 policy 自身的 `hook` 字段。一条 policy 的 `hook` 只是 DB 注册时的默认值，Agent 可以决定在任何 checkpoint 执行它。

**B. 约束**：在 `AgentPolicyHooksPicker` 中对每个 hook phase 列的候选下拉只显示 `hook` 字段匹配的 policies。

推荐 **A**，因为它是更灵活的设计——同一条 "must_cite_basis" 规则理论上可以在 preFinalize 或 postTool 都生效。但需要：
- 在 UI 上做视觉提示：如果分配到的 hook 与 policy.hook 不一致，chip 旁边显示一个小警告图标 `⚠` + tooltip "原始配置为 postTool，此处分配到 preTool"
- `policy.ts` 中 `require_skills` / `require_skills_any` 在非 preTool 检查点被调用时（此时 `context.skillName` 为空），跳过，因为 `hook_skills` 只能根据当前工具名过滤

### 文件改动

- `apps/console/components/admin/agent-policy-hooks-picker.tsx` — 添加 hook 不匹配警告图标 + tooltip
- i18n 补充 `agent.guardrails.hookMismatchTooltip` 键

---

## 5. Hit Stats 后端实现

### 问题

Console Guardrails 页面的 "Hit Statistics" section 是纯 UI 骨架，所有数值显示 `"—"`，无后端数据管道。

### 方案

利用已有的 `ActionTrace` 表做聚合。PolicyEngine 已经在每次命中时写入 trace（`policy_hit` 事件）：

[loop.ts:1058-1068](apps/chat/lib/agent/loop.ts#L1058-L1068)
```typescript
await this.traceWriter.write('policy_hit', ...)
```

**Step 1 — DB 查询 API**：新增 `GET /api/admin/policies/stats`：

```sql
SELECT
  JSON_EXTRACT_PATH_TEXT(details::json, 'policyName') AS policy_name,
  COUNT(*) AS hit_count
FROM action_traces
WHERE customer_id = $1
  AND type = 'policy_hit'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY policy_name
ORDER BY hit_count DESC
```

**Step 2 — Console 页面接入**：Guardrails 页面 `useEffect` 调用 stats API，替换 `"—"` 为实际数字。

**Step 3 — 按 result 细分**（可选 v2）：区分 `blocked`/`hint`/`escalated` 命中 vs `pass`。

### 文件改动

- `apps/console/app/api/admin/policies/stats/route.ts` — 新增
- `apps/console/app/admin/guardrails/page.tsx` — 接入 stats 数据

---

---
## 6. Console Guardrails 页面 UI/UX 细化

### 6.1 卡片视觉层次缺失

**现状**：每张 policy 卡片在 TiltCard 中渲染，所有卡片外观相同。关键信息层级混乱：

- 图标颜色**硬编码为 amber**（[page.tsx:203](apps/console/app/admin/guardrails/page.tsx#L203) `bg-amber/[0.06]`、`text-amber`），无视 hook 类型（preTool=amber, postTool=blue, preFinalize=green）。预定义了 `hookMeta` 的 `icon` 和 `color`，但渲染卡片图标时直接用字符串 `"amber"` 而非 `hm.color`
- `summarizeRule()` 函数只覆盖 `never_allow`/`must_call`/`ai_eval` 三种类型，缺失 `require_skills_any` 和同时存在多种 rule 的组合情况，此时显示 "No conditions configured"
- 无法区分"已分配给 Agent"和"仅存在于库中"的 policy
- hover 才出现的编辑/删除按钮在触屏设备上无法使用

**方案**：

1. **修复图标颜色** — 使用 `hookMeta[p.hook].color` 动态设置图标容器颜色
2. **补全 summarizeRule()**：
   ```typescript
   function summarizeRule(rule: string): string {
     const f = parseRule(rule)
     const parts: string[] = []
     if (f.deny_skills.length) parts.push(`Blocks: ${f.deny_skills.join(', ')}`)
     if (f.require_skills.length) parts.push(`Requires ALL: ${f.require_skills.join(', ')}`)
     if (f.require_skills_any.length) parts.push(`Requires ANY: ${f.require_skills_any.join(', ')}`)
     if (f.evaluationPrompt && f.enableLlm) parts.push(`AI: ${f.evaluationPrompt.slice(0, 60)}…`)
     return parts.length ? parts.join(' · ') : 'No conditions configured'
   }
   ```
3. **卡片分组**：按 hook phase 分三个 section，各 section 标题带对应颜色标识
4. **编辑/删除按钮常驻**：去掉 `opacity-0 group-hover:opacity-100`，改为始终可见的半透明按钮
5. **"使用中"标记**：如果某 policy 名字出现在 AgentConfig.policyHooks 中，卡片右上角显示小绿点 + "Active" tooltip

### 6.2 简单模式数据丢失问题

**现状**：`applyGuardrailToRule()` 切换类型时**完全重置所有字段**：

```typescript
function applyGuardrailToRule(...): RuleFields {
  const base: RuleFields = {
    deny_skills: [], require_skills: [], require_skills_any: [],
    hook_skills: [], enableLlm: false, evaluationPrompt: '',
  }
  // 只填充当前类型对应的字段，其他全部丢失
}
```

同时 `detectGuardrailType()` 检测逻辑不覆盖 `require_skills_any` 和 `hook_skills`，导致这些配置在简单模式下不可见/不可编辑。

**方案**：

1. **保留跨类型字段** — `applyGuardrailToRule()` 改为只修改当前类型对应的字段，保留其余：
   ```typescript
   function applyGuardrailToRule(f: RuleFields, type: GuardrailType, skills: string[], condition: string): RuleFields {
     const next = { ...f }
     switch (type) {
       case 'must_call':       next.require_skills = skills; break
       case 'must_call_any':   next.require_skills_any = skills; break
       case 'never_allow':     next.deny_skills = skills; break
       case 'ai_eval':         next.evaluationPrompt = condition; next.enableLlm = true; break
       case 'ai_eval_filtered': next.evaluationPrompt = condition; next.enableLlm = true; break
     }
     return next
   }
   ```
2. **切换 Simple→Advanced→Simple 防丢**：进入 Advanced 模式前缓存 `ruleFields` 快照，回到 Simple 时若结构可表达则恢复
3. **`detectGuardrailType()` 扩展**：增加对 `require_skills_any` 和 `hook_skills` 的检测，若包含不可简单表达的组合则自动切换为 Advanced 模式

### 6.3 AgentPolicyHooksPicker 信息密度不足

**现状**：三列布局每列显示已分配的 policy name chips + 添加下拉。问题是：

- 每个 chip **只显示 policy name**，不知道它做什么（deny？require？AI eval？）
- 用户必须记住 policy 名字才能理解当前护栏配置
- dropdown 中跨 hook 的 policy 用 `·· postTool` 标记，但分配后警告消失
- "孤儿" policy（名字在 hooks 但 catalog 中不存在）有一定提示，但太弱

**方案**：

1. **Chip 内显示简短摘要**：每个 chip 内部两行 — 第一行 policy name（加粗），第二行 `summarizeRule()` 简短描述（10px 灰色文字）。如果 catalog 中查不到则显示 "Not in library"
2. **跨 hook 警告持久化**：分配后 chip 右侧始终显示小警告图标（若 policy.hook ≠ 当前列 hook），tooltip 显示 "此策略原始配置为 postTool，当前分配到 preTool"
3. **下拉分组**：`eligibleToAdd` 下拉中用 `<optgroup>` 按 hook 匹配 vs 非匹配分组，视觉上区分

### 6.4 GuardrailSummaryList 缺失组合规则

**现状**：GuardrailSummaryList 为每条 policy 最多生成 1 个 chip。但一条 policy 可以同时有 `require_skills_any` + `evaluationPrompt`（AI 评估 + 硬性前置条件），应显示 2 个 chip。

**方案**：改为对每条 policy 的每个非空 rule 字段分别生成 chip：
- `deny_skills` → amber chip
- `require_skills` / `require_skills_any` → malachite chip
- `evaluationPrompt` + `enableLlm` → lavender chip

### 6.5 库与分配的认知割裂

**现状**：用户在 `/admin/guardrails` 创建 policy，再去 `/admin/agent` 分配。两者之间没有导航上下文——从 policy 列表看不到谁在用，从 Agent 配置看不到 policy 详情。

**方案**：

1. **Guardrails 列表页增加"Used by"列**：每张卡片底部显示一行小字 "Used by: Agent Config"（如果该 policy 出现在 AgentConfig.policyHooks 中），否则 "Not assigned to any agent"
2. **AgentPolicyHooksPicker 中的 chip 可点击**：点击 chip 跳转到 `/admin/guardrails?edit=policyName` 打开该 policy 的编辑弹窗

### 6.6 编辑器细节问题

- **Name 不可变但无提示**：`<input disabled={!isNew}>` 但没有说明文字。应该加一行 `text-[10px] text-[var(--smoke)]` 的 "Name cannot be changed after creation"
- **保存无校验**：允许保存空 rule、空 name。应该至少校验 name 非空、rule 至少有一条规则
- **删除用原生 confirm()**：Chrome 的 `confirm()` 弹窗与整个 glass-morphism 风格格格不入。应使用自定义确认弹窗
- **新建后 Modal 关闭时列表不刷新**：如果 API 返回非 200，`alert()` 弹出但 Modal 不关闭，用户可能困惑

---

## 7. Open Questions

1. **Policy 是否需要版本控制？** 改了 policy rule 会影响所有使用它的 Agent。是否需要在 AgentConfig 中记录 "policy snapshot" 而非只记录名字？
2. **是否支持 policy 的测试/模拟？** 运营人员配置了一条 AI evaluation 策略后，无法预览它对某个 skill output 的判断结果
3. **是否需要 policy 模板库？** 目前只有 6 条内置 policy，是否预置更多行业模板（电商客服、游戏客服、金融客服）？

---

## 8. 工作量评估（更新）

| # | 项 | 工作量 | 风险 |
|---|-----|--------|------|
| 1 | policyHooks 初始化顺序 bug fix | 2h | 中 — 需验证不破坏现有 Agent 行为 |
| 2 | ExecutionPolicy → ExecutionStrategy 重命名 | 1h | 低 — 纯重命名，全局搜索替换 |
| 3 | Guardrail Builder 简单模式补全 | 1.5h | 低 — UI 增量改动 |
| 4 | Hook 不匹配校验 | 0.5h | 低 — 仅 UI 提示 |
| 5 | Hit Stats 后端 | 2h | 低 — 新增独立 API |
| 6.1 | 卡片视觉层次修复 | 1h | 低 — CSS + summarizeRule 补全 |
| 6.2 | 简单模式防数据丢失 | 1.5h | 中 — 需要改切换逻辑 |
| 6.3 | Picker chip 增强 | 1h | 低 — UI 增量 |
| 6.4 | SummaryList 组合规则 | 0.5h | 低 — 小改动 |
| 6.5 | 库/分配关联（Used by + chip 跳转） | 1.5h | 低 — 需要查询 AgentConfig |
| 6.6 | 编辑器细节修复 | 1h | 低 — 校验 + 自定义确认弹窗 |
| **合计** | | **~2.5 天** | |

## 9. 建议优先级

**Phase 1 — 必须修（演示前）**
1. **#1 Bug Fix**（2h）— policyHooks 覆盖逻辑 bug
2. **#6.1 卡片视觉修复**（1h）— 图标颜色 bug + summarizeRule 补全
3. **#6.2 简单模式防丢数据**（1.5h）— 运营人员切换类型时丢失配置
4. **#6.6 编辑器细节**（1h）— 校验 + 确认弹窗

**Phase 2 — 演示加分**
5. **#3 简单模式新增 2 种类型**（1.5h）
6. **#6.3 Picker chip 显示摘要**（1h）— Agent 配置页面可读性
7. **#5 Hit Stats**（2h）— 真实数据

**Phase 3 — 后续迭代**
8. **#6.5 库/分配关联**（1.5h）
9. **#6.4 SummaryList 组合规则**（0.5h）
10. **#4 Hook 不匹配校验**（0.5h）
11. **#2 重命名**（1h）
