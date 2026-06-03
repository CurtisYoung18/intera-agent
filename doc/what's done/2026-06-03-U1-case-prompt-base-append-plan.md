# U1 规划文档 — Case Prompt: swap → base+append

**创建:** 2026-06-03 | **分支:** `main` | **状态ःplan ready（架构师定稿，含 8 点 + migration + 守卫测试）**
**决策:** 已锁 base+append（用户拍板）。本文件是 U1 "needs planning session" 的产出，交 coding agent 实施。

> 这是**运行时 prompt 组装语义改动**，鉴权/行为敏感。**严格按本文件分期执行**，每期独立验证。所有现状均对照源码核实（file:line 为证）。

---

## 0. 目标模型（locked）

> **`coreSystemPrompt` = 唯一 base。** 接待/发现模式 = base。工单模式 = `base + caseAddendum（可选小段增量）+ Case Types 的 stage SOP`。
> 消除"两个完整 prompt 整体 swap"，消除维护重复。

---

## 1. 现状全图（已核实）

### 1.1 DB schema（`packages/shared/prisma/schema.prisma:52` AgentConfig）
- `systemPrompt String`（**必填**）— 注释"Case base prompt (active-case mode)"，即当前的完整 case prompt。
- `coreSystemPrompt String?`（可选）— 注释"falls back to CORE_SYSTEM_PROMPT default when empty"。

### 1.2 三个默认常量（`packages/shared/defaults/index.ts`）
| 常量 | 行 | 角色 | 谁在用 |
|---|---|---|---|
| `DEFAULT_SYSTEM_PROMPT` | 4 | systemPrompt 的种子/兜底 | seed.ts:67、admin/agent/route.ts:32、config-loader.ts:27/54、playground-runner.ts:42、agent/page.tsx:611(reset)、**messages/route.ts:636(判定基准)** |
| `CORE_SYSTEM_PROMPT` | 63 | 发现模式默认 | messages/route.ts:362、playground-runner.ts:54(**硬编码**) |
| `CASE_SYSTEM_PROMPT` | 89 | 工单模式默认/兜底 | messages/route.ts:363 |

> ⚠️ **`CASE_SYSTEM_PROMPT` 当前是活代码**（messages/route.ts:363 的 fallback 初值），**不是死代码**。base+append 接管后才会失去意义——**届时才能删，现在删会破坏线上 fallback**。

### 1.3 运行时选择（两条路径，目前不一致）
**生产 [messages/route.ts](../../apps/console/app/api/messages/route.ts):**
- L362-363：初值 `coreSystemPrompt = CORE_SYSTEM_PROMPT`、`systemPrompt = CASE_SYSTEM_PROMPT`。
- L636：`if (agentConfig.systemPrompt && agentConfig.systemPrompt !== DEFAULT_SYSTEM_PROMPT) systemPrompt = agentConfig.systemPrompt` ← **smell：用"≠默认值"判定是否有自定义，若用户保存的 case prompt 恰等于 DEFAULT 则被忽略、回落 CASE_SYSTEM_PROMPT**。
- L642：`if (coreSystemPrompt.trim()) coreSystemPrompt = agentConfig.coreSystemPrompt`。
- L694-695：对两者各跑一次 `resolvePrompt(prompt, promptCtx)` 填充占位符。

**Playground [playground-runner.ts](../../apps/console/lib/agent/playground-runner.ts):**
- L42：`systemPrompt = agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT`（读 DB case prompt ✓）
- L54：`coreSystemPrompt: CORE_SYSTEM_PROMPT` ← **🔴 BUG：硬编码，忽略 DB 的 coreSystemPrompt**。配置人员改了 Core prompt，playground 不生效。
- **⚠️ 待 coding agent 核实**：playground-runner 是否也调用了 `resolvePrompt` 填充占位符？若没有，则 playground 还有"占位符未解析"的第二处不一致——一并修。

**模式切换内部:**
- `conversation-loop.ts:48` 发现模式 → `return coreSystemPrompt`。
- `loop.ts:127` `coreSystemPrompt: deps.coreSystemPrompt || deps.systemPrompt` ← smell：core 空时回落到 case prompt。
- `stage-executor.ts:93,99-100` 工单模式 → base=`systemPrompt`，再 append `## Stage: {stage}\n{cfg.systemPrompt}`（per-stage SOP）。

### 1.4 Sub-agent / Orchestrator
- `sub-agent.ts:103,159` 用 `this.config.systemPrompt`（含 `fc?.sharedSystemPrompt ?? this.config.systemPrompt`）。
- `orchestrator.ts:148` `sharedSystemPrompt = group[0]?.agentConfig.systemPrompt`。
- `stage-executor.ts:532` `over.systemPrompt ?? base.systemPrompt`。
→ sub-agent 目前以主 agent 的 `systemPrompt`(case prompt) 为 base。

