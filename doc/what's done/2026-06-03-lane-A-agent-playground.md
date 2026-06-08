> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Lane A — Agent 配置 + Playground

**创建:** 2026-06-03 | **分支:** `main` @ `d1d5bf3` | **执行 agent:** Lane A（与 Lane B 并行）
**协调规则见:** [`2026-06-03-friday-delivery-plan.md`](./2026-06-03-friday-delivery-plan.md)

> **车道边界（务必遵守）：** 你只改 `app/admin/playground/page.tsx` 和 `app/admin/agent/page.tsx`。
> **禁止编辑 `lib/i18n/dictionaries.ts`**（Lane B 单写者）。你只 `t('key')` 消费，key 见主计划 §2 注册表。
> **不要改 `components/admin/agent-version-picker.tsx`**（Lane B 的 T3 会复用它，保持其 props 稳定）。

---

## T1 · Playground 回复显示两次 🔴 P0

**根因（已确认）:** `app/admin/playground/page.tsx:269` —— `finally` 块归档到 `chatMessages` 后 `return r`，流式气泡残留。详见 [`2026-06-03-playground-bugs.md` Bug A](./2026-06-03-playground-bugs.md)。

**做法:** 归档后 `return ''` 清空流式气泡。

**验收:**
1. 打开 `/admin/playground`，发任意消息 → Agent 回复**只出现一次**。
2. 发第二条 → 无残留。
3. 截图回执。

---

## T2 · Behavior Trace 不跨轮保留 🔴 P0

**根因（已确认）:** `app/admin/playground/page.tsx:198`（每轮 `setTraces([])` 清空）+ `:253`（`setTraces(t)` 替换而非追加）。详见 [`2026-06-03-playground-bugs.md` Bug B](./2026-06-03-playground-bugs.md)。

**做法:** trace 状态改为按轮索引存储，`traceByTurn: Map<turnIndex, traces[]>`；SSE `trace` 事件**追加到当前轮**；移除每轮的全局清空。渲染时按 message index 对应展示。

**验收:**
1. 连发 3 条消息 → 三轮 trace 各自归位、互不覆盖。
2. 每条 trace 对应正确的 message index。
3. 截图回执（含多轮）。

---

## T5-A · 保存语义统一（agent 页）P1

**现状:** `agent/page.tsx` 是 auto-sync（`syncStatus === 'syncing'`），用户不确定改动是否落库。

**做法:** 按主计划 §3 的"保存 UX 约定"补齐显式四态反馈：`未保存改动 / 保存中… / 已保存 ✓ / 保存失败 ✗`，固定在编辑区顶部或底部。有未保存改动时离开给提示。**不抽共享组件**（周五后再做）。文案用 `t()`，复用现有 key 或必要时把新 key 交给 Lane B 加（不要自己写字典）。

**验收:** 改任意配置 → 明确看到四态流转；改动确实落库（刷新后保留）；截图。

---

## T4 · "正在编辑 active 版本"警示 P1（兑现版本隔离价值）

**位置:** `app/admin/agent/page.tsx` 编辑区头部。

**做法:** 当所选版本 `isActive === true` 时，顶部显示醒目警示条：
- 文案 `t('agent.editActive.warning')`（key 见主计划 §2，由 Lane B 注册）。
- 主操作按钮 `t('agent.editActive.forkCta')` → 直接触发 fork（复用现有 fork 接口 `POST /api/admin/agent-configs/{id}/fork`，fork 后切到新 draft）。
- 次操作 `t('agent.editActive.dismiss')` 关闭警示、继续直接编辑。
- 编辑 draft 版本时**不显示**任何警示。

**验收:**
1. 选中 active 版本 → 出现警示 + 一键 fork 可用（fork 后落到新 draft 并可继续编辑）。
2. 选中 draft → 无警示、无干扰。
3. 截图（中英各一）。

---

## T6 · Agent 上线就绪视图 P1（大规模测试总览）

**位置:** `app/admin/agent/page.tsx` 顶部（建议放在 Agent 标题/版本切换附近）。

**做法（纯前端聚合，禁止新增后端路由）:** 对当前 Agent 展示一行 readiness 勾选，数据来自现有只读接口：
- **配置完整**（`agent.readiness.configured`）：有 prompt + model（从已加载的 config 判断）。
- **有 active 版本**（`agent.readiness.active`）：`/api/admin/agent-configs` 中同名存在 `isActive`。
- **已绑 API Key**（`agent.readiness.apiKey`）：`/api/admin/api-keys` 中有 key 的 `agentConfigId` 指向该 Agent 的任一版本，或存在 org-default key。
- **LiveChat 已连通**（`agent.readiness.livechat`）：`/api/livechat/config?orgId=` 返回 `enabled && licenseId && botAccessToken`（复用 livechat 页的 connState 判断逻辑）。
- 全绿 → `agent.readiness.ready`；否则 `agent.readiness.incomplete` 并标出缺哪项。

key 均见主计划 §2（Lane B 的 T0 注册），你只消费。

**验收:**
1. 一个完整配置的 Agent → 四项全绿、显示"可上线"。
2. 故意缺一项（如撤销 API key）→ 对应项变灰/红、显示"未就绪"并指出缺项。
3. **e2e 守卫测试**：验证 readiness 聚合不会读到其它 org 的 key / livechat 配置（跨 org 隔离），red→green 证据。
4. 截图（中英各一）+ 测试输出。

---

## Lane A 完成回执（全部任务做完后）

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # db-integration 失败是已知 PostgreSQL 问题，其余绿
npm run build:console                             # success
```
+ 改动文件清单 + 各任务截图（中英）+ T6 守卫测试输出。
完成后通知架构师 review，再由架构师统一翻 `MASTER_BUILD_HANDOFF.md`。
