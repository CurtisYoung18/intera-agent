# 合并实施计划：Chat→Console 迁移 + Intera Design System UI 重构

> **本文档定位：** 这是协调两份独立 spec 的「总指挥」文档，供开发人员（coding agent）按序执行。
> 它**不复制**两份原始 spec 的全部细节，而是：
> 1. 给出唯一正确的实施顺序与阶段门禁；
> 2. 列出我 review 后发现的、两份 spec 与代码现状**不符或遗漏**的地方（必须先读）；
> 3. 标注需要人类确认的决策点（标 ⚠️ **需确认**）；
> 4. 给出贯穿两阶段的回归测试 guide 与「完成定义」。
>
> **执行时必须同时打开的原始文档：**
> - 迁移（已完成，已归档）：[doc/what's done/2026-06-01-chat-to-console-migration.md](doc/what's%20done/2026-06-01-chat-to-console-migration.md)
> - UI：[Intera Design System/HANDOFF.md](Intera%20Design%20System/HANDOFF.md)
> - 已完成的前置重构（背景）：[doc/what's done/2026-06-01-case-agent-refactor.md](doc/what's%20done/2026-06-01-case-agent-refactor.md)

---

## 状态（2026-06-01）

| 部分 | 状态 |
|---|---|
| Phase A 迁移（§3）+ §1 偏差修正 | ✅ 已完成（`778c498`） |
| §2.5 鉴权与多租户隔离 | ✅ 已完成（`f968620` + `9899c74`） |
| **Phase B UI（§4）** | ⏳ 待办 —— 见工单 [workorder-local-validation-and-phase-b.md](doc/to-do/2026-06-01-workorder-local-validation-and-phase-b.md) 轨道 B |
| **本地部署演练 + Ubuntu 部署** | ⏳ 待办 —— 见 [deploy-ubuntu.md](doc/to-do/2026-06-01-deploy-ubuntu.md) + 工单轨道 A |

> 本文现作为**参考规格**（决策依据 + Phase B 细节 §4/§B3.1 + 鉴权细节 §2.5）。实际待办的执行入口是**工单** [workorder-local-validation-and-phase-b.md](doc/to-do/2026-06-01-workorder-local-validation-and-phase-b.md)。

---

## 0. 两份变更的关系与执行顺序

```
case-agent-refactor (已完成 c10ead2)
        │  chatId 主键化 / dispatch_case_agent / StageConfigEditor / ChatSession 表 / toolCategory
        ▼
Phase A：Chat → Console 迁移   ←── 必须先做
        │  agent 引擎 + API + livechat + channels 全部进入 apps/console，删除 apps/chat
        ▼
Phase B：Intera Design System UI 重构   ←── 基于迁移后的 console 进行
           InteraLogo / Playground / Docked Preview / Dashboard / 侧边栏重组
```

**为什么迁移必须先行（硬依赖，非偏好）：**

1. HANDOFF §3f 要求新增 `POST /api/admin/playground/run`，该端点要「调用真实 agent pipeline」（intent 分类 → guardrails → knowledge → tools → 生成）。这条 pipeline 的代码在 `apps/chat/lib/agent/`，迁移前 console 内根本没有它，端点无法实现。
2. HANDOFF 写作时 `apps/chat` 仍存在（§1、§2b、§7 多处写「both apps」「globals.css 两个 app」）。迁移会删除 `apps/chat`，所以**先迁移，再做 UI，可避免在即将删除的目录上做无用功**，且 UI 阶段所有「both apps」一律收敛为「仅 console」。
3. 侧边栏重组（HANDOFF §6）和 Playground 导航项（§3a）改的是同一个文件 `apps/console/components/console-sidebar.tsx`，应在 Phase B 一并完成，避免两次改同一文件冲突。

> **结论：严格串行。Phase A 全绿（构建 + 测试 + 回归脚本通过）后才开 Phase B 分支。**

---

## 1. ⚠️ Review 发现：spec 与代码现状的偏差（执行前必读）

我对照了两份 spec 与当前代码库，以下是 spec 写错、写漏或与现状不符的点。**这些是最容易让 coding agent 翻车的地方。**

### 1.1 🔴🔴 迁移 spec 漏了 `/api/messages`，而它是生产客户通道的入口

迁移 spec §2.2.1 的路由清单里**没有** `apps/chat/app/api/messages/route.ts`，但它是 case-agent-refactor（c10ead2）后的主消息入口（SSE 流式），头注释：`// POST /api/messages — Main entry point for user messages`。

**已核实的调用链（生产关键）：**
```
LiveChat webhook → apps/chat/lib/livechat/bridge.ts → fetch(`${INTERNAL_CHAT_API_URL}/api/messages`) → AgentLoop SSE
```
- `bridge.ts:31-33`：`getInternalMessagesUrl()` 用 `process.env.INTERNAL_CHAT_API_URL ?? 'http://localhost:3000'`，**默认指向 chat 的 3000 端口**。
- 迁移会删除 web 前端 `apps/chat/app/chat/use-intera-chat.ts`（`/api/messages` 的另一类调用方）。删除后，**LiveChat 是唯一真实客户通道，且只走 `/api/messages`**。

**因此这是全项目最高风险点：漏搬 `/api/messages` 或漏改 `INTERNAL_CHAT_API_URL`，迁移上线即 LiveChat 全挂。**

**动作（必须全做）：**
- [ ] 搬迁 `messages/route.ts` → `apps/console/app/api/messages/route.ts`
- [ ] 把 `INTERNAL_CHAT_API_URL` 改为 console 自身地址（生产 = console 的内网/同进程地址，本地 = `http://localhost:3001`），并写入 `apps/console/.env.local` 与 Railway 环境变量
- [ ] 回归脚本必须含 `POST /api/messages`（见 §5.2）
- [ ] 上线后第一件事：发一条真实 LiveChat 消息验证端到端通

### 1.1b 迁移会删掉整个 web 客户聊天 UI —— 这是产品决策，非纯技术

