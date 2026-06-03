# Lane 1 · 统一能力绑定清单 + 运行时切换（地基）

**来源：** [`doc/plans/2026-06-03-version-bound-config-blueprint-redesign.md`](../plans/2026-06-03-version-bound-config-blueprint-redesign.md) §2、§6.2
**风险：** 高（唯一碰运行时的 lane）→ 强制 e2e 守护测试，红→绿。
**依赖：** 无（但本 lane 须**先冻结共享契约**，Lane 3 依赖之）。

---

## 目标

把"护栏/工具/案例/知识库"从 org 全局开关，改为**跟当前 agent 版本走的统一绑定清单** `AgentConfig.capabilityBindings`；运行时按清单装载而非按全局 `enabled`。行为切换当天保持不变（迁移回填）。

---

## 步骤

### 0. 冻结共享契约（阻塞 Lane 3，最先做）

`packages/shared/types/index.ts` 新增：

```ts
export interface CapabilityBindings {
  guardrails: { preTool: string[]; postTool: string[]; preFinalize: string[] } // Policy.name[]
  tools: string[]      // Skill.name[]
  caseTypes: string[]  // CaseType.type[]
  knowledge: string[]  // KnowledgeSource.name[]（仅引用）
}
export const EMPTY_BINDINGS: CapabilityBindings // 缺省全空
```

通知 Lane 3：契约已冻结。

### 1. Schema + 迁移

`packages/shared/prisma/schema.prisma`：
```prisma
model AgentConfig {
  // ...
  policyHooks        String  // @deprecated → 迁移后移除（见步骤 3）
  capabilityBindings String? // 新增
}
```
- 新迁移 `20260603000009_add_capability_bindings`：加列。
- 数据迁移脚本（可放 `scripts/`）：每个 `AgentConfig` 行回填 `capabilityBindings`：
  - `guardrails` ← `JSON.parse(policyHooks)`（结构相同，直接搬）。
  - `tools` ← 当前 org 下 `Skill.enabled=true` 的 name 集合。
  - `caseTypes` ← 当前 org 下 `CaseType.enabled=true` 的 type 集合。
  - `knowledge` ← 当前 org 下 `KnowledgeSource.enabled=true` 的 name 集合。
- 验证回填正确后，**第二个迁移** `..._drop_policy_hooks` 移除 `policyHooks` 列（确认无代码再读它）。

### 2. resolveBindings helper

新建 `apps/console/lib/agent/resolve-bindings.ts`：
```ts
resolveBindings(bindings: CapabilityBindings, library: {...}) => { bound, missing }
```
- 输入：版本清单 + org 库现存项。
- 输出：`bound`（清单中仍存在的定义）、`missing`（清单引用但库中已删/改名 = drift）。
- 库页、放射图、运行时共用。

### 3. 运行时装载切换（逐个 grep 确认）

把"按全局 enabled / 读 policyHooks"改为"按当前版本 `capabilityBindings`"：
- `apps/console/lib/agent/loop.ts` — skill 装载。
- `apps/console/lib/agent/streaming-tool-executor.ts` — dispatch 白名单。
- **护栏链路**：`grep -rn "policyHooks" apps/console` 全部改读 `capabilityBindings.guardrails`。
- `SkillRouter` — `kb_search_*` 生成只为 `bindings.knowledge` 内的源；意图/案例分类只列 `bindings.caseTypes`。
- 共享 `loadAgentConfig` — 把清单一并加载。
- `apps/console/lib/agent/config-cache.ts` — 缓存键 `orgId::agentId` 已含 agent 维度，确认清单随缓存/失效。
- 全局 `enabled` 列语义降级为"该定义是否可用/软删除"。
- 遇 `missing`（drift）：跳过 + 写 trace 警告，**fail-soft 不崩**。

### 4. e2e 守护测试（强制，红→绿）

驱动真实入口（非 mock/seam）：
- 给版本 A 绑工具 `[X]`、版本 B 绑 `[Y]`；跑 `/api/messages`（或 playground runner）确认各自只看到自己绑的工具。
- 删除一个被绑定的 skill → 运行时 fail-soft，trace 有 drift 警告，不抛错。
- 护栏从 `policyHooks` 迁到 `capabilityBindings.guardrails` 后，原护栏行为不变（回归）。

---

## 验收

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # 全绿（含新 e2e 守护）+ 既有 1 个 PostgreSQL known-fail
npm run build:console                             # success
```
- 贴改动文件清单 + 上述输出。
- 完成后移本文件到 `doc/what's done/`，更新 `MASTER_BUILD_HANDOFF.md`。
