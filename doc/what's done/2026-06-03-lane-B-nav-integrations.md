# Lane B — 导航 + 集成 + i18n

**创建:** 2026-06-03 | **分支:** `main` @ `d1d5bf3` | **执行 agent:** Lane B（与 Lane A 并行）
**协调规则见:** [`2026-06-03-friday-delivery-plan.md`](./2026-06-03-friday-delivery-plan.md)

> **车道边界（务必遵守）：** 你拥有 `components/console-sidebar.tsx`、`app/admin/channels/livechat/page.tsx`、
> `app/admin/api-keys/page.tsx`、`app/api/livechat/groups/route.ts`，以及 **`lib/i18n/dictionaries.ts`（你是唯一写者）**。
> **不要改 `app/admin/playground/page.tsx` 和 `app/admin/agent/page.tsx`**（Lane A 所有）。

---

## T0 · i18n 全量 key 注册（**最先做，~20 分钟**）🔴 前置

**为什么先做:** 字典是单文件，你是唯一写者。先把**两个车道**的新 key 一次性加好，Lane A 才能消费、避免后续冲突。

**做法:** 把主计划 [§2 全量 key 注册表](./2026-06-03-friday-delivery-plan.md) 的所有 key **一次性**加入 `lib/i18n/dictionaries.ts` 的 `en` 和 `zh` 两个对象（含 `agent.editActive.*`、`agent.readiness.*`、`sidebar.currentAgent/switchAgent`、`livechat.test.err*`）。立即提交，告知 Lane A 可消费。

**验收:** `tsc` 通过；en/zh 两边 key 数量一致；切换语言无缺失。

---

## T3 · Agent 入口提到一级（侧边栏顶部）🔴 P0

**现状:** 建/切/改 Agent 埋在 `console-sidebar.tsx:324` —— 头像菜单 → "Organization · Agent" → 抽屉。发现性差。

**做法:**
- 把 Agent 切换器提到侧边栏**顶部 logo 下方常驻可见**：一眼能切 Agent + 看到当前 active/draft 状态。
- **优先直接复用 `AgentVersionPicker`**（`components/admin/agent-version-picker.tsx`），**不改其内部、不动其 props**（Lane A 的 playground 依赖它）。
- 切换写入 `localStorage['intera-agent-id']`（沿用现有 key，见主计划 §4 契约），保证与 playground 跨页一致。
- 头像菜单只保留账号/组织切换/语言/登出；`AgentManagementDrawer`（建/改名/删 Agent）入口保留但从"主路径"降级，顶部切换器成为主路径。
- 文案用 `sidebar.currentAgent` / `sidebar.switchAgent`。

**验收:**
1. 不展开任何菜单即可切换 Agent；当前 Agent + 版本状态在顶部清晰可见。
2. 顶部切换后，进入 `/admin/playground` 选中的 Agent 一致（localStorage 同步）。
3. `AgentVersionPicker` 在 playground 仍正常（未被破坏）。
4. 截图（中英 + 折叠/展开态）。

---

## T7 · i18n 断层补齐（中文为主）P1

**现状:** `livechat/page.tsx` 用本地 `L` 字典（已 en+zh）；`api-keys/page.tsx` 大量硬编码英文（"New Key"、"Bind to Agent Config"、"How to use API keys" 整段 tutorial 等）。中文配置同事看到混合语言。

**做法:**
- **livechat:** 把本地 `L` 字典机械迁移到 `dictionaries.ts` 的 `livechat.*` 命名空间，页面改用 `t()`。删除本地 `L` 与 `useL`。
- **api-keys:** 用 `apiKeys.*` 命名空间补齐所有硬编码英文的中文翻译（标题、副标题、表单标签、按钮、空态、tutorial、tip），页面改用 `t()`。
- 以**中文为默认体验**校对全流程文案，术语统一：Agent / 版本 / active / 草稿(draft) 等与现有 `agentVersion.*` 一致。
- 所有字典写入仍在你这唯一写者范围内。

**验收:**
1. 全程切中文 → livechat 与 api-keys **无英文残留**。
2. 切英文 → 无中文残留、无缺 key。
3. 截图（两页 × 中英）。

---

## T8 · LiveChat 连接诊断 P1

**现状:** `livechat/page.tsx:159` `testConnection` 只看 `/api/livechat/groups` 是否 200，失败仅显示 failed，无法定位。

**做法:**
- 后端 `app/api/livechat/groups/route.ts`：失败时回传可区分的错误类别（凭证无效 / 区域不符 / 权限不足 / 网络 / 未知），例如 `{ error, code }`。
- 前端 `testConnection`：根据返回 code 映射到 `livechat.test.err*` 文案，展示具体指向而非泛化 failed。

**验收:**
1. 故意填错 Bot token → 提示"凭证无效"。
2. 区域不符 / 权限不足 → 各自对应提示（能造出的场景尽量造，造不出的至少代码路径覆盖）。
3. 截图 + 简述各错误码触发条件。

---

## T5-B · 保存语义对齐（livechat 页）P1

**现状:** `livechat/page.tsx` 已有 Save/Reset + saveStatus，基本符合，但需与 Lane A 的 agent 页对齐到**同一套四态约定**（见主计划 §3）。

**做法:** 对齐文案与四态（`未保存改动 / 保存中… / 已保存 ✓ / 保存失败 ✗`）；有未保存改动离开给提示。**不抽共享组件**（周五后做）。

**验收:** 改配置 → 四态流转一致；未保存离开有提示；截图。

---

## Lane B 完成回执（全部任务做完后）

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # db-integration 失败是已知 PostgreSQL 问题，其余绿
npm run build:console                             # success
```
+ 改动文件清单 + 各任务截图（中英）。
完成后通知架构师 review，再由架构师统一翻 `MASTER_BUILD_HANDOFF.md`。