迁移 spec §2.7 删除 `app/chat/`、`app/livechat-widget/`、`components/chat/`。这意味着**自建的 web 聊天窗口/嵌入 widget 彻底消失**，迁移后客户只能通过 LiveChat 及其它 channel 接入。
⚠️ **需确认（产品层）**：当前是否有商户在用自建 web widget？若有，迁移即下线该入口。若确认全部走 LiveChat，则没问题。这条要在删除前向业务方确认，不能由 coding agent 默认。

### 1.2 agent 引擎是 54 个文件，不是「40+」；按文件逐个 `cp` 会漏

实测 `apps/chat/lib/agent/` 下有 **54 个文件**，且存在 spec §2.1.5 未列出的目录 `__tests__/baseline/`。
**动作：** 不要照 §2.1 的表逐文件 `cp`，直接 **`cp -r apps/chat/lib/agent apps/console/lib/agent`** 整目录搬迁，再用 `diff -r` 校验文件数一致：
```bash
diff -r apps/chat/lib/agent apps/console/lib/agent   # 期望无输出
find apps/console/lib/agent -type f | wc -l           # 期望 54
```

### 1.3 `apps/console/lib/chat-api.ts` 是迁移前的代理客户端，迁移后要清理

console 当前通过 `apps/console/lib/chat-api.ts` 跨进程调用 chat。迁移 spec 只提到清理 `next.config.js` 的 rewrites 和 `CHAT_API_BASE`，**没提这个文件**。
**动作：** 迁移后审查 `chat-api.ts` 的所有调用点，把跨进程 HTTP 调用改为进程内直接调用（import 迁入的函数），或删除该文件。`grep -rn "chat-api" apps/console` 找全部引用。

### 1.4 `@intera/shared/ui/*` 导入路径**已验证可用**（HANDOFF 假设正确）

`packages/shared/package.json` 的 exports 含 `"./ui/*": "./ui/*.tsx"`。所以 HANDOFF §2a 要求新建的 `packages/shared/ui/intera-logo.tsx` 用 `import InteraLogo from '@intera/shared/ui/intera-logo'` 是对的，无需额外配置。`packages/shared/ui/` 已有 `glass-card.tsx` 等 7 个组件可作风格参考。

### 1.5 `@anthropic-ai/sdk` 与 `zod` 已在 `packages/shared` 依赖中

迁移 spec §2.6 让 console 显式加 `@anthropic-ai/sdk`、`zod`。两者其实已在 `packages/shared/package.json` 的 dependencies 里。npm workspace 通常会 hoist，但**为保险仍按 spec 显式加到 `apps/console/package.json`**（避免 hoist 不稳定导致运行时找不到）。加完跑 `npm ls @anthropic-ai/sdk zod` 确认单一版本。

### 1.6 侧边栏现状：`OPS_ITEMS` / `ADMIN_ITEMS`，label 走 i18n

HANDOFF §6 说「Current: OPS / ADMIN」✅ 正确。但**它没提 label 是 i18n key**：`apps/console/components/console-sidebar.tsx:297-298` 用 `t('sidebar.ops')` / `t('sidebar.admin')`。改成 BUILD/OPERATE 必须同步改 `apps/console/components/locale-provider.tsx`（或对应 i18n 文件）的 key，否则 label 不变或报缺 key。
**动作：** 重组时连带新增/重命名 i18n key（`sidebar.build` / `sidebar.operate`）。

### 1.7 残留的 `admin/sub-agents/page.tsx`（case-agent-refactor 应已废弃）

`apps/console/app/admin/sub-agents/page.tsx` 仍存在，但其导航项在 `console-sidebar.tsx:75` 已被注释（`// Phase A: hidden — merged into Capabilities tab`）。这是 sub-agent 重构留下的孤儿页面。
**动作：** Phase B 做侧边栏重组时，确认该页面是否还需要；若确无引用则删除（`grep -rn "sub-agents" apps/console/app apps/console/components`）。⚠️ **需确认**：是彻底删除还是保留隐藏。

### 1.8 HANDOFF「both apps」一律改写为「仅 console」

迁移后 `apps/chat` 不存在。HANDOFF §1、§2b、§7、§9 中所有「both apps / 两个 globals.css」表述，执行时只对 `apps/console/app/globals.css` 操作。

---

## 2. ⚠️ 决策点与推荐（面向真实生产）

> 全部基于「即将上生产」的前提：**优先降低风险、保护现有客户通道、不污染生产数据、保留可逆性。** 每条都给了核实依据和我的推荐（✅ 推荐 / ❌ 不推荐）。标 🔴 的会显著改变实现方案。

### 决策 1 🔴 —— `/api/messages` 与各 `cases/*` 路由的去留

**核实结论：** `/api/messages` 是 LiveChat 生产通道的唯一入口（§1.1），**必须迁移**。其余运行时路由的真实消费者：
- `cases/[id]/stream`、`cases/[id]/message`（POST 运行时）→ 只被**即将删除的 web 前端** `use-intera-chat.ts` 调用。
- `cases/[id]/messages`(GET 历史)、`cases/[id]/traces`、`cases/[id]/export` → console 运营页在用（`ops/cases/[caseId]/page.tsx`），**保留**。

**✅ 推荐：**
1. `/api/messages` 无条件迁移 + 改 `INTERNAL_CHAT_API_URL`（§1.1 动作清单）。
2. `cases/[id]/stream` 和 `cases/[id]/message` 这两个**运行时**路由：先**照搬不动**（成本低、保命），同时在文件顶部加 `console.warn('[deprecated-runtime-route] ...')` 标记。上线观察一个发布周期，确认零流量后再独立 PR 删除。**生产期不做"删了再看"。**
3. console 已有的 ops 读路由（messages 历史 / traces / export）原样保留。

### 决策 2 🔴 —— 是否把 API 路径重命名为 chatId 优先

**核实结论：** 迁移后唯一的运行时客户调用方是 bridge，它只打 `/api/messages`（路径里根本没有 caseId）。重命名 `cases/{caseId}/stream` 在当前没有任何收益。

**❌ 不推荐现在做。✅ 推荐选「选项 A：只搬不改名」。** 重命名是纯增量风险（要改前端、改 bridge、加重定向），上生产前不碰。等系统在 console 上稳定后，作为独立技术债 PR 再议。

