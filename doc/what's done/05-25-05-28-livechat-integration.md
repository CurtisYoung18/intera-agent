> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# LiveChat 集成全链路：设计 → 实施 → Bug 修复

> **来源合并**: `livechat-rich-ux.md` + `livechat-rich-ux-design.html` + `livechat-integration-deep.md` + `livechat-01/02/03.md` + `livechat-end-loop-fixes.md` + `livechat-widget-bugs.md` + `livechat-queue-silent-end.md`
> **目标**: LiveChat 集成从"原型可用"提升到"客户能在生产稳定运行"。

---

## 1. 原始设计（05-25）

**架构**: Bridge 模块接收 LiveChat webhooks，调用内部 `POST /api/messages` SSE 端点，翻译 SSE 事件为 LiveChat Bot Agent API 调用。In-Chat App（`/livechat-widget` route）作为 iframe 渲染 Glass Bubble 状态动画、选项列表、翻卡表单。

**三个视图**: StatusTrack（agent 执行状态）、OptionList（模型生成的选项）、FormCard（结构化表单采集）。

**技术栈**: Next.js 14 App Router + Prisma(PostgreSQL) + LiveChat Bot Agent API + LiveChat In-Chat App SDK + Tailwind + Framer Motion。

---

## 2. Agent 账号接管模型（05-28 审计，关键设计修正）

**原方案是 Bot Agent 模式，经审计后确认采用 GPTBots 式「人工 agent 账号被 AI 接管」模型**：

1. **身份**: 用某个人工客服 agent 账号的 **PAT（Personal Access Token）** 鉴权。AI 以该具名 agent 身份回复——客户看到的是客服，不是机器人。
2. **App + webhook**: 建 server-side app（拿 Client Id/Secret 做安装授权），加 **chat webhooks**（非 app webhooks），订阅 `incoming_event` + `incoming_chat`，勾选 `chat_presence_user_ids`。
3. **路由/分组**: AI agent 设为 Group Primary，`accepting_chats`（在线接单）。新会话先路由给 AI agent → AI 成为会话成员 → `send_event` 才能发出。
4. **人工接管**: 人工一旦接手（读 `chat_presence_user_ids` 判断），AI 应停。

**对现状的影响**: 现有代码按"无差别 license webhook + 单 token 直发"使用——不管 agent 接单状态、不读 presence。这正是文字发不出去 + 多 AI 抢答的根源。

---

## 3. 三阶段接管实施（05-28）

### ① 打通纯文字双向消息（P0）

**根因与修复**:

| # | 根因 | 修复 |
|---|------|------|
| RC1 | `send_event` 要求调用方 agent 在 chat 内，但 AI 不管接单状态 | 确保 AI agent `accepting_chats`+Primary；webhook 按 `chat_presence_user_ids` 只处理"我在场"的会话；兜底 `ignore_requester_presence:true` |
| RC0 | region mismatch — API 默认打到 US，但 license 在 EU | `region` 参数从 `api.livechatinc.com` 改为 `api-eu.livechatinc.com` |
| RC3 | webhook 签名验证过严导致丢消息 | 放宽 HMAC 验证容错 |

**关键文件**: `apps/chat/lib/livechat/livechat-api.ts`、`bridge.ts`、`webhook/route.ts`

### ② 多 App 独占与路由（防抢答）

**成因**: (a) LiveChat webhook 按 app 订阅、按 license 广播——同一 license 的 N 个集成都收到 `incoming_event`。(b) Intera 不判断会话归属，对每条消息无脑响应。

**修复**:
- 禁用/卸载其它会发消息的 app
- Webhook handler 读 `chat_presence_user_ids` → 只处理"AI agent 在场"的会话
- 验证 `source.type === 'agent'` → 过滤用户自己的消息
- 加 `routing_status` 检查：当前 AI agent 是否在线接单

### ③ Rich Message / iframe ↔ Skills 联动

**两条渲染通道**（别混）:

| 通道 | 方式 | 适用 |
|------|------|------|
| LiveChat Rich Message API | `send_event(rich_message)` → 卡片/轮播/图片 | 结构化数据展示（order status, KB results） |
| In-Chat App iframe | `send_event(custom)` → iframe 内渲染 | 表单、多步交互、复杂 UI |