---

## 2. 八个必须覆盖的点（comment 7 点 + 架构师补的第 8 点）

| # | 点 | 决策/方向 |
|---|---|---|
| 1 | **`systemPrompt` 字段归宿 + migration** | **不重命名、不删列**（sub-agent/orchestrator 仍读它）。**新增 `caseAddendum String?`**。运行时主 agent 工单模式**停止读 `systemPrompt`**，改读 `coreSystemPrompt + caseAddendum`。`systemPrompt` 列保留作 ① sub-agent 过渡读取 ② 回滚 ③ 迁移源。见 §5 migration。 |
| 2 | **`CASE_SYSTEM_PROMPT` 归宿** | 当前活代码，**本批不删**。base+append 接管 messages/route.ts:363 选择后，它仅作"caseAddendum 为空且无 SOP 时"的极端兜底；标注 `@deprecated`，删除留到 sub-agent 也迁移完（Phase 2 末）。 |
| 3 | **playground-runner coreSystemPrompt 硬编码 bug** | 独立 bug，**本批必修**：L54 改为读 `agentConfig.coreSystemPrompt || CORE_SYSTEM_PROMPT`，并与生产对齐 base+append 组装 + `resolvePrompt` 占位符填充。否则 playground 与线上行为继续对不上。 |
| 4 | **Placeholder 归属拆分** | 见 §3 归属表。base 与 caseAddendum 各自只解析自己该有的占位符，避免 `{{case_types}}` 出现在 base、`{{available_tools}}` 两边重复。 |
| 5 | **Sub-agent / Orchestrator 是否套用** | **Phase 1 不动**（仍读 `systemPrompt`，因此列必须保留）；**Phase 2** 再把 sub-agent/orchestrator 迁到 base+append。本批只做主 agent core↔case。**风险须知**：Phase 1 落地后，主 agent 走 base+append、sub-agent 走旧 systemPrompt，短期并存——可接受，但 Phase 2 前不要删 `systemPrompt` 列。 |
| 6 | **Console UI 拆分** | `agent/page.tsx` Brain 把当前单一大文本框拆为 **「Base Prompt（core，影响所有模式）」+「Case Addendum（仅工单激活时追加，可空）」** 两区，各自配占位符 pill（按 §3）。明示运营："Base 影响 core+case；Addendum 只在工单时叠加"。（与 U3 占位符清理协同。） |
| 7 | **向后兼容 migration** | 见 §5。核心：现有 `systemPrompt` 是含 core 内容的完整 prompt，直接当 addendum 会重复——用 `useLegacyCasePrompt` 标志保护存量 config 行为不变，新建/迁移后的 config 走 base+append。 |
| 8 | **真实切换点是 messages/route.ts:363+636** | base+append 必须改这里的选择逻辑（不只是 loop.ts）。顺手修掉 L636 的 `!== DEFAULT_SYSTEM_PROMPT` 脆弱判定。 |

---

## 3. Placeholder 归属表（建议默认，coding agent 须按各常量实际占位符核对调整）

| Placeholder | 归属 | 理由 |
|---|---|---|
| `{{available_tools}}` | **base** | 两模式都需知道可用工具 |
| `{{case_types}}` | **base** | 发现模式据此 dispatch |
| `{{session_binding}}` | **base** | 两模式都需用户身份 |
| `{{active_policies}}` | **base** | 全局护栏两模式都生效 |
| `{{case_schema}}` | **caseAddendum** | 仅工单激活有意义 |
| `{{case_state}}` | **caseAddendum** | 仅工单激活 |
| `{{confirmed_facts}}` / `{{skill_output}}` / `{{skills_called}}` | **caseAddendum / stage** | 工单执行期状态 |

> coding agent 落地前：审计 `CORE_SYSTEM_PROMPT` / `CASE_SYSTEM_PROMPT` 各自实际用到的占位符，按本表归位（core 默认里若混入 case_* 占位符，迁到 addendum 默认）。`resolvePrompt` 调用按 base/addendum 分别传入对应 context 子集。

---

## 4. 目标运行时组装（伪流程）

```
core = resolvePrompt(coreSystemPrompt || CORE_SYSTEM_PROMPT, baseCtx)   // baseCtx = tools/case_types/session/policies
if (无激活工单):
    finalPrompt = core                          // 发现模式
else:
    addendum = caseAddendum ? resolvePrompt(caseAddendum, caseCtx) : ''  // caseCtx = case_schema/case_state/facts
    finalPrompt = core + addendum + stageSOP(Case Types)                 // 工单模式
```
messages/route.ts 与 playground-runner.ts **必须走同一组装函数**——建议抽 `buildModePrompt()` 到 `lib/agent/`，两边都调，根除双路径漂移。

---

## 5. Migration 策略（最难，务必稳）