### 决策 3 🔴🔴 —— Playground `/api/admin/playground/run` 的数据与副作用隔离

**这是 UI 阶段最危险的点，比"污染数据"更严重的是副作用。** Playground §3f 要求"Run applicable tools"——而真实业务工具里有 `query_order_status`、`get_latest_withdrawal`、乃至 `create_human_task`/`finalize_case` 这类**会改真实系统状态、会建真实工单、会给运营派真活**的操作。商户在 Playground 点一下就触发真实副作用，生产上不可接受。

**关于"是否给 Playground 单独建隔离 DB"——❌ 不推荐独立 DB。** 理由很关键：Playground 的全部价值是**对着商户的「真实配置」（agent config / skills / guardrails / case types / knowledge）做调试**。独立 DB 要么是空的、要么是过期副本，会让 preview 失真，反而失去意义。正确的隔离轴不是"换一个库"，而是"**读真配置、不落运行时产物、操作类工具 dry-run**"。

**✅ 推荐（三层隔离，全部要做）：**
1. **读**：从真实 DB 读，按已鉴权的 org 作用域读真实配置（这正是 preview 要的）。
2. **写**：默认**不持久化**——trace/消息内存返回即可。若要保留调试历史，单建一张 `PlaygroundRun` 表（带 `orgId` + TTL 定期清理），**绝不写进真实 `Case`/`ChatMemory`/`ActionTrace` 表**，且所有 dashboard/ops 查询不读它。
3. **工具副作用**：`operational` 类工具走 dry-run/mock（`system_info` 类可真实调用，操作类一律不产生外部副作用）。复用已有 `toolCategory` 字段正好区分——见 §2.5 鉴权与隔离一节。

这条**必须在写 `/run` 端点前定方案**，否则返工或出生产事故。

> 补充（你的反馈）：原 chat app 里的工具动画（`spinner-verbs.ts`、`agent-progress-card`、`agent-findings-view`、`interaction-card` 的过渡/进度效果）虽随 `apps/chat` 删除，但**其动画逻辑应抢救进 Playground 的 `TestChat`/`TraceInspector`**，作为 Phase B 的体验增强。删除前先把这些组件的动画实现单独提取留存。已记入 §4 Phase B 任务。

### 决策 4 —— 侧边栏 BUILD/OPERATE：改 label 还是改路由

**✅ 推荐只改显示 label + 分组顺序，物理路径保持 `/admin/*` `/ops/*` 不变。** 改物理路由要加一堆重定向、会废掉已有书签/深链，纯风险无收益。同步改 i18n key（§1.6）即可。

### 决策 5 —— Playground ConfigPanel：只读快照 vs 可写覆盖

**✅ 推荐：只读快照 + 仅本次调用临时覆盖，绝不回写商户真实 config。** 多租户下，商户在 Playground 调 toggle 绝不能意外改到自己的线上 agent。toggle 值随请求体传给 `/run`，端点内临时 override，调用结束即丢弃。

### 决策 6 🔴 —— 删除 `apps/chat` 的切换策略（蓝绿，非"删了再祈祷"）

**核实结论：** `apps/chat` 是**当前的生产应用**。直接 `rm -rf` + 切流是高危操作。

**✅ 推荐蓝绿切换，按序：**
1. console 先**并行部署**（chat 仍在线服务生产）。
2. 打 tag `pre-chat-removal`。
3. 把 LiveChat 的 `INTERNAL_CHAT_API_URL` / webhook 指向 console，**小流量验证**端到端（真实发 LiveChat 消息 → console 处理 → 回复到达）。
4. 观察日志/指标稳定（建议至少一个业务高峰周期）。
5. 确认零异常后再 `rm -rf apps/chat` 并下线 chat service。

回滚靠 webhook 指回 chat + git checkout，数据库零变更（两阶段都不改 schema），秒级可逆。

### 需向业务方确认（非技术）
- 决策 1.1b：是否有商户在用自建 web widget？删除即下线该入口。
- 决策 3 的隔离策略是否满足合规/数据治理要求。

---

## 2.5 🔴🔴 生产前置：多租户隔离与 API 鉴权（上线阻断项，施工级）

> 这一节是上生产的**硬门槛**，独立于 Phase A/B 功能，但必须在「对外开放 API / 多 org 接入」之前完成。建议作为 Phase A 迁移之后、对外放量之前的**独立 PR**（下称「鉴权 PR」）。本节写到可直接施工。

### 2.5.1 现状（逐一核实后的真实情况，含对前文的修正）

| 层 | 现状（已核实） | 风险 |
|---|---|---|
| Console 管理/运营页 + `/api/admin/*`、`/api/ops/*` | cookie 会话：`intera_org_id` + `intera_auth='1'`（`auth.ts` / `auth/login/route.ts`）。`getActiveOrgId()` 从 cookie 读 orgId，缺省回退 `'default'` | 适合浏览器登录；但**这些 API 本身未在每个 handler 校验 cookie**——多数 admin 路由直接信 query/body 里的 `orgId`。需要核查每个 admin 路由是否真的调了 `getActiveOrgId()` |
| 运行时 `/api/messages` | **零鉴权**。`orgId` 直接取自 body（`messages/route.ts:243,293`），仅正则校验格式；**且第 624-629 行用该 orgId `prisma.organization.upsert` 隐式建 org** | 🔴 任何人 POST 任意 `orgId` 即可读写/凭空创建该 org 数据。**最严重的洞** |
| 运行时 `/api/cases`、`/api/coordinate`、`/api/human-tasks`(POST) | 同上，orgId 来自 body/query，无授权校验 | 🔴 同样可越权 |
| LiveChat webhook `/api/livechat/webhook/[orgId]` | ✅ **已有** per-org 校验：`config.webhookSecret` 比对 `body.secret_key`，未配置则拒（`webhook/[orgId]/route.ts:31-39`） | 这条已安全。orgId 虽在 URL，但 secret 与该 org 的 LiveChatConfig 绑定，伪造 orgId 会因 secret 不匹配被拒 |
| `Organization.apiKey` 字段 | schema 已存在（`apiKey String?`）；`/api/admin/customers` 已返回 `hasApiKey`（`customers/route.ts:29,39`） | 字段与 UI 列表半成，但**无生成端点、无校验、无强制** |
| 内置 org | `customers/route.ts:8-11` 自动 seed 两个：`default`(无密码) 和 `api`(密码 `0000`) | `api` org 弱口令，生产前必须改 |
| 数据模型 | 每表 `orgId` + `@@unique([orgId, name])` 复合键 | 多租户就绪，但靠每条查询自觉带 orgId，无强制隔离 |

