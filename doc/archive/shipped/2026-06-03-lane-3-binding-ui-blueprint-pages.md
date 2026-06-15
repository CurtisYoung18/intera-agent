> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Lane 3 · 绑定 UI + 放射图只读 + model/memory 独立页

**来源：** [`doc/plans/2026-06-03-version-bound-config-blueprint-redesign.md`](../plans/2026-06-03-version-bound-config-blueprint-redesign.md) §3、§5
**风险：** 中
**依赖：** **Lane 1 步骤 0（`CapabilityBindings` 契约）冻结后开工**；绑定读写依赖 Lane 1 的字段与 API。

---

## 目标

实现 C 信息架构：库页加绑定列（绑给侧边栏选中版本）；放射图退为只读健康盘；大脑/记忆升独立页。

---

## 步骤

### 1. 版本上下文（解决"绑给哪个版本"歧义）
- **复用现有全局 `AgentVersionPicker`**（[`components/admin/agent-version-picker.tsx`]，T3 已常驻侧边栏 + localStorage 与 playground 同步）。
- 每个库页 + model/memory 页顶部加窄**版本上下文条**："正在编排：客服Agent · v3（草稿）"，读上述 picker 的选中值，点击=切版本。
- **防误改线上**：选中版本若 `isActive`，绑定/编辑动作触发 T4 那套"一键 fork 到草稿"警告（[`agent/page.tsx`] 已有该逻辑，平移复用），不直接改线上。

### 2. 库页绑定列（三态）
四个库页（guardrails/tools/case-types/knowledge）每个库项加绑定控件，对"当前选中版本"：
- ✓ 已绑定 / ＋ 未绑定（点击=加入版本 `capabilityBindings`） / ⚠ drift。
- 附"另被 N 个版本绑定"。
- 写入：PUT 当前版本的 `capabilityBindings`（API 见 Lane 1）。

### 3. 新建 `/admin/model` 页（大脑，内在配置）
- 从 [`agent/page.tsx`] brain drawer section（约 :538-808）**平移**：model / temperature / coreSystemPrompt / caseAddendum / thinkingBudget / maxIterations / showThinking / maxOutputTokens / resumePrompt / debugMode / invariantCheck / 子代理生成。
- 编辑当前选中版本的 `AgentConfig` 列；挂版本上下文条 + T4 守护。

### 4. 新建 `/admin/memory` 页（记忆，内在配置）
- 从 [`agent/page.tsx`] memory drawer section（约 :812-1040）**平移**：memoryStrategy 全部阈值与策略。
- 同样挂版本上下文条 + T4 守护。

### 5. 放射图改只读健康盘 [`components/admin/agent-blueprint.tsx`]
- 6 节点（大脑/记忆/护栏/工具/案例/知识库）全显示选中版本绑定项的**数量 + 健康度 + drift⚠ 计数**（用 Lane 1 `resolveBindings`）。
- 点击节点 → 跳对应页（内在→model/memory 页；能力→对应库页并定位），**不再就地编辑**。
- `agent/page.tsx` 移除内联 drawer 编辑逻辑（搬去 model/memory 页后），大幅瘦身。
- 保留现有动画/连线/呼吸效果。

### 6. 侧边栏导航
- `console-sidebar.tsx` 加 `/admin/model`、`/admin/memory` 入口（或归入 agent 配置分组）。

---

## 验收

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # 全绿
npm run build:console                             # success
```
- UI 截图：绑定列三态、放射图只读盘 + drift、model/memory 页、版本上下文条切换。
- **跨版本隔离验证**：切版本 → 绑定列/放射图随之变；给 v1 绑、切 v2 不受影响。
- i18n：新文案 en+zh。
- 完成后移本文件到 `doc/what's done/`，更新 `MASTER_BUILD_HANDOFF.md`。