**现状**: 渲染管线（renderer → render-skill-by-hint → sendCard/sendCarousel）代码齐，但**"哪个 skill 渲染成什么"这份配置从未填写**——整条 skill↔rich message 链路是断的。iframe 侧能渲染 3 种内置视图，但不能渲染任意 skill 的结构化结果。

**接通的修复**: 配 renderHints（每个 skill 的 LiveChat 渲染配置），让 renderer 按 skill 映射到正确的渲染函数。

---

## 4. Bug 修复记录

### 4.1 Session 并发护栏失效（P0）

**根因**: session `resolved` 闩锁复用后不重置 → 第 2 条消息起并发护栏 + 队列 drain 双双失效。

**修复**:
- `session-store.ts:212` — reset `resolved` flag on new incoming
- `route.ts:754` — ensure queue drain on loop exit  
- `loop.ts:307-331` — 入队消息在 loop 退出前 drain

修复后同一 chat 的并发消息正确入队进同一个 loop，而非起并行 loop。

### 4.2 瞬时错误误转人工（P1）

**根因**: 任意 `escalated`（含瞬时 LLM 错误）→ 永久 `transferred` → 之后所有消息被无视。

**修复**: `loop.ts:528-545` 区分 real escalation vs transient error，仅前者设 transferred 状态。

### 4.3 LiveChat Widget 4 个新 Bug（05-29）

**BUG-A (高)**: 图片上传 media_type 未校验，非图片类型以 `type: 'image'` 发给多模态 API → 报错。

**修复**: bridge 处理附件前判定 MIME，仅 `image/png|jpeg|gif|webp` 构造 image block，否则降级为文本提示。

**BUG-B (中)**: livechat webhook 的 `incoming_event` 对 `event.type === 'message'` 无 `text` 判断 → 图片消息等非文本事件被当作文本空串处理。

**BUG-C (中)**: bridge 处理附件时 `downloadAndEncode` 无超时 → 大文件可能永久阻塞 loop。

**BUG-D (低)**: webhook 路由的 `content_type` 和 `url` 字段命名不一致 → 部分 event shape 下附件丢失。

### 4.4 Queued Message 静默结束（06-01）

**现象**: 用户追加消息后 agent 调了工具并拿到结果，但无文本输出，直接静默结束。下一个用户消息触发后才回复。

**根因**: `loop.ts:322` 的 queued message 注入格式使用 `[SYSTEM]` 包裹，导致模型在 system context 里调完工具后认为对话在"SYSTEM 模式"下不需要输出文本。

**修复**: 将 queued message 注入格式改为 `[USER]` 前缀，或在注入后附加"请用自然语言回答用户"的引导。

---

## 5. 当前架构总览

```
LiveChat (SaaS)
  ┌─────────────┐  POST webhook   ┌────────────────────────────┐
  │ Visitor msg │ ────────────────▶ /api/livechat/webhook       │
  └─────────────┘                  │  (HMAC verify + presence)   │
  ┌─────────────┐                  └──────────┬─────────────────┘
  │ In-chat App │ ────send_event───┐          │ fire-and-forget    │
  │ (iframe)    │  intera_*_submit │          ▼                    │
  └─────────────┘                  ▼  ┌────────────────────────┐  │
       ▲                            │ bridge.handleIncoming   │  │
       │ render() actions           │   ↓ fetch internal SSE  │  │
       │                            │ /api/messages (loop.ts) │  │
  ┌────┴──────────────────────┐    │   ↓ for await SSEEvent  │  │
  │ LiveChat Bot API          │◀───│ LiveChatRenderer        │  │
  │  send_event (message)     │    │ .render(event)          │  │
  │  send_event (rich_message)│    │   → BridgeAction[]      │  │
  │  transfer_chat            │    └────────────────────────┘  │
  └───────────────────────────┘
```

### 已验证功能

- 纯文字双向消息收发 ✅
- Agent 账号接管模型（PAT 鉴权 + presence 检查）✅
- 多 app 独占（仅 Intera 响应）✅
- Region routing (EU datacenter) ✅
- Session 并发护栏（同一 chat 串行化）✅
- 瞬时错误不再误转人工 ✅
- 图片上传 MIME 校验 ✅

### 待完善

- Rich Message / renderHints 配置填充
- iframe skills 结构化结果渲染
- 端到端 stability 测试（N 周无故障）