**结论（修正）：** webhook 已安全；真正裸奔的是 **`/api/messages` 等运行时路由**，外加 admin 路由 orgId 来源未必可信。数据模型已多租户就绪。你的方向（org API key + 接口统一 + 数据各自独立）完全正确，基建已半成（`apiKey` 字段 + `hasApiKey` UI + webhook secret 范式可参照）。

### 2.5.2 核心原则（一条，必须贯彻）

> **`orgId` 永远由「已鉴权的凭证」在服务端推导，绝不信任 body/query 里传入的 orgId。**

落实到代码：运行时路由从 `Authorization: Bearer <key>` 解析出 org；body 里若带 `orgId` 且与解析值不符 → 400 拒绝（而非静默覆盖）。删除 `messages/route.ts` 里「body orgId → upsert org」的隐式建 org 逻辑。

### 2.5.3 数据模型决策：复用 `apiKey` 字段 vs 新建 `ApiKey` 表

⚠️ **这是两阶段里唯一会动 schema 的地方**，影响「零 schema 变更可秒级回滚」前提，需单独评估。两个选项：

**选项 A（起步推荐，零或极小 schema 改动）——一 org 一把 key，复用 `Organization.apiKey`**
- 存 hash：把 `apiKey` 语义改为「sha256(key) 的 hex」（不可逆）。明文仅生成时返回一次。
- 优点：不新增表，回滚面小。缺点：不支持多把 key / 吊销审计 / lastUsedAt。
- 仅当需要存 hash 而非明文时无需改 schema（字段类型不变，只是存的内容变）。

**选项 B（长期，新增 `ApiKey` 表）——支持多把、命名、吊销、审计**
```prisma
model ApiKey {
  id         String    @id @default(cuid())
  orgId      String    @map("org_id")
  name       String                          // "production" / "staging" / 渠道名
  prefix     String                          // 明文前 8 位，便于 UI 识别，如 "intera_sk_live_a1b2"
  hash       String    @unique               // sha256(fullKey)
  lastUsedAt DateTime? @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now())
  @@index([orgId])
  @@map("api_keys")
}
```
> **推荐：起步用选项 A（不阻塞上线），把选项 B 列入紧随其后的迭代。** 二者的鉴权调用面（`resolveOrgFromApiKey`）保持一致，A→B 只换实现不换调用点。

### 2.5.4 鉴权层实现（新建 `apps/console/lib/api-auth.ts`）

```ts
// apps/console/lib/api-auth.ts
import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export const INTERNAL_SECRET_HEADER = 'x-intera-internal'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** 生成新 key：返回明文（只此一次可见）+ 要落库的 hash/prefix。 */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = `intera_sk_live_${crypto.randomUUID().replace(/-/g, '')}`
  return { plaintext: raw, hash: sha256(raw), prefix: raw.slice(0, 20) }
}

/** 从请求解析出已鉴权 orgId；失败返回 null（调用方负责回 401）。 */
export async function resolveOrgFromApiKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const key = auth.slice(7).trim()
  if (!key) return null
  const hash = sha256(key)

  // 选项 A：org.apiKey 存的是 hash
  const org = await prisma.organization.findFirst({ where: { apiKey: hash } })
  return org?.id ?? null

  // 选项 B（启用 ApiKey 表时替换上面两行）：
  // const rec = await prisma.apiKey.findUnique({ where: { hash } })
  // if (!rec || rec.revokedAt) return null
  // await prisma.apiKey.update({ where: { hash }, data: { lastUsedAt: new Date() } }).catch(() => {})
  // return rec.orgId
}

/** 内部服务自调用（bridge → /api/messages 若仍走 HTTP 时用）。 */
export function isTrustedInternalCall(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  return !!secret && req.headers.get(INTERNAL_SECRET_HEADER) === secret
}
```

### 2.5.5 各路由的鉴权策略（施工清单）

| 路由组 | 鉴权方式 | orgId 来源 | 改动点 |
|---|---|---|---|
| `/api/messages`、`/api/coordinate`、`/api/cases`(POST)、`/api/human-tasks`(POST 客户侧) | `resolveOrgFromApiKey` **或** `isTrustedInternalCall`（bridge） | 鉴权结果，**忽略 body.orgId** | 每个 handler 顶部加鉴权 gate；删除 `messages/route.ts:624-629` 的隐式 org upsert |
| `/api/livechat/webhook/[orgId]` 及其它 channel webhook | 维持现有 per-org `webhookSecret`（已安全） | URL path orgId（已被 secret 锁定） | 无需改 |
| `/api/admin/*`、`/api/ops/*` | cookie 会话（`getActiveOrgId()` + 校验 `intera_auth`） | `getActiveOrgId()` | 审查每个路由是否真的用了 `getActiveOrgId()` 而非信 query.orgId；统一改为前者 |
| `/api/admin/playground/run` | cookie 会话 | `getActiveOrgId()` | 配合 §决策 3 的 dry-run 隔离 |
| `/api/auth/*`、`/api/health` | 公开 | — | 无需改 |

**统一 gate 范式（每个运行时 handler 开头）：**
```ts
const orgId = await resolveOrgFromApiKey(request) ??
  (isTrustedInternalCall(request) ? request.headers.get('x-intera-org') : null)
if (!orgId) return new Response('Unauthorized', { status: 401 })
// 之后全程用此 orgId，忽略 body.orgId
```

### 2.5.6 内部 bridge → `/api/messages` 自调用（两个方案）

