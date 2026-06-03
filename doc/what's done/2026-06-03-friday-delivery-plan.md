# 周五交付计划 — 主协调文件（并行双 Agent）

**创建:** 2026-06-03 | **分支:** `main` @ `d1d5bf3` | **目标:** 周五交付可供内部大规模测试的版本
**架构定稿人:** 把关架构师 | **执行:** 两个 coding agent 并行（Lane A / Lane B）

> 本文件是周五交付的**唯一叙事 + 并行协调规则**。具体任务在两个车道文件里：
> - [`2026-06-03-lane-A-agent-playground.md`](./2026-06-03-lane-A-agent-playground.md) — Agent 配置 + Playground
> - [`2026-06-03-lane-B-nav-integrations.md`](./2026-06-03-lane-B-nav-integrations.md) — 导航 + 集成 + i18n
>
> 完成后按铁律移到 `doc/what's done/` 并翻 `MASTER_BUILD_HANDOFF.md`。

---

## 0. 唯一叙事（所有代码与文案必须遵守）

> **一个 Agent = 一个名字 + 多个版本，其中恰好一个是 active。**
> **对外集成（LiveChat / API）默认指向 Agent 本身，即它的 active 版本。**
> **版本（fork / draft / activate）是"安全迭代"机制：先 fork → Playground 测 → activate，集成自动切过去。**

落地口径（已据源码核实）：
- **LiveChat** = 名称/active 级。`webhook/[orgId]/[agentName]/route.ts:32` → `where: { name, isActive: true }`。**保持现状**，文案写明"指向 Agent，自动使用当前 active 版本"。
- **API Key** = 默认绑 Agent 的 active 版本；"pin 死某具体版本"（`ApiKey.agentConfigId`）降级为**高级选项**，文案标注"调试/灰度用，会无视 active"。
- **Playground** = 版本沙盒。UI 标题点明"正在测试 vN（draft/active）"。

> **决策记录（用户已拍板 2026-06-03）：** LiveChat 统一到名称/active；周五目标深度=全量打磨（P0+P1 全做）；配置人员语言=中文为主。

---

## 1. 并行车道划分（按"文件所有权"切，保证零合并冲突）

| 文件 | 所有者 | 说明 |
|---|---|---|
| `app/admin/playground/page.tsx` | **Lane A** | T1 T2 |
| `app/admin/agent/page.tsx` | **Lane A** | T4 T6 T5-A |
| `components/console-sidebar.tsx` | **Lane B** | T3 |
| `app/admin/channels/livechat/page.tsx` | **Lane B** | T7 T8 T5-B |
| `app/admin/api-keys/page.tsx` | **Lane B** | T7 |
| `app/api/livechat/groups/route.ts` | **Lane B** | T8（如需回传错误细节） |
| **`lib/i18n/dictionaries.ts`** | **Lane B（单写者）** | 见 §2，**Lane A 禁止写入** |

**任务分配：**
- **Lane A：** T1、T2、T4、T6、T5-A
- **Lane B：** T0（i18n 注册，最先做）、T3、T7、T8、T5-B

---

## 2. 🚨 头号并行风险：`lib/i18n/dictionaries.ts` 单文件冲突

`dictionaries.ts` 是 2351 行的**单文件扁平字典**（`en` + `zh` 两个对象）。两个 agent 同时加 key 必然 merge 冲突。

**规则（铁律级）：**
1. **只有 Lane B 能编辑 `dictionaries.ts`。**
2. Lane B 的 **T0** 先把下方"全量 key 注册表"**一次性**加入 `en` 和 `zh`（两个车道的 key 都在内），并提交。
3. Lane A 只 `t('key')` **消费**，绝不碰字典文件。T0 落地前，Lane A 的 UI 会短暂显示原始 key 字符串——dev 下无害，T0 ~20 分钟内落地即可。

### 全量 key 注册表（Lane B 的 T0 一次性加入 en + zh）

