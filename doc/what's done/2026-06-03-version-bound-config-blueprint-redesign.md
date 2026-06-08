> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# 版本化配置 + 放射图/库页重构方案

**日期：** 2026-06-03 | **角色：** 架构方案（不含逐行实现，交由 coding team 并行施工） | **状态：** 待 coding team 拆 to-do

> 来源：console UI 配置性瓶颈复盘。用户作为产品方拍板 4 个架构决策（见 §1），本文把它们落成可施工的方案与并行分工。
> 关联 handoff：见 [`MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md) 活跃 backlog 引用。

---

## 1. 已锁定的架构决策

| # | 决策点 | 选择 | 含义 |
|---|---|---|---|
| D1 | 护栏/工具/案例"跟版本走"的深度 | **绑定清单** | 定义留在 org 共享库可复用；版本只存一份"选了哪些"的清单。回滚=恢复选择集。改库内容会影响所有引用它的版本（已知取舍）。 |
| D2 | 知识库 | **只做引用绑定** | 语料是 GPTBots 大资产，永不逐版本拷贝。硬约束。 |
| D3 | 信息架构 | **C：库页中心 + 绑定列** | 保留 4 个独立库页（定义增删改，与版本无关）；每页加"绑定列"，绑给侧边栏当前选中版本。 |
| D4 | CRUD 操作者画像 | **混合：表单优先 + JSON 逃生口** | 默认表单/向导主路径；每个 entity 一个可折叠"高级/JSON"模式。 |
| D5 | 大脑/记忆等"内在配置"的编辑位置 | **升独立页，放射图全节点只读** | 新开 `/admin/model`、`/admin/memory`；放射图统一退为只读健康盘。 |
| D6 | 绑定字段是否统一 | **统一进 `capabilityBindings`** | 项目未投产、无迁移成本；移除 `policyHooks` 不对称，四类能力一视同仁走同一清单/装载链路。 |

**核心区分（贯穿全文）：**
- **内在配置（intrinsic）**：每个版本有且只有一份，无库、无"挑选"——`大脑`、`记忆`。编辑它们 = 编辑版本本身。→ D5：独立页。
- **被组装的能力（composed）**：从共享库挑选并绑定——`护栏`、`工具`、`案例类型`、`知识库`。→ D1/D3：库页定义 + 绑定列。

---

## 2. 数据模型 —— 绑定清单（地基，须最先冻结契约）

### 2.1 存储

沿用项目现有 "JSON-on-AgentConfig" 惯例（`memoryStrategy`、`policyHooks` 已是 JSON 字符串列），**不引入 join 表**。

**统一绑定模型（D6，2026-06-03 追加决策）**：项目尚未正式投产 → 没有迁移成本，从长远看**四类能力统一进一个 `capabilityBindings` 清单**，不保留 `policyHooks` 的不对称。

```prisma
model AgentConfig {
  // ... 现有列
  policyHooks        String  // @deprecated → 内容迁入 capabilityBindings.guardrails 后移除
  capabilityBindings String? // 新增：四类能力的统一绑定清单（唯一来源）
}
```

清单形状（冻结此 TS 类型为共享契约）：

```ts
// packages/shared/types/index.ts
export interface CapabilityBindings {
  guardrails: { preTool: string[]; postTool: string[]; preFinalize: string[] } // Policy.name[]（吸收原 policyHooks 结构）
  tools: string[]      // Skill.name[]
  caseTypes: string[]  // CaseType.type[]
  knowledge: string[]  // KnowledgeSource.name[]（仅引用，语料不拷贝）
}
// 缺省：guardrails 三 hook 空数组 + tools/caseTypes/knowledge 空数组；解析失败 fallback 同。
```

- fork 版本时整行被复制 → 绑定**自动跟随**，零额外逻辑。
- 护栏不再特殊：库页绑定列、放射图健康盘、运行时装载对四类一视同仁，走同一 `resolveBindings`。

### 2.2 语义迁移（唯一碰运行时的部分 —— 高风险，须 e2e 守护）

**现状**：`Skill.enabled` / `CaseType.enabled` 是**全局开关**；运行时 `loadAgentConfig` / `SkillRouter` / 意图分类按 "org 下所有 enabled" 加载。

**目标**：改为按 "名字 ∈ 当前版本绑定清单" 加载。
- 全局 `enabled` 列降级语义为"该定义是否还可用 / 软删除"，**逐版本取舍**搬进清单。
- 同理知识库：运行时只为绑定清单内的源生成 `kb_search_*` 工具。

**迁移脚本（行为不变保证）**：为每个现存 `AgentConfig` 版本回填 `capabilityBindings`：
- `guardrails` ← 解析现有 `policyHooks` 直接搬入（结构相同）；搬完后移除 `policyHooks` 列。
- `tools` / `caseTypes` / `knowledge` ← 用当前全局 `enabled` 集合作为初值。
- → 切换当天运行时行为完全不变。

**受影响运行时入口（施工前须逐个 grep 确认）：**
- `apps/console/lib/agent/loop.ts`（skill 装载）
- `apps/console/lib/agent/streaming-tool-executor.ts`（dispatch 白名单）
- **护栏装载链路**（原读 `policyHooks` 处全部改读 `capabilityBindings.guardrails`——施工前 `grep -rn policyHooks`）
- `SkillRouter`（kb_search 生成 + 意图/案例分类）
- `apps/console/lib/agent/config-cache.ts`（缓存键 `orgId::agentId` 已含 agent 维度，确认清单随之缓存/失效）
- 共享 `loadAgentConfig`

### 2.3 漂移检测（共享 helper，UI 与运行时共用）

```ts
// 清单里的名字在库中已不存在 → drift
resolveBindings(bindings, library) => { bound: Item[], missing: string[] }
```

- 库页绑定列、放射图健康盘、运行时装载都调用它。
- 运行时遇到 `missing`：跳过该项 + 写 trace 警告，**不崩**（fail-soft）。

---

## 3. 信息架构 —— C：库页中心 + 绑定列

### 3.1 版本上下文（解决 C 的"绑给哪个版本"歧义）

- **复用已存在的全局 `AgentVersionPicker`**（T3 已常驻侧边栏 + `localStorage` 与 playground 同步）。
- 每个库页 + model/memory 页顶部加一条窄**版本上下文条**："正在编排：客服Agent · v3（草稿）"，点击=切版本。绑定列/编辑面都作用于它。
- **防误改线上**：选中版本若 `isActive`，绑定或编辑动作触发 T4 那套"一键 fork 到草稿"警告，不直接改线上。此守护对 model/memory 页同样适用（从现有 drawer 平移）。

### 3.2 库页绑定列（三态）

每个库项一个绑定控件，对"当前选中版本"：
- ✓ 已绑定当前版本
- ＋ 在库未绑定（点击=加入清单）
- ⚠ 已绑定但 drift（库中定义已删/改名）
- 附"另被 N 个版本绑定"提示，便于删除/改名前评估影响（反向引用，见 §4）。

### 3.3 页面清单

| 路由 | 角色 | 编辑对象 |
|---|---|---|
| `/admin/agent` | 放射图**只读健康盘** + 版本选择器 + readiness pills | 不编辑，只展示 + 跳转 |
| `/admin/model`（新） | 大脑（内在配置） | 当前版本 `AgentConfig` 列 |
| `/admin/memory`（新） | 记忆（内在配置） | 当前版本 `memoryStrategy` |
| `/admin/guardrails` | 护栏库 + 绑定列 | `Policy` 定义 + 版本 `policyHooks` |
| `/admin/tools` | 工具库 + 绑定列 | `Skill` 定义 + 版本绑定 |
| `/admin/case-types` | 案例类型库 + 绑定列 | `CaseType` 定义 + 版本绑定 |
| `/admin/knowledge` | 知识库 + 绑定列 | `KnowledgeSource` + 版本绑定（仅引用） |

**`/admin/model`、`/admin/memory` 的内容**从现有 `agent/page.tsx` 的 brain/memory drawer section 平移：
- model：model / temperature / coreSystemPrompt / caseAddendum / thinkingBudget / maxIterations / showThinking / maxOutputTokens / resumePrompt / debugMode / invariantCheck / 子代理生成。
- memory：memoryStrategy 全部阈值与策略。
- 平移后 `agent/page.tsx` 大幅瘦身（当前 drawer 全内联，文件过大），对代码质量是利好。

---

## 4. CRUD 收敛 —— 一个共享骨架 + 各自补丁

### 4.1 共享骨架（三个库页统一）

1. 列表（卡片）→ 创建/编辑面 → **自定义删除确认弹窗**：干掉所有 `alert()` / `confirm()`（护栏页已有自定义弹窗，推广到 tools / case-types）。
2. 保存用已有**四态反馈**（Unsaved / Saving… / Saved ✓ / Failed ✗，T5 已实现）。
3. 每个库项显示**反向引用**："被 N 个版本绑定 / 被护栏 X 引用"。删除前若被引用 → 警告。
4. **表单优先 + JSON 逃生口**：每个 entity 一个可折叠"高级 / JSON"模式（把护栏现有 Simple/Advanced 推广并补齐到三处）。

### 4.2 各 entity 补丁

**护栏（`guardrails/page.tsx`）** —— 最成熟，小修：
- 把护栏类型从"反推"（`detectGuardrailType` 会因改一个字段而跳类型）改成**显式存储字段**，心智稳定。
- 其余保留。

**工具（`tools/page.tsx`）** —— 超长单 modal 拆成分段/步进：
- 步骤：身份(name/mode/desc) → 行为(static 固定响应 | http，按 mode 互斥) → 契约(输入/输出 schema，"从测试推断"提为主按钮) → 富渲染(LiveChat)。
- **统一 mode 命名**：固定响应统一叫 `static`，干掉现在 static/mock 混用（DB `mock`/`http`、UI 显"静态"、`openNew` 给 `static`、下拉只有 mock/http/engine_managed 的矛盾）。
- 干掉 `alert()` / `confirm()`。
- 系统/channel/kb/special 工具仍只读（保留现有锁），但归类展示更清晰。

**案例类型（`case-types/page.tsx` + `[name]/page.tsx`）** —— 改动最大：
- **干掉双入口**（现在 modal + detail page 编同一实体）→ 统一为"列表 → 详情页"单一编辑面。"新建"=建草稿后进详情页。
- 基础页 4 个**裸 JSON textarea**（stages / requiredFacts / escalateOn / autoCloseConditions）换结构化编辑器：
  - stages：可拖拽**有序 pill** 列表（增删/排序）。
  - requiredFacts / escalateOn / autoCloseConditions：chip 列表。
  - 原始 JSON 收进"高级/JSON"逃生口。
- 干掉 `confirm()`。

---

## 5. 放射图（只读健康盘）

- 显示选中版本的**全部子模块**（大脑/记忆/护栏/工具/案例/知识库）。回答"这个版本是什么"。
- 每节点：名称 + 数量 + 健康度 + drift⚠ 计数。
- 点击任一节点 → 跳到对应页（内在节点→model/memory 页；能力节点→对应库页并定位）。
- 不再承担任何就地编辑（D5）。
- 现有动画/连线/呼吸效果保留；只是去掉抽屉编辑、节点改为跳转。

---

## 6. 并行分工（交 coding team）

### 6.1 先冻结共享契约（阻塞项，第一优先）

1. `CapabilityBindings` TS 类型（§2.1）。
2. `resolveBindings()` helper 签名（§2.3）。
3. 库页绑定 API 形状（读/写当前版本绑定）。

契约定了，下面三 lane 才能并行、零冲突（项目已验证 Lane A/B 并行模式）。

### 6.2 三条 lane

| Lane | 范围 | 依赖 | 风险 |
|---|---|---|---|
| **Lane 1 · 数据 + 运行时**（地基） | 迁移列 `capabilityBindings` + 回填脚本 + 运行时 loader 改造（§2.2）+ `resolveBindings` helper + **e2e 守护测试（红→绿）** | 仅依赖契约 | 高（碰运行时）→ 须最严测试 |
| **Lane 2 · 库 CRUD 收敛** | 共享骨架 + 干掉 alert/confirm + 表单优先/JSON 逃生口 + 三 entity 补丁（§4） | 仅现有 API | 低（纯 UI）→ **可最先并立即见效** |
| **Lane 3 · 绑定 UI + 放射图 + model/memory 页** | 绑定列 + 版本上下文条 + 放射图只读盘 + 新 model/memory 页（平移 §3.3）| Lane 1 契约冻结后 | 中 |

### 6.3 排序建议（项目瓶颈期：先低风险高价值）

1. **Lane 2 立即开工**（不碰数据/运行时，纯改善体验，最快见效）。
2. **Lane 1** 谨慎推进作为地基，配齐 e2e 守护。
3. **Lane 3** 在 Lane 1 契约冻结后跟上。

---

## 7. 验收要求（项目铁律）

每个 to-do 完成须：
- 列改动文件 + 贴验证输出：`npx tsc --noEmit -p apps/console/tsconfig.json` + `npm test` + `npm run build:console`。
- UI 改动附浏览器截图。
- **Lane 1（运行时/隔离改动）必须配 e2e 守护测试，红→绿证明**——驱动真实入口，不算 mock/seam 测试。
- 完成后移 to-do 到 `doc/what's done/`，更新 `MASTER_BUILD_HANDOFF.md`。

---

## 8. 非目标 / Phase 2

- **不做** 绑定清单的"修订钉选"（append-only 定义 + 版本钉死修订）——首期是 L1 选择集，定义可变。回滚恢复"选了哪些"，不逐字节还原定义内容。
- **不做** 知识库语料逐版本拷贝（D2 硬约束）。
- ~~护栏/能力清单字段统一~~ → **已纳入首期**（D6，§2.1）：统一进 `capabilityBindings`，移除 `policyHooks`。
- i18n：所有新 UI 文案 en + zh 双语补齐（沿用现有 dictionaries 模式）。