bridge 现状（`bridge.ts:211-235`）：`fetch(getInternalMessagesUrl(), {POST, body})` → 拿 `response.body` → `parseSSEStream` → `LiveChatRenderer.render`。`getInternalMessagesUrl()` 用 `INTERNAL_CHAT_API_URL ?? 'http://localhost:3000'`。

**方案 1（安全baseline，改动小）——保留 HTTP 自调用，加内部密钥 + 改 URL**
- `bridge.ts` 的 fetch 加头：`headers: { 'Content-Type': 'application/json', [INTERNAL_SECRET_HEADER]: process.env.INTERNAL_API_SECRET, 'x-intera-org': orgId }`
- `INTERNAL_CHAT_API_URL` 改指向 console 自身（生产=同实例地址；本地=`http://localhost:3001`）
- `/api/messages` 的 gate 接受 `isTrustedInternalCall`
- 风险最低，但仍有一跳本地网络往返

**方案 2（推荐优化，迁移后做）——进程内直调，彻底消除内部鉴权与 URL 隐患**
- 把 `messages/route.ts` 的 POST 主体抽成可复用的 async generator：
  ```ts
  // apps/console/lib/agent/run-turn.ts
  export async function* runAgentTurn(input: RunTurnInput): AsyncGenerator<SSEEvent> { ... }
  ```
- `messages/route.ts` 的 POST 改为：鉴权拿 orgId → `for await (const ev of runAgentTurn({...,orgId})) sendEvent(ev)` 包进 ReadableStream（行为不变）
- `bridge.ts` 改为直接 `for await (const ev of runAgentTurn({...,orgId: session.orgId})) renderer.render(ev, ctx)`，删掉 `fetch`/`parseSSEStream`/`getInternalMessagesUrl`/`INTERNAL_CHAT_API_URL`
- 收益：免内部鉴权、省一跳、消除配错 URL 的生产事故面
- ⚠️ 这违反迁移 spec「引擎零业务逻辑修改」原则，**所以放到鉴权 PR 而非迁移 PR**，并需重跑全部 livechat + agent 回归（§5）

> **推荐节奏：迁移 PR 用方案 1（先保命上线）→ 鉴权 PR 内做方案 2（消除技术债）。**

### 2.5.7 Console 端：Key 管理 UI + 生成端点

- **新端点**：
  - `POST /api/admin/api-keys`（cookie 鉴权，orgId 来自会话）：调 `generateApiKey()`，落库 hash/prefix，**响应里返回明文一次**。
  - `DELETE /api/admin/api-keys/[id]`（选项 B）或 `POST /api/admin/api-keys/rotate`（选项 A）：吊销/轮换。
- **UI**：BUILD 组下新增「API & Channels」或在 org 设置页加「API Keys」卡片——生成按钮、明文一次性展示（带复制 + 「关闭后不再显示」警告）、prefix 列表、轮换/吊销。复用 `customers/route.ts` 已有的 `hasApiKey` 字段做状态显示。
- **改弱口令**：`customers/route.ts:10` 内置 `api` org 的密码 `0000` 生产前改为环境变量注入或移除该内置 org。

### 2.5.8 查询层强制 orgId 作用域
- 运行时与运营查询一律显式 `where: { orgId }`。建议加一个轻量 `assertOrgScoped` lint 约定或封装 `scopedFindMany(model, orgId, where)`，code review 把「跨表查询未带 orgId」列为阻断项。
- 重点复查 `messages/route.ts` 内所有 `prisma.*.findMany/findUnique`：确保都带 `resolvedOrgId`（现状大部分已带，但 `case.findUnique({where:{id}})` 这类按主键查的要确认 id 不可跨 org 猜测——caseId 是 cuid，难猜，但越权读仍应在拿到 case 后校验 `case.orgId === orgId`）。

### 2.5.9 与 Playground 的关系
Playground 走 cookie 会话推导 orgId（商户登录态），读真实配置；按 §决策 3 不落运行时产物、操作类工具 dry-run。鉴权层让 Playground 天然只能看到自己 org 的配置——**多租户隔离与 Playground 隔离复用同一套 orgId 作用域机制**。

### 2.5.10 鉴权回归测试（并入 §5）
```bash
# 无 key → 401
check "messages without key → 401" POST /api/messages '{"message":"hi","orgId":"default"}' 401
# 有效 key → 200，且 orgId 来自 key（body 的 orgId 被忽略）
curl -s -H "Authorization: Bearer $ORG_A_KEY" -X POST $BASE/api/messages \
  -d '{"message":"hi","orgId":"org-b"}' | grep -q '"orgId":"org-a"'   # 不应写入 org-b
# 跨 org 越权读 → 拒绝或空
check "org A key reading org B case → 403/404" GET /api/cases/$ORG_B_CASE_ID 403
# 内部密钥自调用（方案 1）→ 200
check "internal call with secret → 200" POST /api/messages '{...}' 200   # 带 x-intera-internal 头
# webhook secret 不匹配 → 401（回归现有行为）
check "webhook wrong secret → 401" POST /api/livechat/webhook/default '{"secret_key":"wrong"}' 401
```

### 2.5.11 ⚠️ 需你确认
- **Key 粒度**：选项 A（一 org 一把、可轮换，零 schema 改动，先上线）还是选项 B（多把 + 吊销审计，需新增 `ApiKey` 表）？建议起步 A。
- **是否接受动 schema**：选 B 会打破「零 schema 变更秒回滚」前提，需确认。
- **放量节奏**：建议「迁移 PR → 鉴权 PR（方案1 + 选项A）→ 才对外放量多 org」。先单 org（`default`）灰度时，运行时路由可临时接受内部密钥，但**对外放量前 org key 校验必须就位**。
- **内置 `api` org 弱口令 `0000`**：生产前改/删，确认处理方式。

---

## 3. Phase A — Chat → Console 迁移

> 详细步骤以 [迁移 spec](doc/to-do/2026-06-01-chat-to-console-migration.md) §七为准。以下是**对该步骤的修订与补丁**，按修订后的顺序执行。

### A0. 准备
- [ ] `git checkout -b migrate/chat-to-console`
- [ ] 先回答 §2 的决策点 1、2、6
- [ ] `cp apps/chat/.env.local apps/console/.env.local`（缺失时），核对 spec §4.2 的环境变量齐全