**Prisma migration:**
1. 新增列 `AgentConfig.caseAddendum String?`。
2. 新增列 `AgentConfig.useLegacyCasePrompt Boolean @default(true)` — 存量行默认 `true`（保旧行为），保证**上线零行为变更**。
3. 不动 `systemPrompt`、`coreSystemPrompt` 列。

**数据迁移（一次性脚本）：**
- 对每行：若 `coreSystemPrompt` 空 → 填入 `CORE_SYSTEM_PROMPT` 默认（让 base 显式化）。
- `caseAddendum` 留空。
- `useLegacyCasePrompt = true`（存量保旧路径：工单模式仍用 `systemPrompt`）。

**运行时分支:**
- `useLegacyCasePrompt === true` → 旧逻辑（工单用 `systemPrompt`）。
- `false` → 新 base+append。
- 新建 config（admin/agent/route.ts、seed）→ `useLegacyCasePrompt = false` + `caseAddendum` 默认空。

**切换存量租户:** 当前实际仅 `default` org + 即将上的第 2 租户，量极小。提供 Console 一个"迁移到 base+append"动作（或人工 review）：把该 config 的 `useLegacyCasePrompt` 置 `false`，并引导运营把原 `systemPrompt` 里**非 core 重复**的部分手填进 `caseAddendum`。**绝不自动把整段 systemPrompt 塞进 addendum**（会与 core 重复）。

---

## 6. 文件级改动清单

| 文件 | 改动 |
|---|---|
| `packages/shared/prisma/schema.prisma` | +`caseAddendum`、+`useLegacyCasePrompt`（migration 0007） |
| `packages/shared/defaults/index.ts` | `CASE_SYSTEM_PROMPT` 标 `@deprecated`（不删）；按 §3 校准 CORE 默认占位符 |
| `lib/agent/buildModePrompt.ts`（**新建**） | 统一组装函数（core / core+addendum+SOP），含 legacy 分支 |
| `app/api/messages/route.ts` | L362-363/636/642/694-695 改调 `buildModePrompt()`；删 `!== DEFAULT_SYSTEM_PROMPT` 脆弱判定 |
| `lib/agent/playground-runner.ts` | L54 不再硬编码 coreSystemPrompt；改调同一 `buildModePrompt()`；补 `resolvePrompt`（修点 3） |
| `lib/agent/loop.ts` | L127 fallback 语义随新模型调整（core 空时用默认而非 case prompt） |
| `lib/agent/conversation-loop.ts` / `stage-executor.ts` | 与新组装对齐（stage SOP append 到 core+addendum 之后） |
| `app/admin/agent/page.tsx` | Brain UI 拆 Base + Case Addendum 两区（点 6，与 U3 协同） |
| `app/api/admin/agent/route.ts` | 新建默认 `useLegacyCasePrompt=false`、`caseAddendum` 读写 |
| `packages/shared/prisma/seed.ts` | seed 走新模型 |
| sub-agent.ts / orchestrator.ts | **Phase 1 不改**（标注 Phase 2 迁移） |

---

## 7. 守卫测试清单（red→green，驱动真实入口，禁 seam）

1. **发现模式** = base：无激活工单时，最终 prompt 含 core 内容 + base 占位符已解析，**不含** case_schema/case_state。
2. **工单模式** = base+addendum+SOP：有工单时，最终 prompt 同时含 core 内容、caseAddendum、stage SOP，且 case_* 占位符已解析。
3. **占位符归属**：`{{case_types}}` 只在 base 解析一次；`{{available_tools}}` 不在两边重复。
4. **legacy 兼容**：`useLegacyCasePrompt=true` 的 config 行为与改动前**逐字节一致**（防存量回归）。
5. **playground=生产一致**（修点 3）：同一 config，playground 与 messages 路径的组装结果一致（core 用 DB 值、占位符已解析）。
6. **migration 幂等**：脚本跑两次结果一致；空 coreSystemPrompt 被正确填默认。

---

## 8. 分期与风险

- **Phase 1（本批）:** 主 agent core↔case 改 base+append + 修 playground bug(点3) + UI 拆分 + migration（带 legacy 保护）。sub-agent/orchestrator 不动。
- **Phase 2（后续）:** sub-agent/orchestrator 迁 base+append；存量租户全部切 `useLegacyCasePrompt=false`；删 `CASE_SYSTEM_PROMPT` 与 `systemPrompt` 列（migration 0008）。
- **最大风险:** 存量 config 行为漂移 → 由 `useLegacyCasePrompt` 默认 `true` + 测试 4 兜底。**Phase 2 前严禁删 `systemPrompt` 列**（sub-agent 仍依赖）。

**回执（铁律）:** 每阶段 `tsc` / `npm test` / `build:console` + migration 验证 + §7 守卫测试 red→green 输出 + UI 中英截图。
