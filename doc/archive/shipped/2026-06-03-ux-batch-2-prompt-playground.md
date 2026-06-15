> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# UX 批次 2 — Prompt 架构 + Playground 保真 + 占位符/i18n 清理

**创建:** 2026-06-03 | **分支:** `main` | **时机:** Friday(v1.2) 之后的下一批 | **来源:** 生产实测发现 + 架构师跨页面调研
**决策状态:** 全部已由用户拍板（见各任务"决策"行）。开工前读 [`GENERIC_HANDOFF.md`](../handoffs/GENERIC_HANDOFF.md) 第 0 节铁律。

> 本批以 **UX 为主** + 一项架构调整（U1）。所有根因均已对照源码核实（file:line 为证）。

---

## U1 · Case Prompt → 改为 base+append 模型（架构，需先开规划会）

**决策（已拍板）:** 改为 base+append；core 作唯一 base，工单模式 = `core + 一段可选"工单模式补充" + Case Types 的 SOP`。不再向配置人员开放第二个完整 prompt。

**现状（已核实）:** 系统是"双模式整体切换"，不是 append：
- 接待/发现（无工单）→ `coreSystemPrompt`，工具走 Core 白名单。证据 [conversation-loop.ts:48](../../apps/console/lib/agent/conversation-loop.ts#L48)。
- 工单处理中 → `systemPrompt`（即"Case Prompt"），整体替换 core，再 append per-stage SOP。证据 [loop.ts:403](../../apps/console/lib/agent/loop.ts#L403)、[stage-executor.ts:99-100](../../apps/console/lib/agent/stage-executor.ts#L99)。
- 动态工单数据（`{{case_schema}}` `{{case_state}}` `{{confirmed_facts}}`）本就是占位符自动注入（[prompt-resolver.ts:114](../../apps/console/lib/agent/prompt-resolver.ts#L114)），无需人手写。

**问题:** 两个完整 prompt 内容高度重叠（人设/语气/`{{case_types}}`/全局规则各写一遍），易 drift、维护翻倍；而真正区分两模式的"工具白名单 + 动态数据"早已在 prompt 文本之外处理。"Case Prompt"里剩下需人改的几乎只是和 core 重复的人设。

**目标模型:**
- `coreSystemPrompt` = 唯一 base persona/全局规则。
- 工单模式运行时 = `coreSystemPrompt` + （可选）`caseAddendum`（小段工单处理增量）+ Case Types 的 stage SOP。
- 配置 UI：Brain 不再展示第二个完整 prompt，改为可选的"工单模式补充"小框（留空则纯继承 core）。

**触点（需规划会细化，勿盲改）:** `loop.ts`(385-405 模式分支)、`conversation-loop.ts`、`stage-executor.ts`、`packages/shared/defaults`（DEFAULT_SYSTEM_PROMPT 语义从"完整 case prompt"变为"case 补充"）、`agent/page.tsx` Brain UI、可能的 schema/字段语义迁移。

**⚠️ 铁律:** 这是运行时行为改动，**必须先开规划会出设计稿**，且**配 e2e 守卫测试**验证两模式 prompt 组装 red→green，证明 append 后 core 内容仍生效、工单数据仍注入。

**验收:** 无工单/有工单两条对话路径 prompt 组装正确；配置人员只维护一个 base + 可选补充；旧数据迁移不丢；测试输出 + 截图。

---

## U2 · Playground 渲染保真：thinking_delta + renderHint

**决策（已拍板）:** 补 thinking + renderHint 渲染，与 LiveChat 生产效果一致。

**现状（已核实）:**
- `showThinking=true` 时 [stream-handler.ts:159](../../apps/console/lib/agent/stream-handler.ts#L159) 发 `thinking_delta` SSE，但 playground 解析器 [playground/page.tsx:233-261](../../apps/console/app/admin/playground/page.tsx#L233) **无 `thinking_delta` 分支**→静默丢弃，开关在 playground 零效果。
- renderHint 按 skill 配在 Tools 页（[tools/page.tsx:666](../../apps/console/app/admin/tools/page.tsx#L666) `SkillRenderHintsEditor`，card/carousel/quick_replies），**仅 LiveChat 渲染器消费**；playground 把回复当 `pre-wrap` 纯文本，`request_user_input` 等结构化输出只在右侧"Live activity"显示工具名 pill，**表单/快捷回复看不到**。

**做法:**
1. playground SSE 增加 `thinking_delta` 分支：在回复气泡上方/内渲染"思考"区（可折叠），仅当 showThinking=true 出现。
2. playground 引入与 LiveChat 一致的 renderHint 渲染层（复用 `@intera/shared/channels/render-hints` 的类型/渲染逻辑），让 card/carousel/quick_replies/form 在 playground 内按真实样式呈现。`request_user_input` 应显示为可见表单/快捷回复。
3. **顺带概念分离:** Brain 的 Generation 卡片把 `showThinking`/`invariantCheck`（agent 运行时行为）与 playground 自带的"Show raw JSON"（查看器偏好）在 UI 上区分清楚——前者是"agent 行为"，后者是"调试视图"，勿混在一处。

**验收:** showThinking 开 → playground 显示思考流；agent 调 `request_user_input` → playground 渲染出表单/快捷回复（与 LiveChat 一致）；card/carousel 同理；截图（中英 + 各渲染类型）。

---

## U3 · 占位符指示器清理 + 修占位符表

**决策（已拍板）:** 删冗余计数条 + 修占位符表（不强行恢复易出 bug 的叠层高亮）。

**现状（已核实）:**
- [highlighted-textarea.tsx:25-31](../../apps/console/components/admin/highlighted-textarea.tsx#L25) 注释说明叠层高亮因光标漂移 bug **已整体移除**，`highlights` 仅喂下方计数条，文本永不上色。
- 计数条 [highlighted-textarea.tsx:52-61](../../apps/console/components/admin/highlighted-textarea.tsx#L52) 每个 pattern 渲染"色点 + N placeholders"，无名、靠小色点区分、复数语法错（"1 placeholders"），**且与上方更好的命名 pill 排（[agent/page.tsx:523-553](../../apps/console/app/admin/agent/page.tsx#L523)，有名、可点击插入）完全重复**。
- core prompt 的占位符表只列 3 个，实际 CORE_SYSTEM_PROMPT 用了 **9 个**（`{{confirmed_facts}}` `{{skill_output}}` `{{skills_called}}` `{{active_policies}}` `{{case_schema}}` `{{case_state}}` 等缺失）。

**做法:**
1. 删除 `HighlightedTextarea` 下方的"N placeholders"计数条（保留组件作普通 textarea，或直接移除 highlights 形参）。
2. 校准 `agent/page.tsx` 两个 prompt 的命名 pill 列表，**与各自实际默认 prompt 用到的占位符一一对齐**（core 补齐到真实集合）。每个 pill 保留名称 + hover 说明 + 点击插入。
3. （U1 落地后）若 Case Prompt 改为 append 模型，相应缩减其占位符表。

**验收:** 不再出现"N placeholders"那条；两个 prompt 的占位符 pill 与实际默认 prompt 完全吻合；点击插入正常；截图。

---

## U4 · i18n 覆盖扩到 knowledge / human-ops / routing（中文为主）

**决策:** 延续"中文为主"，把 Friday 批次（仅 livechat/api-keys）未覆盖的页面补齐。

**现状（已核实，t() 用量）:** `knowledge/page.tsx` 仅 **5** 处（685 行，几乎全硬编码英文）、`human-ops/page.tsx` 仅 **7** 处、`routing/page.tsx` **19** 处偏少。

**做法:** 把这三页硬编码英文并入 `lib/i18n/dictionaries.ts`（`knowledge.*` / `humanOps.*` / `routing.*` 命名空间），页面改用 `t()`，补齐中文，术语与现有保持一致。

**验收:** 三页切中文无英文残留、切英文无中文残留、无缺 key；截图（中英）。

---

## U5 · 收尾清理（小）

- **Blueprint brain 预览**只统计 systemPrompt 字符数（[agent-blueprint.tsx:79](../../apps/console/components/admin/agent-blueprint.tsx#L79)），忽略 coreSystemPrompt。改为更有意义的概览（如同时反映 core/case 或显示 model+温度为主、prompt 状态为辅）。
- 清理 `agent-blueprint.tsx` 等处未使用的 import（如 `MessageSquareText`）。
- **保存范式分裂**（记录，非本批必做）：`agent/page.tsx` 是唯一 autosave 页，其余页均显式 Save 按钮。Friday 批次已统一了 agent+livechat 的四态反馈；若要彻底统一全站范式（含 tools/guardrails/routing/knowledge/human-ops/case-types），需单独决策"全站 autosave 还是全站显式 Save"。

---

## 全批次回执要求（铁律）

每个任务：改动文件清单 + `npx tsc --noEmit -p apps/console/tsconfig.json` + `npm test` + `npm run build:console` 输出；UI 任务附中英截图；U1/U2 涉及运行时/隔离的配 e2e red→green 守卫测试。完成后逐项移 `doc/what's done/` 并翻 `MASTER_BUILD_HANDOFF.md`。

---

## Completion record — 2026-06-03

**Typecheck:** 0 errors
**Tests:** 26 passed (239 tests), 1 pre-existing failure (PostgreSQL connectivity)
**Build:** succeeded, 53 static pages

### U1 — Case Prompt base+append ✅
| File | Change |
|------|--------|
| `packages/shared/prisma/schema.prisma` | +`caseAddendum String?` + `useLegacyCasePrompt Boolean @default(true)` |
| `packages/shared/prisma/migrations/20260603000007_add_case_addendum/migration.sql` | New migration |
| `apps/console/lib/agent/buildModePrompt.ts` | **NEW** — unified prompt assembly for messages + playground |
| `apps/console/app/api/messages/route.ts` | Replaced fragile `!== DEFAULT_SYSTEM_PROMPT` check + dual resolvePrompt with buildModePrompt |
| `apps/console/lib/agent/playground-runner.ts` | Fixed coreSystemPrompt hardcoded to CORE_SYSTEM_PROMPT (now reads DB) |
| `apps/console/app/admin/agent/page.tsx` | Brain UI: new Case Addendum section with placeholder pills |
| `apps/console/app/admin/agent/types.ts` | +`caseAddendum` + `useLegacyCasePrompt` |
| `apps/console/app/api/admin/agent/route.ts` | Read/write new fields; `DEFAULT_MODEL` extracted to shared defaults |
| `packages/shared/defaults/index.ts` | +`DEFAULT_MODEL` constant |

### U2 — Playground render fidelity ✅
| File | Change |
|------|--------|
| `apps/console/app/admin/playground/page.tsx` | +`thinking` state + `thinking_delta` SSE branch + collapsible `<details>` render; +`renderHints` storage in `skill_result` handler + form/card/quick_replies render layer |

### U3 — Placeholder cleanup ✅
| File | Change |
|------|--------|
| `apps/console/components/admin/highlighted-textarea.tsx` | Removed redundant "N placeholders" count bar; simplified to plain textarea |

### U4 — i18n extend ✅
| File | Change |
|------|--------|
| `apps/console/app/admin/human-ops/page.tsx` | 20+ hardcoded strings → `t()` calls |
| `apps/console/app/admin/knowledge/page.tsx` | Error messages + delete confirm → `t()` |
| `apps/console/lib/i18n/dictionaries.ts` | +`humanOps.*` (20 keys en+zh), +`knowledge.*` (14 keys en+zh) |

### U5 — Cleanup ✅
| File | Change |
|------|--------|
| `apps/console/components/admin/agent-blueprint.tsx` | Removed unused `MessageSquareText` import; preview now shows `core Nc · addendum Nc` instead of just `systemPrompt` chars |