### A1. 整目录搬迁（用 `cp -r`，勿逐文件）
- [ ] `cp -r apps/chat/lib/agent apps/console/lib/agent` → `diff -r` 校验（见 §1.2）
- [ ] `cp -r apps/chat/lib/livechat apps/console/lib/livechat`
- [ ] `cp -r apps/chat/channels apps/console/channels`
- [ ] `cp apps/chat/lib/utils.ts apps/console/lib/utils.ts`（注意：console 已有 `lib/` 下若干文件，勿覆盖 `auth.ts` / `i18n` 等）
- [ ] 搬迁后：`grep -rn "from '@/" apps/console/lib/agent apps/console/lib/livechat apps/console/channels` 逐一确认 `@/` 指向的文件都已存在于 console 下

### A2. API 路由搬迁（含 §1.1 补丁）
- [ ] 按迁移 spec §2.2.1 搬，**外加 `messages/route.ts`**（§1.1）
- [ ] 处理 4 个冲突点（spec §2.2.2）：`cases/route.ts`（GET 运营列表 + POST 客户创建合一）、`cases/[id]/message`、`human-chat`（按角色区分）、`human-tasks`（共存）
- [ ] 搬入 `admin/config-changed/route.ts`、`composer-assist/*`
- [ ] 每搬一个路由，`grep` 它的 import，修 `@/` 路径

### A3. 清理代理层（§1.3 补丁）
- [ ] 删除 `next.config.js` 的 rewrites + `CHAT_API_BASE`（spec §3.4）
- [ ] 审查并清理 `apps/console/lib/chat-api.ts` 的跨进程调用

### A4. 依赖与构建配置
- [ ] `apps/console/package.json` 加 `@anthropic-ai/sdk`、`zod`（§1.5），`npm install`，`npm ls` 验证单版本
- [ ] 根 `package.json`：移除 `dev:chat` / `build:chat`，`workspaces` 改 `apps/console`（spec §5.1）
- [ ] `railway.json`：build/start 命令路径改 `apps/console`（spec §5.2）
- [ ] `vitest.config.ts`：`@` alias 改 `apps/console`，coverage include 同步（spec §5.3 / §6.2）

### A5. 编译 + 测试门禁
- [ ] `npm run build:console` 零错误（先修所有 TS 报错）
- [ ] `npm test` 全绿
- [ ] `npx vitest run apps/console/lib/agent/__tests__/` 全绿
- [ ] 跑回归脚本（见 §5），全绿

### A6. 删除与收尾
- [ ] **删除前先抢救**：把 `apps/chat/components/chat/` 的工具动画组件（`agent-progress-card.tsx`、`agent-findings-view.tsx`、`interaction-card.tsx`）单独拷到一个暂存位置（如 `doc/salvage/chat-animations/`），供 Phase B B0 复用
- [ ] **仅在 A5 全绿后**：`rm -rf apps/chat`（先按 §2 决策点 6 打 tag）
- [ ] 再次 `npm run build:console` + `npm test`（确认无对 chat 的隐藏依赖）
- [ ] commit + 部署验证（spec §七 Step 10）

**Phase A 完成定义（DoD）：** 构建绿 + 全部测试绿 + §5 回归脚本绿 + 部署后 `/api/health` 200 + 一条完整对话端到端跑通（§5.3）。

---

## 4. Phase B — Intera Design System UI 重构

> 详细以 [HANDOFF.md](Intera%20Design%20System/HANDOFF.md) 为准。以下为修订与执行顺序。**全程只动 `apps/console`**（§1.8）。

### B0. 准备
- [ ] Phase A 已合并/全绿后，`git checkout -b ui/intera-design-system`
- [ ] 浏览器打开 `Intera Design System/ui_kits/console/index.html` 与 `assets/logo-animation.html` 看目标视觉
- [ ] 回答 §2 决策点 3、4、5
- [ ] 注意：`.jsx` 是 Babel 原型，**重写为 TS React 组件**，勿直接拷贝（HANDOFF §9）
- [ ] **抢救 chat app 工具动画**（在 Phase A 删除 `apps/chat` *之前*已提取留存）：把 `components/chat/agent-progress-card.tsx`、`agent-findings-view.tsx`、`interaction-card.tsx`、`lib/spinner-verbs.ts`（已随引擎迁入）的动画/进度过渡逻辑，复用进 B3 的 `TestChat` 响应气泡与 `TraceInspector`。Playground 的「调试体验」就是要重现这些动画。

### B1. InteraLogo 动画（HANDOFF §2，~1-2h，低风险）
- [ ] 新建 `packages/shared/ui/intera-logo.tsx`（导入路径已验证可用，§1.4）
- [ ] CSS 追加到 `apps/console/app/globals.css`（**仅 console**）
- [ ] 替换 `console-sidebar.tsx` 的 wordmark（展开 `size={20}`，收起 `collapsed`）
- [ ] 验证：加载时 "Intera" 展开、收起侧边栏折叠成 "I"

### B2. 侧边栏重组（HANDOFF §6，含 §1.6 / §1.7 补丁）
> **与 B1、B3 改同一文件，建议合并为一个 commit 范围。**
- [ ] `OPS_ITEMS`/`ADMIN_ITEMS` 重组为 BUILD / OPERATE（顺序见 HANDOFF §6）
- [ ] 同步 i18n key（`sidebar.build` / `sidebar.operate`，改 `locale-provider.tsx`）—— §1.6
- [ ] 处理 `admin/sub-agents` 孤儿页面（删或保留隐藏，按决策点 §2.7）—— §1.7
- [ ] 物理路由保持 `/admin/*` `/ops/*` 不变（决策点 §2.4）

### B3. Playground 页面（HANDOFF §3，核心，~1天）
- [ ] 新增导航项 `/admin/playground`（HANDOFF §3a，`FlaskConical` 图标 + NEW badge）
- [ ] 新建页 `apps/console/app/admin/playground/page.tsx`（3 栏：ConfigPanel / TestChat / TraceInspector）
- [ ] 实现三个子组件（用 TS 重写 `screens.jsx` 的对应组件）
- [ ] ConfigPanel 的 toggle 仅临时覆盖本次调用（决策点 §2.5），不回写真实 config
- [ ] CSS 从 `ui_kits/console/playground.css` 拷 `.pg-* .tl-* .cfg-*` 进 globals.css

