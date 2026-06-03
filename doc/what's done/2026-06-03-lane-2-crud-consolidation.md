# Lane 2 · 库 CRUD 收敛（纯 UI，可最先开工）

**来源：** [`doc/plans/2026-06-03-version-bound-config-blueprint-redesign.md`](../plans/2026-06-03-version-bound-config-blueprint-redesign.md) §4
**风险：** 低（不碰数据/运行时，只用现有 API）。
**依赖：** 无 → **可立即并行开工，最快见效。**

---

## 目标

三个库页（护栏/工具/案例）CRUD 收敛到一个共享骨架；表单优先 + JSON 逃生口；干掉原生 alert/confirm；加反向引用提示。

---

## 共享骨架（三页统一）

1. 列表（卡片）→ 创建/编辑面 → **自定义删除确认弹窗**。
   - 现状：护栏页已有自定义弹窗（[`guardrails/page.tsx:362`](../../apps/console/app/admin/guardrails/page.tsx:362)）；工具页用 `confirm()`（[`tools/page.tsx:145`](../../apps/console/app/admin/tools/page.tsx:145)）、`alert()`（:135,:333 等）；案例页用 `confirm()`（[`case-types/page.tsx:169`](../../apps/console/app/admin/case-types/page.tsx:169)）+ `alert()`。
   - 抽出护栏那套删除确认为共享组件（如 `components/ui/confirm-dialog.tsx`），三页复用。**全面干掉 `alert()`/`confirm()`。**
2. 保存用已有**四态反馈**（Unsaved/Saving…/Saved✓/Failed✗，agent/livechat 页已有 T5 实现，复用其模式）。
3. 每个库项显示**反向引用**（"被 N 个版本绑定"——读各版本 `capabilityBindings`；护栏额外"被规则 X 引用"）。删除前若被引用 → 警告。
4. **表单优先 + JSON 逃生口**：每个 entity 一个可折叠"高级/JSON"模式（把护栏现有 Simple/Advanced 推广到工具、案例）。

> 注：反向引用读 `capabilityBindings` 依赖 Lane 1 的字段。若 Lane 2 先行，反向引用先读 `policyHooks`（护栏）+ 全局 enabled 占位，待 Lane 1 落地再切到统一清单。**此为唯一软依赖，不阻塞其余收敛。**

---

## 各 entity 补丁

### 护栏 [`guardrails/page.tsx`]（最成熟，小修）
- 护栏类型改"反推"为**显式存储字段**：现在 `detectGuardrailType()`（:70）按字段反推，改一个字段会跳类型。改成 `rule` 里存 `guardrailType` 字段，UI 直接读，不再反推。
- 删除确认改用共享组件。

### 工具 [`tools/page.tsx`]（拆超长 modal）
- 把单 modal（:508-739）拆成**分段/步进**：身份(name/mode/desc) → 行为(static 固定响应 | http，按 mode 互斥) → 契约(input/output schema，"从测试推断"提为主按钮) → 富渲染(LiveChat)。
- **统一 mode 命名**：现状矛盾——DB enum `mock`/`http`，UI 显"静态"，`openNew` 给 `mode:'static'`（:181），下拉只有 mock/http/engine_managed（:531）。统一：固定响应一律 `static`，库页/DB/UI 一致；干掉 mock/static 混用。
- 干掉 `alert()`（:135,:145）。
- 系统/channel/kb/special 工具保留只读锁，分组展示不变。

### 案例类型 [`case-types/page.tsx` + `[name]/page.tsx`]（改动最大）
- **干掉双入口**：现在 list→modal（:353）创建后跳 detail page（:145），同一实体两个编辑面。统一为"列表 → 详情页"单一编辑面；"新建"=建草稿后进详情页。
- 基础页 4 个**裸 JSON textarea**（:509-529：stages/requiredFacts/escalateOn/autoCloseConditions）换结构化编辑器：
  - stages：可拖拽**有序 pill** 列表。
  - requiredFacts/escalateOn/autoCloseConditions：chip 列表（复用 `components/ui/chip-input`）。
  - 原始 JSON 收进"高级/JSON"逃生口。
- 干掉 `confirm()`（:169）+ `alert()`。

---

## 验收

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # 全绿
npm run build:console                             # success
```
- UI 改动附浏览器截图（三页 CRUD + 删除确认 + JSON 逃生口）。
- i18n：所有新文案 en+zh 双语（`lib/i18n/dictionaries.ts`）。
- 完成后移本文件到 `doc/what's done/`，更新 `MASTER_BUILD_HANDOFF.md`。