```
// ── T4 编辑 active 警示（Lane A 消费）──
agent.editActive.warning   en: "You are editing the live ACTIVE version — changes hit LiveChat/API immediately."
                           zh: "你正在修改线上 active 版本，改动会立即影响 LiveChat/API。"
agent.editActive.forkCta   en: "Fork a draft to edit safely"   zh: "Fork 一个 draft 安全修改"
agent.editActive.dismiss   en: "Edit anyway"                    zh: "仍然直接编辑"

// ── T6 上线就绪视图（Lane A 消费）──
agent.readiness.title      en: "Readiness"          zh: "上线就绪"
agent.readiness.configured en: "Configured"         zh: "配置完整"
agent.readiness.active     en: "Active version"     zh: "有 active 版本"
agent.readiness.apiKey     en: "API key bound"      zh: "已绑 API Key"
agent.readiness.livechat   en: "LiveChat connected" zh: "LiveChat 已连通"
agent.readiness.ready      en: "Ready to ship"      zh: "可上线"
agent.readiness.incomplete en: "Incomplete"         zh: "未就绪"

// ── T3 顶部 Agent 切换器（Lane B 自用）──
sidebar.currentAgent       en: "Agent"              zh: "当前 Agent"
sidebar.switchAgent        en: "Switch agent"       zh: "切换 Agent"

// ── T8 LiveChat 连接诊断（Lane B 自用）──
livechat.test.errCredentials en: "Invalid credentials — check License ID / Bot token."  zh: "凭证无效 — 检查 License ID / Bot 令牌。"
livechat.test.errRegion      en: "Region mismatch — token region differs from setting."  zh: "区域不符 — Token 区域与设置不一致。"
livechat.test.errPermission  en: "Permission denied — token lacks required scope."       zh: "权限不足 — Token 缺少所需权限。"
livechat.test.errNetwork     en: "Network error — could not reach LiveChat."             zh: "网络错误 — 无法连接 LiveChat。"
livechat.test.errUnknown     en: "Connection failed — see server logs."                  zh: "连接失败 — 查看服务端日志。"

// ── T7 把 livechat 本地 L 字典 + api-keys 硬编码并入 t() ──
// livechat/page.tsx 的本地 `L` 已是 en+zh，机械迁移到 livechat.* 命名空间即可。
// api-keys/page.tsx 大量硬编码英文（"New Key" / "Bind to Agent Config" / 整段 tutorial），
// 以 apiKeys.* 命名空间补齐中文。详见 Lane B 文件 T7。
```

---

## 3. T5 保存语义统一 —— 用"约定"而非共享组件（避免跨车道耦合）

周五时间紧，**优先解耦而非 DRY**：不抽共享组件（那会让两个车道都改同一新文件）。两条车道各自在自己的页面实现**同一套 UX 约定**：

**保存 UX 约定（标准）：**
- 顶部或底部固定一致的状态区，四态：`未保存改动` / `保存中…` / `已保存 ✓` / `保存失败 ✗`。
- 有未保存改动时离开页面给提示（`beforeunload` 或路由守卫，二选一，保持简单）。
- "重置"按钮回到上次已保存状态。

- **T5-A**（Lane A）：`agent/page.tsx` 现在是 auto-sync，补齐显式四态反馈。
- **T5-B**（Lane B）：`livechat/page.tsx` 已有 Save/Reset，对齐到同一文案与四态。

> P2（周五后）：再抽 `<SaveBar>` 共享组件去重。本周不做。

---

## 4. 跨车道接口契约（防止运行时互相打架）

1. **`AgentVersionPicker` 公共 props 不可破坏**：Lane A 的 playground 依赖它。Lane B 的 T3 若复用它放进 sidebar，**保持现有 props API 不变**（建议直接复用，不改组件内部）。
2. **`localStorage['intera-agent-id']` 是共享契约**：sidebar 与 playground 都读它选 Agent。T3 切换器写入后必须沿用同一 key，保证跨页一致。（同标签页内已打开的 playground 不会热刷新——周五可接受，记为已知限制。）
3. **T6 就绪视图只读现有接口**（`/api/admin/agent-configs`、`/api/admin/api-keys`、`/api/livechat/config`），**纯前端聚合，不新增后端路由**，避免碰 Lane B 的 API 文件。

---

## 5. 排期与验收闸门

**Day 1（今天/明天）— P0：** Lane A 做 T1/T2/T3前置无关 → 实为 T1 T2；Lane B 先 T0（i18n 注册）再 T3。两者并行无冲突。
**Day 2 — P1：** Lane A T4 T6 T5-A；Lane B T7 T8 T5-B。
**Day 3 / 周五上午 — 收尾：**

- **全流程走查（中文身份）**：建 Agent → 配置 → fork → Playground 测 → activate → 绑 Key → 连 LiveChat → 发真消息。录屏。
- **回归 + 部署**：`npx tsc --noEmit -p apps/console/tsconfig.json` + `npm test` + `npm run build:console` 全绿；本地全验证后**一次** `git push deploy main`；跑 `MASTER_BUILD_HANDOFF.md` 的 C1 回归 curl。
- **更新 handoff**：翻 TODO-37/38；任务移 `what's done/`；主 handoff 不撒谎。

## 6. 每个任务的回执要求（铁律）

1. 改动文件清单 + `tsc` / `npm test` / `build:console` 输出。
2. UI 任务附截图（中文 + 英文各一）。
3. 涉及跨 org 数据读取（T6）走 e2e red→green 守卫测试，不许 mock 充数。
4. 本周**不要碰** `loop.ts` 拆解（TODO-17）。