#### B3.1 🔴 核心难点：`/api/admin/playground/run` 的 trace 阻抗不匹配（施工说明）

**已核实的现状**（决定实现方式，必读）：
- 真实 pipeline 由 `AgentLoop.create(...).run()` 驱动（`messages/route.ts:772`），是**迭代式 tool-use 循环**（可能多轮 skill_called/llm_request、可能 dispatch_case_agent 起后台 case agent），**不是** HANDOFF §3e 想要的「6 个线性阶段」。
- 现有 `TraceWriter`（`trace.ts`）发的是**细粒度事件**：`intent_classify` / `policy_hit` / `skill_called` / `skill_result` / `llm_request_start` / `llm_response` / `stage_eval` …，且：
  - **没有 per-step 耗时（`ms`）** —— `ActionTrace` 表只有 `actionType/title/detail/payload/createdAt`，无 duration。
  - **没有 `status`（ok/warn/block）** —— 需在映射时推导。
- 所以 Playground 的「6 阶段 + ms + status」trace 是一个**新的聚合 + 计时层**，不是对 ActionTrace 的直接读出。HANDOFF §3f「use the real pipeline」与 §3e「6 步结构」之间的鸿沟，就落在这一层。

**✅ 推荐实现（Approach A：真实跑 + 聚合映射，保证 preview 不撒谎）：**
1. **复用真实 pipeline**：`/run` 内用商户真实配置（按会话 orgId）跑一轮 agent。优先依赖 §2.5.6 方案2 抽出的 `runAgentTurn()` generator；若鉴权 PR 尚未做方案2，则在 `/run` 内直接 `AgentLoop.create({... ephemeral})` 跑一轮。
2. **TraceWriter 内存模式**：给 `TraceWriter` 加一个「内存 sink」开关（不 fire-and-forget 写 `prisma.actionTrace`，改推入数组）。playground 用此模式，**零 DB 写入**（满足 §决策 3 不落库）。
3. **计时**：在 pipeline 的关键 phase 边界打 `performance.now()`（intent 分类前后、guardrail 前后、kb 检索前后、每次 tool 执行、每次 LLM 调用），把耗时附到对应 trace 事件。这是**唯一的新增 instrumentation 工作量**。
4. **聚合映射**（细粒度事件 → 6 个 Playground 阶段）：

   | Playground 阶段 (`stage`) | `source` | 由哪些 ActionType 聚合 | `status` 推导 |
   |---|---|---|---|
   | Intent classification | `caseTypes` | `intent_classify` | ok / info |
   | Guardrails | `guardrails` | `policy_hit` | 命中拦截→`block`(red)；命中告警→`warn`；无命中→`ok` |
   | Knowledge retrieval | `knowledge` | `skill_called`/`skill_result` 中 `kb_search_*` | 有结果→ok；空→info；config.knowledge=false→neutral(跳过) |
   | Skills & tools | `tools` | 其余 `skill_called`/`skill_result` | 成功→ok；报错→warn |
   | Stage SOP | `agent` | `stage_eval` | ok/info |
   | Model generation | `agent` | `llm_request_start`/`llm_response` | ok |

5. **dry-run 工具副作用**（§决策 3）：playground 模式下，`operational` 类工具（按 `toolCategory`）走 mock，不产生外部副作用、不建 HumanTask/不 finalize；`system_info` 类可真实调用。复用 case-agent-refactor 已加的 `Skill.toolCategory` 字段。
6. **响应**：组装 `PlaygroundTurnResult { turnId, intent, caseType, reply, blocked, trace: TraceStep[] }`（结构见 HANDOFF §3e）；`json` 字段仅当 `config.debug=true` 时填充原始 payload。
7. **ConfigPanel 覆盖**：`config`（model/persona/memory/knowledge/guardrails/debug）随 body 传入，在 `/run` 内**临时覆盖** `loadAgentConfig(orgId)` 的结果，不写回 DB（§决策 5）。

**❌ 不推荐 Approach B（重写一个线性 mock pipeline）**：会与真实行为漂移，debug 工具一旦撒谎就失去价值。`engine.jsx` 只作 trace **形状**参考，不作实现参考。

**⚠️ 需确认**：6 阶段聚合是否够用？若商户需要看到「dispatch_case_agent 起了后台 case agent」这类多 agent 结构，6 阶段模型表达不了，需要扩展 trace 模型（可后续迭代，MVP 先做 6 阶段单轮）。

### B4. Docked Preview（HANDOFF §4，~2-3h）
- [ ] 在 Agent Config / Guardrails 等配置页 topbar 加 "Test agent" 按钮
- [ ] 右侧 420px 滑入 dock，复用 B3 的 TestChat + TraceInspector（Tab：Chat / Trace）
- [ ] dock 开关状态 per-session 存 localStorage
- [ ] CSS 从 `playground.css` 拷 `.dock .dock-head .dock-scrim`

### B5. Dashboard 重设计（HANDOFF §5，~2h）
- [ ] 改 `apps/console/app/ops/dashboards/page.tsx`（路径已确认存在）
- [ ] 4 指标卡 + 最近工单表 + 渠道健康（参考 `screens2.jsx` 的 `Dashboard`）
- [ ] 数据来源：现有 `/api/ops/dashboard`；若字段不足需扩展该端点（先确认现有返回字段）

**Phase B 完成定义（DoD）：** HANDOFF §8 视觉 QA 清单 8 项全过（**在 Chrome 实测**，backdrop-filter 在部分无头工具会失真）+ `npm run build:console` 绿 + 新增 `/api/admin/playground/run` 有测试覆盖。

---

## 5. 回归测试 Guide（贯穿两阶段）

### 5.1 单元/集成（CI 阻断）
```bash
npm run build:console          # 零 TS 错误
npm test                       # vitest 全绿
npx vitest run apps/console/lib/agent/__tests__/
```

