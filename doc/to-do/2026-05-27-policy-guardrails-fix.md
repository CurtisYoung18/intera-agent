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

## 6. 工作量评估

| # | 项 | 工作量 | 风险 |
|---|-----|--------|------|
| 1 | policyHooks 初始化顺序 bug fix | 2h | 中 — 需验证不破坏现有 Agent 行为 |
| 2 | ExecutionPolicy → ExecutionStrategy 重命名 | 1h | 低 — 纯重命名，全局搜索替换 |
| 3 | Guardrail Builder 简单模式补全 | 1.5h | 低 — UI 增量改动 |
| 4 | Hook 不匹配校验 | 0.5h | 低 — 仅 UI 提示 |
| 5 | Hit Stats 后端 | 2h | 低 — 新增独立 API |
| **合计** | | **~1 天** | |

## 7. 建议优先级

1. **#1（Bug Fix）** — 最高。当前 policyHooks 覆盖逻辑有 bug，影响每个配置了自定义 hooks 的 Agent
2. **#3（简单模式补全）** — 高。运营人员无法在简单模式下创建最常见的护栏类型
3. **#5（Hit Stats）** — 中。演示时客户问"护栏命中次数"时能看到真实数据
4. **#4（Hook 不匹配校验）** — 低。视觉提示，不阻塞功能
5. **#2（重命名）** — 低。代码卫生，不影响行为