### 5.2 API 回归脚本
迁移 spec §6.5 提供了 `regression-test.sh` 模板。**补充：加入 §1.1 的 `/api/messages` 与 Phase B 的 playground 端点：**
```bash
check "Main message entry" POST /api/messages '{"orgId":"default","userId":"u1","chatId":"c1","message":"测试"}'
check "Playground run" POST /api/admin/playground/run '{"message":"where is my order","config":{"model":"claude-sonnet","persona":"concise","memory":true,"knowledge":true,"debug":false,"guardrails":{"pii":true,"refundPolicy":true,"profanity":true,"escalation":true}}}'
```
其余端点照搬 spec §6.3。

### 5.3 端到端（迁移 spec §6.4 清单为准）
关键不变量复查：
- [ ] SSE 事件类型完整（`stream_request_start`…`finalized`/`escalated`/`error`）
- [ ] tool call ↔ tool result 配对（S1 不变量）
- [ ] `dispatch_case_agent` → case agent 后台运行 → 结果回主对话（case-agent-refactor 行为）
- [ ] 同一 chat 多 case 并行
- [ ] ChatSession（chat 级记忆）+ ChatMemory（case 级）都正确读写
- [ ] LiveChat bridge 正常（chatId = LiveChat external ID）

### 5.4 UI 验证（Phase B）
- HANDOFF §8 的 8 项 QA，**用 preview 工具在真实浏览器跑**（截图存证），勿用纯文本快照判断 glass 效果。
- 重点：改 guardrail toggle 重发消息后 trace 应不同；Debug Mode 开启后出现 JSON payload。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 漏搬 `/api/messages` 导致对话断链 | §1.1，整目录 + 显式补搬，回归脚本含该端点 |
| 逐文件 cp 漏文件 | §1.2 用 `cp -r` + `diff -r` 校验 |
| Playground 污染生产工单数据 | 决策点 §2.3，ephemeral/标记模式，**开工前必须定** |
| `@/` import 解析失败 | 每搬一层立即 grep + build |
| 侧边栏 i18n key 缺失 | §1.6 同步改 locale-provider |
| UI 在无头浏览器误判 glass 失效 | §5.4 真实 Chrome 验证 |

**回滚：** 数据库 Schema 零变更（两阶段都不改 `schema.prisma`），回滚 = `git checkout main` + 重新部署（秒级）。删除 `apps/chat` 前打 tag（决策点 §2.6）。

---

## 7. 建议的提交/PR 切分

| PR | 内容 | 依赖 | 阻断上线？ |
|---|---|---|---|
| **PR #1** | Phase A 迁移（不删 chat）：搬迁 + 配置 + 全绿测试 + bridge 改 `INTERNAL_CHAT_API_URL`（§2.5.6 方案1） | — | — |
| **PR #2** | 蓝绿切换稳定后：删除 `apps/chat` + 清理 `chat-api.ts` / rewrites（删除前先抢救动画，A6） | #1 + 生产验证 | — |
| **PR #3** 🔴 | **鉴权 PR**：`api-auth.ts` + 运行时路由 gate + Key 生成端点/UI + 改弱口令（§2.5）；建议含 bridge 进程内直调（§2.5.6 方案2） | #1 | **🔴 对外放量前必须合并** |
| **PR #4** | （可选，决策 2 选 B 时）API 路径 chatId 优先重命名 | #1 | — |
| **PR #5** | Phase B：InteraLogo + 侧边栏重组（同文件，合并） | #2 | — |
| **PR #6** | Phase B：Playground 页 + `/api/admin/playground/run`（§B3.1） | #2、#3（orgId 作用域 + dry-run 依赖鉴权层） | — |
| **PR #7** | Phase B：Docked Preview + Dashboard | #6 | — |

| **PR #8** | **Human-task 废弃清理**：移除 `human-chat`/`human-tasks` API + Console 人工运营 UI（见 §8） | #2 | — |

**关键顺序**：#1 → 蓝绿验证 → #3（鉴权，对外放量前的硬门槛）→ #2（删 chat）→ Phase B（#5/#6/#7）。每个 PR 独立可构建、可回滚；除 PR #3 可能动 schema（§2.5.3 选项 B）外，其余均零 schema 变更、秒级可回滚。

---

## 8. 后续废弃：Human-task 人工介入功能（2026-06-01 确认）

> **决策来源**：用户确认 — 人工介入（human-chat / human-tasks）功能依赖 chat app 的 web 操作界面。真实商用场景下仅走 LiveChat，LiveChat 平台自有人工接管机制，API 层和 Console UI 的 human-task 功能无消费者。

### 需移除的 API 路由

```
apps/console/app/api/human-chat/route.ts          — 人工咨询 SSE 端点
apps/console/app/api/human-tasks/route.ts          — 人工任务列表/创建
apps/console/app/api/human-tasks/[id]/route.ts     — 人工任务详情
apps/console/app/api/human-tasks/[id]/resolve/route.ts — 人工任务解决
apps/console/app/api/human-tasks/[id]/delete/route.ts — 人工任务删除
```

### 需移除的 Console UI 页面

```
apps/console/app/admin/human-ops/page.tsx          — 人工运营配置页
apps/console/app/ops/human-tasks/*                 — 运营人工任务列表/详情页
apps/console/app/embed/human-tasks/*               — 嵌入人工任务页
```

### 需移除的侧边栏导航项

```
console-sidebar.tsx: Human Tasks（OPERATE 组下）
console-sidebar.tsx: Human Ops（BUILD 组下）
```

### 需移除的引擎模块

```
apps/console/lib/agent/consultation-agent.ts       — ConsultationAgent（仅 human-chat 调用）
```

### 数据库

`HumanTask` 表保留不动（无消费者不影响性能），后续按需清理。

### 注意事项
- `human-chat/route.ts` 已在本次迁移中合并为直接实现（含 ConsultationAgent），后续 PR #8 一并移除
- `human-tasks/[id]/resolve/route.ts` 当前改为调用 console 自身的 `/api/messages`（`'/api/messages'`），移除后该自调用也一并消失
- 此清理**不阻塞上线**，human-task 端点保留无副作用，仅清理技术债
