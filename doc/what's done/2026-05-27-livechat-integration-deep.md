# LiveChat 集成深化 — Detailed Plan

> **Context**: Wave 1+2 spec 已全部实施落地（S1–S6 + 修复测试计划 96 tests passing）。下一焦点：LiveChat 集成稳定性 + Rich Message 全覆盖 + Skills 渲染绑定 + 完整测试。
>
> **目标**：把 LiveChat 集成从"原型可用"提升到"客户能在生产稳定运行 N 周不出问题，运营可视化配置每个 skill 在 LiveChat 上的呈现形式"。

---

## 0. 总览

### 0.1 当前已有架构（基于代码审计 2026-05-27）

```
┌──────────────────────────────────────────────────────────────────┐
│ LiveChat (SaaS)                                                  │
│  ┌─────────────┐  POST webhook   ┌────────────────────────────┐  │
│  │ Visitor msg │ ────────────────▶ /api/livechat/webhook       │  │
│  └─────────────┘                  │  (HMAC verify)              │  │
│  ┌─────────────┐                  └──────────┬─────────────────┘  │
│  │ In-chat App │ ─────send_event──┐          │ fire-and-forget    │
│  │ (iframe)    │  intera_*_submit │          ▼                    │
│  └─────────────┘                  ▼  ┌────────────────────────┐  │
│         ▲                            │ bridge.handleIncoming  │  │
│         │ render() actions           │   ↓ fetch internal SSE │  │
│         │                            │ /api/messages (loop.ts)│  │
│  ┌──────┴──────────────────────┐    │   ↓ for await SSEEvent │  │
│  │ LiveChat Bot API            │◀───│ LiveChatRenderer       │  │
│  │  send_event (message/custom)│    │ .render(event)         │  │
│  │  send_event (rich_message)  │    │   → BridgeAction[]     │  │
│  │  transfer_chat              │    └────────────────────────┘  │
│  │  update_chat_properties     │                                 │
│  └─────────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

| 层 | 文件 | 状态 |
|---|---|---|
| Webhook | `apps/chat/app/api/livechat/webhook/route.ts` | ✅ 接受 `incoming_event` + HMAC 验证。⚠️ 无 idempotency、无重试 |
| Bridge | `apps/chat/lib/livechat/bridge.ts` | ✅ fetch SSE + 翻译。⚠️ 失败丢消息 |
| Renderer | `apps/chat/channels/livechat/renderer.ts` | ✅ 翻译 8 种 SSE 事件。⚠️ 只用了 `quick_replies` 原生 rich message，没用 cards/carousel |
| API client | `apps/chat/lib/livechat/livechat-api.ts` | ✅ 5 个动作。⚠️ 缺图片/文件、缺 typing indicator、固定 X-Region: fra |
| Session | `apps/chat/lib/livechat/session-store.ts` | ✅ ExternalConversation 表，textBuffer 原子化 |
| In-chat widget | `apps/chat/app/livechat-widget/page.tsx` | ✅ 3 视图。⚠️ 无错误状态、无连接断开提示 |
| Config | Console `/admin/integrations` | ✅ 鉴权 + showSkillStatus toggle。❌ 无 per-skill rendering 配置 |
| 测试 | — | ❌ **零** |

### 0.2 当前 Skill ↔ Rich Message 映射

| Intera SSE 事件 | LiveChat 呈现 | 实现位置 | 状态 |
|---|---|---|---|
| `tool_executing` / `skill_result` | 自定义 widget `status_track` | in-chat iframe | ✅ |
| `interaction_proposed` | 自定义 widget `propose_interaction` | in-chat iframe | ✅ |
| `form_request` | 自定义 widget `request_user_input` | in-chat iframe | ✅ |
| `clarification` (propose_cases) | 原生 `rich_message` `quick_replies` | LiveChat 主聊天框 | ✅ |
| `escalated` | `transfer_chat` to queue | LiveChat 系统 | ✅ |
| `case_created` | `update_chat_properties` (后台元数据) | 客服可见 | ✅ |
| `text_delta` + `message_stop` | 缓冲后一次性 plain text | 主聊天框 | ✅ |
| `human_task_created` | plain text 通知 | 主聊天框 | ✅ |
| **N/A — 没用** | **`cards` (image+title+buttons)** | — | ❌ 缺 |
| **N/A — 没用** | **`carousel` (多 cards 横滑)** | — | ❌ 缺 |
| **N/A — 没用** | **`images` rich message** | — | ❌ 缺 |
| **N/A — 没用** | **`systemMessage`** | — | ❌ 缺 |
| **N/A — 没用** | **`file` attachment** | — | ❌ 缺 |
| **N/A — 没用** | **`typing_indicator`** | — | ❌ 缺 |

### 0.3 缺口分级

| 级 | 类别 | 内容 |
|---|---|---|
| 🔴 **P0** | 稳定性 | 测试为零；webhook 无 idempotency；bridge 异常丢消息；token 过期无监控 |
| 🟡 **P1** | 用户体验 | typing indicator 缺；rich message 类型不全（cards/carousel/image）；attachment 不支持；in-chat widget 错误态缺 |
| 🟡 **P1** | 运营配置 | 每个 skill 在 LiveChat 上的渲染形式不可视化配置（S5 砍后留的口） |
| 🟢 **P2** | 运营质量 | chat_archived 等 lifecycle 事件不监听；transfer 写死 queue；多客户隔离不严 |

---

## 阶段 L1 — Foundation Hardening（P0 — Week 1 必做）

### L1.1 Webhook Idempotency

**问题**：LiveChat 在 webhook 收到非 200 / 超时 5s 内会重试。当前 `bridge.handleIncomingEvent` 是 fire-and-forget，bridge 跑到一半服务重启 → LiveChat 重试 → 同一条用户消息被处理两次 → 产生重复 case / 重复 LLM 调用 / 重复账单。

**证据**：
- [webhook/route.ts:65-67](apps/chat/app/api/livechat/webhook/route.ts:65) — fire-and-forget；返回 200 时 bridge 才刚开始
- [bridge.ts:84](apps/chat/lib/livechat/bridge.ts:84) — `handleIncomingEvent` 直接处理，没去重

**修改**：

1. **新增** `apps/chat/lib/livechat/webhook-dedup.ts`：
   ```ts
   import { prisma } from '@intera/shared/prisma'

   /** Returns true if this webhook event has already been processed. */
   export async function isDuplicateWebhook(eventId: string): Promise<boolean> {
     const result = await prisma.webhookEvent.create({
       data: { id: eventId, platform: 'livechat', processedAt: new Date() },
     }).catch((err) => {
       // Unique constraint violation = duplicate
       if (err?.code === 'P2002') return null
       throw err
     })
     return result === null
   }

   /** Cleanup old webhook records (cron job, keep 30 days). */
   export async function pruneOldWebhookEvents(): Promise<void> {
     const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
     await prisma.webhookEvent.deleteMany({ where: { processedAt: { lt: cutoff } } })
   }
   ```

2. **Prisma migration** — 新表 `webhook_events`:
   ```prisma
   model WebhookEvent {
     id           String   @id  // LiveChat event id from payload
     platform     String        // 'livechat' | 'slack' | ...
     processedAt  DateTime @default(now())

     @@index([platform, processedAt])
     @@map("webhook_events")
   }
   ```

3. **修改 webhook/route.ts**（在 verify 之后、route 之前）：
   ```ts
   // LiveChat webhook payload includes event.id — use it as the dedup key
   const eventId = (event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string
   if (await isDuplicateWebhook(`livechat:${eventId}`)) {
     return NextResponse.json({ ok: true, deduped: true })
   }
   ```

**工作量**：2 小时
**依赖**：无
**验证**：单测 `isDuplicateWebhook` 同一 id 两次调用第二次返回 true；集成测发同一个 webhook payload 两次，第二次返回 `deduped: true` 且 bridge 没被调用

---

### L1.2 Bridge 失败处理 + 重试

**问题**：当前 `bridge.handleIncomingEvent` 内 fetch `/api/messages` 失败或 stream 中断，仅 console.error 后返回。用户消息被吞，没有任何用户可见的反馈。

**证据**：
- [bridge.ts:126-130](apps/chat/lib/livechat/bridge.ts:126) — fetch 失败仅 console.error
- [bridge.ts:132-136](apps/chat/lib/livechat/bridge.ts:132) — non-200 同上
- [bridge.ts:198-200](apps/chat/lib/livechat/bridge.ts:198) — 单个 action 失败 console.error 后继续，不通知用户

**修改**：

1. **bridge.ts 失败统一处理**：当 fetch / stream 失败时，发用户可见消息 + 写 trace + 把消息丢进 retry queue
   ```ts
   async function sendFailureNotice(
     chatId: string,
     config: LiveChatConfig,
     reason: 'engine_unreachable' | 'stream_truncated' | 'action_failed',
   ): Promise<void> {
     const msg = {
       engine_unreachable: '抱歉，系统暂时无法处理您的请求。我们正在恢复中，请稍后再试。',
       stream_truncated: '抱歉，回复中断。请重新发送您的问题。',
       action_failed: '抱歉，出现技术问题，已记录。如长时间无响应可联系人工。',
     }[reason]
     await sendTextMessage(chatId, msg, config.botAccessToken, config.licenseId).catch(() => {})
   }
   ```

2. **重试队列**（新表 `livechat_pending_events`）：
   ```prisma
   model LiveChatPendingEvent {
     id          String   @id @default(cuid())
     chatId      String
     customerId  String
     payload     Json     // 原始 event + context 用于重试
     attempt     Int      @default(0)
     lastError   String?
     nextRetryAt DateTime @default(now())
     createdAt   DateTime @default(now())

     @@index([nextRetryAt, attempt])
     @@map("livechat_pending_events")
   }
   ```

3. **新模块** `apps/chat/lib/livechat/retry-queue.ts`：
   - `enqueueRetry(event, error)` — bridge 失败时入队
   - `processRetryQueue()` — cron 调用，按 nextRetryAt 处理，指数退避（30s, 2m, 10m, 30m），4 次失败后 dead letter

4. **新 cron endpoint** `apps/chat/app/api/cron/livechat-retry/route.ts`：
   - 每 30 秒触发（Railway cron 或 Vercel cron）
   - 调用 `processRetryQueue()`

**工作量**：6 小时
**依赖**：L1.1（webhook_events 表已加，复用 prisma migration 流程）
**验证**：bridge fetch 抛错 → 1 条消息进入 pending queue → cron 跑后重试成功 → queue 清空；4 次失败后 lastError 记录 + 用户收到 `engine_unreachable` 通知

---

### L1.3 Token 健康度监控

**问题**：bot_access_token 过期（LiveChat 默认 7-30 天）后所有 send_event 返回 401，运营完全不知道。

**证据**：
- [livechat-api.ts:24-28](apps/chat/lib/livechat/livechat-api.ts:24) — 抛 Error 但 bridge 只 console.error
- 无 health check、无 token age 提示

**修改**：

1. **livechat-api.ts 标识 401**：抛带 `code: 'TOKEN_EXPIRED'` 的错
   ```ts
   if (res.status === 401) {
     const err = new Error(`LiveChat token unauthorized`) as Error & { code?: string }
     err.code = 'TOKEN_EXPIRED'
     throw err
   }
   ```

2. **bridge.ts catch TOKEN_EXPIRED**：
   ```ts
   } catch (err) {
     if ((err as { code?: string })?.code === 'TOKEN_EXPIRED') {
       await markChannelUnhealthy('livechat', config.customerId, 'token_expired')
     }
     console.error('[Bridge] action failed:', action.type, err)
   }
   ```

3. **新表 `channel_health`**：
   ```prisma
   model ChannelHealth {
     id          String   @id @default(cuid())
     customerId  String
     channel     String   // 'livechat' | 'slack' | ...
     status      String   // 'healthy' | 'token_expired' | 'rate_limited' | 'unreachable'
     lastChecked DateTime @default(now())
     lastError   String?
     metadata    Json?

     @@unique([customerId, channel])
     @@map("channel_health")
   }
   ```

4. **健康度 API** `/api/admin/channel-health`：
   - GET — 列出当前 customer 所有渠道健康度
   - POST — 主动探活（用 token 调 `list_chats` 1 条作 ping）

5. **Console UI**：`/admin/integrations` 集成卡片右上角加状态点（绿/黄/红） + 鼠标悬停显示原因 + "重新连接" 按钮

6. **每日 ping cron** `/api/cron/channel-ping`：每 24h 对每个 enabled 集成 ping 一次

**工作量**：5 小时
**依赖**：L1.2（cron 基础设施已建）
**验证**：手动改 token 为 invalid → 触发一次 send → ChannelHealth 状态变 `token_expired` → Console 红点出现 → 改回正常 token 后 "重新连接" → 状态变 `healthy`

---

### L1.4 Webhook Signature 必须强制

**问题**：[webhook/route.ts:10-13](apps/chat/app/api/livechat/webhook/route.ts:10) `LIVECHAT_WEBHOOK_SECRET` 缺失时 warn 后直接通过。生产环境忘了配 → 任何人可伪造 webhook 触发 bridge → 浪费 LLM 配额 + 污染 trace。

**修改**：

1. **生产强制**：
   ```ts
   function verifyWebhookSignature(request, rawBody): boolean {
     const secret = process.env.LIVECHAT_WEBHOOK_SECRET
     if (!secret) {
       if (process.env.NODE_ENV === 'production') {
         throw new Error('LIVECHAT_WEBHOOK_SECRET required in production')
       }
       console.warn('[Webhook] secret not set — DEV ONLY')
       return true
     }
     // ... existing verification
   }
   ```

2. **Console 加 webhook secret 字段**到 `/admin/integrations`（与 botAccessToken 同位置，加密存 DB），生成时显示一次 + 复制到剪贴板

**工作量**：1 小时
**依赖**：无
**验证**：production build 在 secret 未配置时启动报错；dev 启动正常

---

## 阶段 L2 — Rich Message 全覆盖（P1 — Week 2）

### L2.1 LiveChat 原生 Rich Message 类型补全

**问题**：[livechat-api.ts](apps/chat/lib/livechat/livechat-api.ts) 只暴露了 quick_replies。LiveChat 原生支持的还有 cards、carousel、images、systemMessage —— 这些都没用。

**修改 — `apps/chat/lib/livechat/livechat-api.ts` 添加 5 个新函数**：

```ts
/** Send a single rich card with image + title + description + buttons. */
export async function sendCard(
  chatId: string,
  card: { title: string; subtitle?: string; imageUrl?: string; buttons: Array<{ id: string; label: string; type?: 'message' | 'url' | 'webview'; url?: string }> },
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'rich_message',
      template_id: 'cards',
      elements: [{
        title: card.title,
        subtitle: card.subtitle,
        image: card.imageUrl ? { url: card.imageUrl } : undefined,
        buttons: card.buttons.map(b => ({
          type: b.type ?? 'message',
          text: b.label,
          postback_id: b.id,
          user_ids: [],
          value: b.url,
        })),
      }],
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send a horizontal carousel of up to 10 cards. */
export async function sendCarousel(
  chatId: string,
  cards: Array<{ title: string; subtitle?: string; imageUrl?: string; buttons: Array<{ id: string; label: string }> }>,
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'rich_message',
      template_id: 'cards',
      elements: cards.slice(0, 10).map(c => ({
        title: c.title,
        subtitle: c.subtitle,
        image: c.imageUrl ? { url: c.imageUrl } : undefined,
        buttons: c.buttons.map(b => ({ type: 'message', text: b.label, postback_id: b.id, user_ids: [] })),
      })),
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send a single image. */
export async function sendImage(
  chatId: string,
  imageUrl: string,
  caption: string | undefined,
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'file',
      url: imageUrl,
      ...(caption ? { alternative_text: caption } : {}),
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send a system message (grey-styled, non-conversational). */
export async function sendSystemMessage(
  chatId: string,
  text: string,
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'system_message', text, system_message_type: 'manual_message', visibility: 'all' },
  }, botAccessToken, licenseId)
}

/** Show / hide typing indicator. LiveChat displays "Bot is typing..." */
export async function setTypingIndicator(
  chatId: string,
  isTyping: boolean,
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_typing_indicator', {
    chat_id: chatId,
    is_typing: isTyping,
    recipients: 'all',
  }, botAccessToken, licenseId)
}
```

**Webview button 支持**（用户决策 #1）— buttons 加 `type: 'webview'`：

```ts
buttons: card.buttons.map(b => {
  const base = { type: b.type ?? 'message', text: b.label, postback_id: b.id, user_ids: [] }
  if (b.type === 'url' || b.type === 'webview') return { ...base, value: b.url }
  if (b.type === 'webview') return { ...base, webview_height: 'tall' }
  return base
}),
```

**工作量**：3h（原 5 函数）+ 2h（webview button + 测试）= **5 小时**（+1 天抵部分 L2.3 并行）
**依赖**：无
**验证**：单测每个函数 payload 与 LiveChat API 文档一致；本地 staging 用真 token 各调用一次

---

### L2.2 BridgeAction 类型扩展

修改 `apps/chat/lib/livechat/types.ts`：

```ts
export type BridgeAction =
  | { type: 'send_text'; text: string }
  | { type: 'send_widget_payload'; payload: WidgetPayload }
  | { type: 'send_quick_replies'; text: string; options: Array<{ id: string; label: string }> }
  | { type: 'send_card'; card: CardSpec }                       // NEW
  | { type: 'send_carousel'; cards: CardSpec[] }                // NEW
  | { type: 'send_image'; url: string; caption?: string }       // NEW
  | { type: 'send_system_message'; text: string }               // NEW
  | { type: 'set_typing'; isTyping: boolean }                   // NEW
  | { type: 'transfer_chat'; caseId: string; group?: number }   // 加可选 group
  | { type: 'update_chat_properties'; props: Record<string, string> }
  | { type: 'buffer_text'; delta: string }
  | { type: 'flush_text' }
  | { type: 'noop' }

export interface CardSpec {
  title: string
  subtitle?: string
  imageUrl?: string
  buttons: Array<{ id: string; label: string; type?: 'message' | 'url'; url?: string }>
}
```

**Bridge dispatch 新分支** ([bridge.ts:159-197](apps/chat/lib/livechat/bridge.ts:159))：补 5 个 case，调用 L2.1 的 API。

**工作量**：1.5 小时
**依赖**：L2.1
**验证**：renderer 输出 send_card → bridge 调 sendCard → mock LiveChat API 收到正确 payload

---

### L2.3 端到端图片管线（用户决策 #2 — 真图片 + 多模态）

**问题**：用户在 LiveChat（或 Web Chat）上传图片后，整条管线是空的 —— 代码审计结论：

| 层 | 现状 | 文件 |
|----|------|------|
| 消息类型 | `content: string` only，无 content block | `packages/shared/types/index.ts:24-57` |
| API | `/api/messages` 只接受 `message: string` | `apps/chat/app/api/messages/route.ts:239` |
| Agent 消息构造 | `buildApiMessages()` 产 `{role, content: string}[]` | `apps/chat/lib/agent/loop.ts:1653` |
| Stream handler | 只认 text/tool_use/thinking | `apps/chat/lib/agent/stream-handler.ts:98` |
| DB | `Message.content` 是 `String`，无 attachments 列 | `packages/shared/prisma/schema.prisma:264` |
| Attachment 类型 | 定义了 `Attachment` 但从未 populate | `packages/shared/types/index.ts:51` |
| Web Chat 表单文件字段 | 只存 `file.name` 字符串 | `apps/chat/components/chat/form-card.tsx:174` |
| ocr_receipt skill | mock mode，hardcoded fixture | `apps/chat/lib/agent/skills.ts:398` |

**目标**：搭建完整端到端管线，同时兼容 LiveChat 和 Web Chat 两条图片输入路径。

```
LiveChat webhook (file event)
  → bridge 下载图片 → 转 base64
  → /api/messages 接受 content_blocks 格式
  → Agent buildApiMessages() 产出 Anthropic content block array
    [{type: "text", text: "..."}, {type: "image", source: {type: "base64", ...}}]
  → 多模态模型 (Claude Vision) 理解图片
  → 响应通过 SSE 流回
```

#### 修改点

**1. 类型层 — `packages/shared/types/index.ts`**：

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface BaseMessage {
  // ... existing ...
  content: string                              // 保持，向后兼容
  contentBlocks?: ContentBlock[]               // NEW — 多模态消息
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  attachments?: Attachment[]                   // 已有，现在会被 populate
}
```

**2. API 层 — `apps/chat/app/api/messages/route.ts`**：

```ts
const { message, contentBlocks, ... } = body
// 向后兼容：有 contentBlocks 就用，没有则 message string → text block
const resolvedBlocks: ContentBlock[] = contentBlocks ?? (
  message ? [{ type: 'text', text: message }] : []
)
```

**3. Agent 层 — `apps/chat/lib/agent/loop.ts` `buildApiMessages()`**：

```ts
// 如果消息有 contentBlocks，映射为 Anthropic content block 数组
// 否则 fallback {type: "text", text: content}（现有行为不动）
private toAnthropicContent(msg: Message): AnthropicContentBlock[] {
  if (msg.contentBlocks?.length) {
    return msg.contentBlocks.map(b => {
      if (b.type === 'text') return { type: 'text', text: b.text }
      if (b.type === 'image') return { type: 'image', source: b.source }
      return { type: 'text', text: '' }
    })
  }
  return [{ type: 'text', text: msg.content }]
}
```

**4. LiveChat bridge — `apps/chat/lib/livechat/bridge.ts`** 加 attachment 分支：

```ts
if (event.type === 'attachment' && event.attachment) {
  const imageData = await downloadAndEncode(event.attachment.url)  // fetch → ArrayBuffer → base64
  return {
    ...base,
    contentBlocks: [
      { type: 'text', text: `用户上传了图片: ${event.attachment.filename}` },
      { type: 'image', source: { type: 'base64', media_type: event.attachment.contentType, data: imageData } },
    ],
  }
}
```

**5. 新工具 `apps/chat/lib/livechat/image-utils.ts`**：

```ts
export async function downloadAndEncode(url: string): Promise<string> {
  const res = await fetch(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  return buffer.toString('base64')
}
```

**6. Web Chat 端改造 — `apps/chat/components/chat/form-card.tsx`** 文件字段读真实内容：

```ts
// Before: handleChange(key, file.name)  ← 只存文件名
// After:
const reader = new FileReader()
reader.onload = () => {
  const base64 = (reader.result as string).split(',')[1]
  handleChange(key, { filename: file.name, contentType: file.type, data: base64 })
}
reader.readAsDataURL(file)
```

**7. Webhook 入口 — `webhook/route.ts`** 加 file 事件处理：

```ts
if (eventType === 'file') {
  handleIncomingEvent(chatId, customerId, userId, {
    type: 'attachment',
    attachment: { url: event.url, contentType: event.content_type, filename: event.name },
  }, config).catch(...)
}
```

**8. DB migration — `Message` 表加 `contentBlocks Json?` 列**

#### 向后兼容

- 纯文本消息（无 contentBlocks）行为完全不变
- `buildApiMessages()` 有 `contentBlocks` 时走新路径，没有时 fallback 到现有 `{type: 'text', text: content}` 格式
- 老消息（DB 里 contentBlocks 为 null）等同于纯文本

**工作量**：原 2h → **6h**（8 个修改点 × 4 层穿透）
**依赖**：无（类型层改动先做，其他并行）
**验证**：
- LiveChat 发图 → bridge 下载 → base64 → contentBlocks → agent 收到 image block
- Web Chat 表单上传图片 → FileReader → base64 → contentBlocks → agent 收到 image block
- Agent 调用 Claude Vision → 正确理解图片 → 响应文本流回
- 纯文本消息（无 contentBlocks）行为不变（回归测试）

---

### L2.4 Typing Indicator

**问题**：LLM 思考可能 3-10 秒，用户什么提示都没有 → 以为机器人挂了。

**修改 — bridge.ts**：

1. 进入 `handleIncomingEvent` 第一件事，调用 `setTypingIndicator(chatId, true)`
2. 接收到第一个 `text_delta` 时，调用 `setTypingIndicator(chatId, false)`（开始有内容了）
3. 接收到 `message_stop` 后，确保 typing 已关闭

也可以走更简单的策略：handleIncomingEvent 头尾各一次 typing on/off。

**工作量**：1 小时
**依赖**：L2.1（setTypingIndicator API）
**验证**：发消息后 LiveChat 客服端立刻看到 "Bot is typing..."；首字回来后消失

---

## 阶段 L3 — Skill ↔ Rich Message 渲染绑定（P1 — Week 2-3）

### L3.1 数据模型：每 skill 的 channel render config

**问题**：S5 砍后版本：`SkillDefinition.renderHints` 字段已加，但是 ❶ 运营在 Console 不能改、❷ LiveChat renderer 不读它（只走硬编码 switch case）。

**目标**：运营在 Console 给每个 business skill 配 LiveChat 上如何呈现 — 例如：
- `query_order_status` 返回订单详情 → 渲染成 `card` (title=订单号, subtitle=状态, image=支付方式图标, buttons=[查看详情, 联系客服])
- `kb_hybrid_retrieve` 返回多条知识 → 渲染成 `carousel` (每条 1 张 card)
- `get_recommended_games` 返回游戏列表 → 渲染成 `carousel`

**修改 — Prisma**：

`Skill` 表已有 `renderHints` 字段（B3 砍后版本加的）。需要补 migration 确认 column 存在（如果之前是 type only，没真加 DB 列，需要补）：

```prisma
model Skill {
  // ... existing fields ...
  renderHints  Json?  // Per-channel rendering hints
}
```

**渲染 hint 数据形状**（沿用 [packages/shared/channels/render-hints.ts](packages/shared/channels/render-hints.ts) 已定义的类型）：

```ts
{
  livechat?: {
    kind: 'card' | 'carousel' | 'plain' | 'quick_replies' | 'status_track',
    // 'card': skill output 是单对象，需要 mapping
    titleField?: string,         // JSONPath in output, e.g. "order.id"
    subtitleField?: string,
    imageUrlField?: string,
    buttons?: Array<{ id: string; labelField?: string; labelStatic?: string; postback: string }>,
    // 'carousel': skill output 是数组，每元素一张 card
    itemsField?: string,          // JSONPath to the array
    itemTemplate?: { titleField, subtitleField, imageUrlField, buttons },
    // 'quick_replies': output 是数组，转成快回复
    optionsField?: string,
    optionLabelField?: string,
    optionIdField?: string,
  }
}
```

---

### L3.2 渲染器读 renderHints — 业务 skill 的 skill_result 处理

**修改 — `apps/chat/channels/livechat/renderer.ts` 的 `skill_result` case**：

```ts
case 'skill_result': {
  const d = event.data as { name: string; status: string; result?: unknown; renderHints?: SkillDefinition['renderHints'] }
  const hint = d.renderHints?.livechat

  // No hint, fall back to status_track tick (current behavior)
  if (!hint || hint.kind === 'status_track') {
    if (!this.showSkillStatus) return [{ type: 'noop' }]
    return [{
      type: 'send_widget_payload',
      payload: { kind: 'status_track', caseId, step: { id: d.name, label: skillLabel(d.name), state: 'done' } },
    }]
  }

  // Apply the hint
  return renderSkillByHint(d.result, hint, caseId)
}
```

**新文件** `apps/chat/channels/livechat/render-skill-by-hint.ts`：

```ts
import jp from 'jsonpath'  // or custom path resolver
import type { BridgeAction } from '@/lib/livechat/types'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

export function renderSkillByHint(
  output: unknown,
  hint: LivechatRenderHint,
  caseId: string,
): BridgeAction[] {
  switch (hint.kind) {
    case 'card': {
      const title = readPath(output, hint.titleField)
      const subtitle = hint.subtitleField ? readPath(output, hint.subtitleField) : undefined
      const imageUrl = hint.imageUrlField ? readPath(output, hint.imageUrlField) : undefined
      const buttons = (hint.buttons ?? []).map(b => ({
        id: b.postback,
        label: b.labelField ? readPath(output, b.labelField) : b.labelStatic ?? b.id,
      }))
      return [{ type: 'send_card', card: { title, subtitle, imageUrl, buttons } }]
    }
    case 'carousel': {
      const items = readPath(output, hint.itemsField) as unknown[]
      if (!Array.isArray(items) || items.length === 0) {
        return [{ type: 'send_text', text: '（无结果）' }]
      }
      const tpl = hint.itemTemplate!
      const cards = items.slice(0, 10).map(item => ({
        title: readPath(item, tpl.titleField),
        subtitle: tpl.subtitleField ? readPath(item, tpl.subtitleField) : undefined,
        imageUrl: tpl.imageUrlField ? readPath(item, tpl.imageUrlField) : undefined,
        buttons: (tpl.buttons ?? []).map(b => ({
          id: `${b.postback}:${readPath(item, hint.idField ?? '$.id')}`,
          label: b.labelField ? readPath(item, b.labelField) : b.labelStatic ?? b.id,
        })),
      }))
      return [{ type: 'send_carousel', cards }]
    }
    case 'quick_replies': {
      const options = readPath(output, hint.optionsField) as unknown[]
      return [{
        type: 'send_quick_replies',
        text: hint.titleStatic ?? '请选择：',
        options: options.map((o) => ({
          id: String(readPath(o, hint.optionIdField ?? '$.id')),
          label: String(readPath(o, hint.optionLabelField ?? '$.label')),
        })),
      }]
    }
    case 'plain': {
      return [{ type: 'send_text', text: JSON.stringify(output, null, 2) }]
    }
    default:
      return [{ type: 'noop' }]
  }
}

function readPath(obj: unknown, path?: string): string {
  if (!path) return ''
  try {
    // Simple JSONPath: $.foo.bar or foo.bar
    const cleaned = path.startsWith('$.') ? path.slice(2) : path
    return cleaned.split('.').reduce((acc, key) => (acc as Record<string, unknown>)?.[key], obj) as string ?? ''
  } catch {
    return ''
  }
}
```

**工作量**：4 小时
**依赖**：L2.2（send_card / send_carousel BridgeAction 已加）
**验证**：mock skill_result with `query_order_status` output + card hint → renderer 输出 send_card → bridge 调 sendCard

---

### L3.3 Postback 回流处理

**问题**：rich message 的按钮点击会触发 LiveChat 发 webhook `event.type: 'rich_message_postback'`。当前 webhook 不处理这个类型。

**修改 — webhook/route.ts**：

```ts
if (eventType === 'rich_message_postback') {
  const postbackId = event.postback?.id as string
  // 把 postback 翻译为用户消息塞回 /api/messages
  handleIncomingEvent(chatId, customerId, userId, {
    type: 'postback',
    postbackId,
  }, config).catch(...)
}
```

**bridge.ts buildMessagesBody 加 postback 分支**：
```ts
if (event.type === 'postback' && event.postbackId) {
  // 约定 postback id 格式 "<intent>:<value>" — agent 根据 intent 决定如何处理
  return { ...base, message: `[用户点击] ${event.postbackId}` }
}
```

更高级做法：根据 postback id 前缀路由到特定 case action（例如 `view_order:TX123` → 直接调 query_order_status）。这是 L3.4。

**工作量**：1.5 小时
**依赖**：L3.2
**验证**：发一个带 button 的 card → 用户点击 → webhook 触发 → agent 收到 "[用户点击] view_order:TX123"

---

### L3.4 Console UI：每 skill 的 LiveChat 渲染配置编辑器

**问题**：renderHints 字段有了，但运营在 Console 的 Skills 页面看不到也改不了。

**修改 — `apps/console/app/admin/skills/page.tsx`** 在编辑业务 skill 的弹窗里加 "LiveChat 呈现" 标签页：

```
┌─ Edit Skill: query_order_status ─────────────┐
│ [Basic] [Schema] [LiveChat Rendering ⭐ NEW] │
├──────────────────────────────────────────────┤
│ Render as: [Card ▾]                          │
│                                              │
│ Card fields (path in skill output JSON):     │
│   Title:     [$.order.id            ]        │
│   Subtitle:  [$.order.status        ]        │
│   Image URL: [$.order.thumbnailUrl  ] (opt) │
│                                              │
│ Buttons:                                     │
│   [+] Add button                             │
│   ┌────────────────────────────────────────┐ │
│   │ Label (static): [View Details]         │ │
│   │ Postback id:    [view_order]           │ │
│   │                          [Remove]      │ │
│   └────────────────────────────────────────┘ │
│                                              │
│ ─ Preview ─────────────────────────────────  │
│ Sample input from Mock Fixture: [Load]       │
│ ┌──────────────────────────────────────────┐ │
│ │ [Order #TX2026051412345678]              │ │
│ │  status: completed                       │ │
│ │  [View Details]                          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│              [Cancel]  [Save]                │
└──────────────────────────────────────────────┘
```

**实现要点**：
- "Render as" 下拉 = LivechatRenderHint['kind'] 枚举
- 选不同 kind 显示不同的字段（card 显示 title/subtitle/imageUrl/buttons，carousel 显示 itemsField + itemTemplate，quick_replies 显示 optionsField + optionIdField/optionLabelField）
- 预览组件：用 skill 的 mockFixture（已有字段）+ 选中的 hint 跑客户端 renderSkillByHint，渲染出 LiveChat 视觉等价的 React 组件
- 保存写 Skill.renderHints JSON

**工作量**：1 天
**依赖**：L3.2（renderSkillByHint 函数已在共享位置 — 注意：需要把 renderSkillByHint 抽到 packages/shared，让 console 也能用）
**验证**：在 Console 配置 query_order_status 为 card → 发起一个会触发它的 chat → LiveChat 端看到正确渲染的 card

---

### L3.5 Console LiveChat 子页面 + Widget iframe 预览（用户决策 #3）

**目标**：在 Console `/admin/integrations` 下新增 LiveChat 详情子页面，内嵌 widget iframe 预览。

**新建 `apps/console/app/admin/integrations/livechat/page.tsx`**：

```
┌─ Integrations > LiveChat ────────────────────┐
│                                              │
│ [Connection]          [Widget Preview]       │
│  License ID: [____]   ┌────────────────────┐ │
│  Bot Token:  [____]   │                    │ │
│  Webhook URL:[____]   │  iframe → widget   │ │
│                       │  (preview mode)    │ │
│  [Save]  [Test Conn]  │                    │ │
│                       └────────────────────┘ │
│                                              │
│ [Render Hints]  [Health History]             │
└──────────────────────────────────────────────┘
```

**Widget 双模改造 — `apps/chat/app/livechat-widget/page.tsx`**：

```tsx
// 检测预览模式
const isPreview = new URLSearchParams(window.location.search).has('preview')

// 当不在 LiveChat 环境时，用 postMessage 接收预览事件
if (isPreview || !window.LiveChatWidget) {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'intera_widget_preview') {
      // event.data.payload: WidgetPayload — 直接驱动视图切换
      processWidgetPayload(event.data.payload)
    }
  })
}
```

**Console 侧预览控制**：

```tsx
// 在 livechat/page.tsx 中
const widgetIframeRef = useRef<HTMLIFrameElement>(null)

function previewWidget(payload: WidgetPayload) {
  widgetIframeRef.current?.contentWindow?.postMessage({
    type: 'intera_widget_preview',
    payload,
  }, '*')
}

// 预览切换按钮
<select onChange={(e) => previewWidget(mockPayloads[e.target.value])}>
  <option value="status_track">Status Track</option>
  <option value="propose_interaction">Propose Interaction</option>
  <option value="request_user_input">Request User Input</option>
</select>

<iframe ref={widgetIframeRef} src={chatApiUrl('/livechat-widget?preview=1')} />
```

**工作量**：4h（子页面）+ 2h（widget 双模）+ 2h（preview 控制）= **1 天**
**依赖**：L3.4（Console 已有 LiveChat Rendering tab 模式），widget 现有结构不变
**验证**：Console 下拉切视图 → iframe 内 widget 显示对应视图；真 LiveChat 环境 widget 行为不受影响（SDK 路径不变）

---

## 阶段 L4 — 运营质量（P2 — Week 3-4）

### L4.1 Chat Lifecycle 事件

**问题**：LiveChat webhook 还有这些事件没监听：
- `chat_archived` — 会话归档 → 应该终止 case loop、关闭 session
- `agent_disconnected` / `agent_connected` — 客服切换 → 可能影响 transfer 行为
- `incoming_chat` — 新会话开始 → 当前是被 `incoming_event/message` 隐式触发，应显式处理

**修改 — webhook/route.ts**：

```ts
if (action === 'chat_archived') {
  await closeSession(chatId, 'archived_by_agent')
  return NextResponse.json({ ok: true })
}

if (action === 'incoming_chat') {
  // Optional: send welcome card here
  return NextResponse.json({ ok: true })
}
```

**工作量**：2 小时
**依赖**：无
**验证**：客服点 "归档" → ExternalConversation.status = 'archived' → 同一 chatId 再发消息会创建新 session

---

### L4.2 Transfer 增强：按 group / queue routing

**问题**：[livechat-api.ts:95-104](apps/chat/lib/livechat/livechat-api.ts:95) `transferChat` 写死 `target: { type: 'queue' }`，无法指定特定客服 group。

**修改**：

```ts
export async function transferChat(
  chatId: string,
  target: { type: 'group'; ids: number[] } | { type: 'agent'; ids: string[] } | { type: 'queue' },
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('transfer_chat', { id: chatId, target }, botAccessToken, licenseId)
}
```

**Renderer 改 `escalated` case**：从 `ChannelBindingConfig.transferTarget` 读取目标 group/queue。

**Console 加 transfer target 配置**到 `/admin/integrations` LiveChat tab：默认 queue，可选 group ids（多选）。

**工作量**：3 小时
**依赖**：L1.1（DB schema 已 migration 通畅）
**验证**：配置 transfer 到 group 5 → 触发 escalation → LiveChat 显示该 chat 进入 group 5 队列

---

### L4.3 多客户 webhook 隔离

**问题**：所有 customer 都打到同一个 webhook URL `<host>/api/livechat/webhook`，靠 `license_id` 区分。生产风险：不同客户的 LIVECHAT_WEBHOOK_SECRET 是同一个 → 一个客户的 secret 泄露，其他客户也受影响。

**修改**：

- Webhook URL 改为 `<host>/api/livechat/webhook/[customerId]`
- 每个 customer 独立 secret，存在 LiveChatConfig 表（新 column `webhookSecret`）
- Console 自动生成 secret + 显示需要在 LiveChat Developer Console 配的 URL
- 老的 `/api/livechat/webhook`（无 customerId）保留作 deprecation 期 1 个版本，warn 后转给 license_id-based 路由

**工作量**：4 小时
**依赖**：无
**验证**：两个测试 customer，各自的 webhook URL 收到对方的 payload 会 401（secret 不匹配）

---

### L4.4 In-Chat Widget 错误态 + 重连 + 双模完善

**问题**：[livechat-widget/page.tsx](apps/chat/app/livechat-widget/page.tsx) 没有：
- 网络断开提示
- LiveChat SDK 未加载时的 fallback
- 提交失败后的 retry UI

**修改 — page.tsx 加状态机**：
- 监听 `window.addEventListener('online'/'offline')`
- LiveChat SDK call 包 try/catch + 显示 "提交失败，请重试"
- 添加 idle 状态的占位文案（无 widget payload 时显示 "Intera 正在准备中..."）
- **双模完善**（延续 L3.5）：preview 模式下同样显示错误态/offline banner，确保预览体验完整

**工作量**：3h（原错误态）+ 1h（双模收尾）= **4 小时**
**依赖**：L3.5（widget 双模已搭建）
**验证**：手动断网 → widget 顶部出现红色 banner；恢复 → 自动消失；Console preview 模式下同样显示

---

## 阶段 L5 — 完整测试套件（贯穿全程，最迟 Week 2 完成 P0 覆盖）

### L5.1 Mock LiveChat API（基础设施）

**新建** `apps/chat/lib/livechat/__tests__/mocks/livechat-api-mock.ts`：

```ts
import { vi } from 'vitest'

export interface MockLiveChatCall {
  action: string
  body: unknown
}

export class MockLiveChatServer {
  calls: MockLiveChatCall[] = []
  shouldFail: Map<string, { status: number; body?: string }> = new Map()

  /** Mock global fetch — call before tests. */
  install() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const action = url.split('/').pop() ?? ''
      const body = init?.body ? JSON.parse(init.body as string) : null
      this.calls.push({ action, body })

      const failure = this.shouldFail.get(action)
      if (failure) {
        return new Response(failure.body ?? 'mock error', { status: failure.status })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
  }

  reset() { this.calls = []; this.shouldFail.clear() }
  uninstall() { vi.unstubAllGlobals() }

  /** Helper: assert N actions of a type were called. */
  expectCalls(action: string, count: number): MockLiveChatCall[] {
    const matching = this.calls.filter(c => c.action === action)
    if (matching.length !== count) {
      throw new Error(`Expected ${count} ${action} calls, got ${matching.length}`)
    }
    return matching
  }

  expectNoCalls(action: string) { this.expectCalls(action, 0) }
}
```

**工作量**：2 小时
**依赖**：vitest 已就绪

---

### L5.2 单元测试

**位置**：`apps/chat/lib/livechat/__tests__/unit/`

#### `livechat-api.test.ts`（9 个 API 函数 × ~3 case 每个 ≈ 27 tests）
- sendTextMessage：成功 → POST 到正确 URL + body
- sendTextMessage：失败 401 → 抛 TOKEN_EXPIRED
- sendCard：成功 → payload 结构正确
- sendCard：buttons 数量超限 → 自动截断
- sendCarousel：>10 cards → 只发前 10
- sendImage：成功
- sendSystemMessage：成功
- sendQuickReplies：option 包含特殊字符 → 转义
- setTypingIndicator：true/false 两种
- transferChat：3 种 target 类型
- updateChatProperties：前缀 `intera.` 正确加上

#### `webhook-dedup.test.ts`（5 tests）
- 第一次 → false（不重复）
- 第二次同 id → true（重复）
- 不同 id → false
- pruneOldWebhookEvents 删 30 天前
- DB 异常 → 抛错（保守，不要 false negative）

#### `renderer.test.ts`（已有少量，扩展到所有 SSE 类型 × 12 tests）
- text_delta：buffer_text
- message_stop：flush_text
- tool_executing showSkillStatus=true：widget payload
- tool_executing showSkillStatus=false：noop
- skill_result with renderHints.card：send_card with mapped fields
- skill_result with renderHints.carousel：send_carousel
- skill_result with renderHints.quick_replies：send_quick_replies
- skill_result without renderHints：status_track widget
- interaction_proposed：widget payload
- form_request：widget payload
- clarification：quick_replies
- escalated：transfer_chat
- case_created：update_chat_properties
- human_task_created：send_text

#### `render-skill-by-hint.test.ts`（10 tests）
- card kind + valid output → 字段正确映射
- card kind + missing field → 空 string fallback
- carousel kind + array output → cards 数组
- carousel kind + empty array → "无结果" 文本
- quick_replies kind + array → options 正确
- readPath 解析 `$.foo.bar`
- readPath 解析 nested `$.foo.bar.baz`
- readPath 处理 array index `$.items[0].title`
- 不支持的 kind → noop
- buttons 数量为 0 → card 仍可发（只有 title）

#### `session-store.test.ts`（已经有 prisma 集成测试基础 → 6 tests）
- getSession 不存在 → null
- upsertSession + getSession 往返
- appendTextBuffer 并发安全（2 个 promise 同时 append → buffer 合并）
- flushTextBuffer 原子（一个 caller 拿到非空后立刻清空）
- updateSessionState 不存在的 chatId → 不抛
- 不同 platform 隔离

---

### L5.3 集成测试

**位置**：`apps/chat/lib/livechat/__tests__/integration/`

#### `webhook-to-bridge.test.ts`（核心 e2e — 8 tests）
- **Happy path**：
  - POST webhook with valid signature + message event
  - Mock /api/messages 返回 mock SSE stream
  - Mock LiveChat API 收 sendTextMessage call
  - 断言：session created, bridge state 转 idle, MockLiveChat.calls 包含 send_event
- **Idempotency**：同一 webhook payload 发两次 → MockLiveChat 只收到 1 次 send_event
- **HMAC fail**：错误 signature → 401，bridge 不调用
- **Production missing secret**：NODE_ENV=production + secret missing → 启动时报错
- **Form submit**：发 intera_form_submit custom event → bridge 把 formResult 塞给 /api/messages
- **Interaction submit**：发 intera_interaction_submit → bridge 处理
- **File upload**：发 file event → bridge 把 attachment 信息作为消息塞给 /api/messages
- **Rich message postback**：发 rich_message_postback → bridge 翻译为 "[用户点击]" 消息

#### `bridge-retry.test.ts`（5 tests）
- /api/messages 一次失败 → 入队 + 用户收到 "engine_unreachable"
- /api/messages stream 中途断开 → "stream_truncated" 通知
- LiveChat API 401 → ChannelHealth 标 token_expired
- LiveChat API 500 → 单个 action 失败但不阻断其他 actions
- 4 次重试后 dead letter

#### `skill-rendering-end-to-end.test.ts`（4 tests）
- Skill `query_order_status` 配 card hint → 完整链路：mock SSE skill_result → renderer → bridge → LiveChat API 发 send_event with cards template
- Skill `kb_hybrid_retrieve` 配 carousel hint → LiveChat 收到 carousel
- Skill 未配 hint → status_track 行为不变（兼容）
- 配错 hint（缺 titleField）→ renderer 不崩，发空 card 或 fallback 文本

---

### L5.4 Console UI 测试（vitest + happy-dom）

**位置**：`apps/console/components/admin/__tests__/`

#### `skill-render-hints-editor.test.tsx`（6 tests）
- 选 "Render as: card" → 显示 title/subtitle/buttons 字段
- 选 "carousel" → 显示 itemsField + itemTemplate
- 修改 titleField → 保存时 PUT 包含正确 renderHints
- "预览" tab 用 mockFixture 渲染出 card
- 删除 button → 列表减少
- 切换不同 kind 后保留其他 kind 的配置（草稿状态）

---

### L5.5 测试运行 + CI Gate（用户决策 #5 — 硬性 80%）

修改 `package.json`：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:livechat": "vitest run apps/chat/lib/livechat",
    "test:smoke": "vitest run apps/chat/lib/agent/__tests__/smoke",
    "test:integration": "vitest run --testPathPattern=integration"
  }
}
```

**vitest.config.ts 加 coverage threshold**：

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary'],
  lines: 80,
  branches: 75,
  functions: 80,
  statements: 80,
  include: [
    'apps/chat/lib/livechat/**/*.ts',
    'apps/chat/channels/livechat/**/*.ts',
  ],
}
```

**CI pipeline**：`pnpm test:livechat --coverage` 不达标 → fail，不合并。

**目标覆盖率**：
- LiveChat 模块代码（apps/chat/lib/livechat + apps/chat/channels/livechat）≥ 80% lines covered
- 关键路径 100%：webhook signature、bridge dispatch、renderer 每个 case、session 原子操作

**工作量**：测试编写贯穿 L1–L4，各阶段已嵌入。L5.5 CI 配置 1h。

---

## 总执行顺序与依赖

```
Week 1 (P0 必做 — 稳定性)
  Day 1: L1.1 webhook idempotency + L5.1 mock infrastructure
  Day 2: L1.2 retry queue
  Day 3: L1.3 token health monitor
  Day 4: L1.4 webhook signature 强制 + L5.2 单测起步（webhook-dedup, livechat-api 部分）
  Day 5: L5.3 集成测试 webhook-to-bridge + bridge-retry

Week 2 (P1 — Rich Message + 图片管线)
  Day 1-2: L2.1 + L2.2 rich message API + BridgeAction 扩展（含 webview button）
  Day 3-4: L2.3 图片管线（类型层→API→Agent→Bridge→Web Chat 5 层穿透）
  Day 5:   L2.4 typing indicator

Week 3 (P1 — 渲染绑定 + Console UI)
  Day 1-2: L3.1 + L3.2 + L3.3 renderHints 读取 + renderSkillByHint + postback
  Day 3:   L3.4 Console renderHints 编辑器 + 预览
  Day 4:   L3.5 Console LiveChat 子页面 + Widget iframe 预览（双模改造）
  Day 5:   L5.2 单测补全 + L5.3 skill-rendering 集成测试

Week 4 (P2 — 运营质量)
  Day 1:   L4.1 chat lifecycle
  Day 2-3: L4.2 transfer routing + L4.3 multi-tenant webhook
  Day 4:   L4.4 widget 错误态 + 双模收尾
  Day 5:   buffer + CI coverage gate 配置 + 真 token 全链路演练

总计：4 周（20 工作日）。
P0 (Week 1) 必须先完成；P1 (Week 2-3) 强烈建议；P2 (Week 4) 可推迟。
```

---

## 验证清单（每阶段结束）

### Week 1 (P0) 结束
- [ ] `pnpm test:livechat` 通过（webhook-dedup + livechat-api unit + webhook-to-bridge + bridge-retry integration）
- [ ] 手动：同一 webhook 发 2 次 → bridge 只跑 1 次
- [ ] 手动：模拟 /api/messages 5xx → 30 秒内重试 → 成功 → 队列清空
- [ ] 手动：故意改 token 错 → Console 集成卡片红点 → ping → 状态更新
- [ ] 启动 production build 不配 secret → 报错退出

### Week 2 (P1 — Rich Message) 结束
- [ ] Renderer 单测全过（含每个 rich message kind）
- [ ] 手动：LiveChat 发图 → agent 收到 "[用户上传文件]"
- [ ] 手动：发消息后立刻看到 "Bot is typing..."
- [ ] 手动：用业务 skill 没配 hint 时仍走 status_track（无回归）

### Week 3 (P1 — 渲染绑定) 结束
- [ ] Skill 编辑器有 "LiveChat Rendering" tab
- [ ] 配 query_order_status 为 card → 真实 LiveChat 端看到正确 card
- [ ] 配 kb_hybrid_retrieve 为 carousel → 真实 LiveChat 端看到 carousel
- [ ] 点 card 按钮 → webhook 收到 postback → bridge 处理

### Week 4 (P2) 结束
- [ ] 客服归档会话 → 同一 chatId 再发消息创建新 session
- [ ] 多客户独立 webhook URL + secret
- [ ] Widget 断网时显示提示

---

## 数据库 migrations 汇总

按时间顺序（8 个，全部可逆）：

1. **`<ts>_webhook_events`** (L1.1) — `WebhookEvent` 表
2. **`<ts>_livechat_pending_events`** (L1.2) — `LiveChatPendingEvent` 表
3. **`<ts>_channel_health`** (L1.3) — `ChannelHealth` 表
4. **`<ts>_livechat_config_webhook_secret`** (L1.4) — `LiveChatConfig.webhookSecret` 列
5. **`<ts>_message_content_blocks`** (L2.3) — `Message.contentBlocks` Json 列（NEW — 图片管线）
6. **`<ts>_skill_render_hints_column`** (L3.1) — 确认 `Skill.renderHints` 列（可能 type-only，需补 DB 列）
7. **`<ts>_livechat_config_transfer_target`** (L4.2) — `LiveChatConfig.transferTarget` JSON 列
8. **`<ts>_external_conversation_status_archived`** (L4.1) — 确认 `ExternalConversation.status` 接受 'archived'

每个 migration 必须可逆（down script）。

---

## 风险 + 回滚

| 风险 | 缓解 |
|---|---|
| L1.1 idempotency 用 LiveChat `event.id`，但 LiveChat 实际 payload 可能不包含稳定 id | 兜底用 `webhook_id` 或 raw body 前 64 字符 hash；测试时验证 LiveChat 真实 payload 字段名 |
| L1.2 retry queue 在 Railway 没 cron 设施 | 用 Railway Native Cron 或 Vercel Cron；最差情况下用一个 always-on 服务 + setInterval（不推荐生产） |
| L3.2 jsonpath 库依赖膨胀 | 用自实现 `readPath`（spec 里给的简化版）；不要引 jsonpath npm 包 |
| L3.4 Console 编辑器太复杂运营看不懂 | 预设模板（"订单 → card"、"列表 → carousel"）+ 一键应用；预览必须实时 |
| L4.3 改 webhook URL 需要客户在 LiveChat 后台重新配 | 老 URL 保留 deprecation 期，运营 portal 发通知 |

**回滚策略**：每阶段独立 PR，feature flag `INTERA_LIVECHAT_*` 控制新行为：
- `INTERA_LIVECHAT_DEDUP=1` (L1.1)
- `INTERA_LIVECHAT_RETRY_QUEUE=1` (L1.2)
- `INTERA_LIVECHAT_RENDER_HINTS=1` (L3.2)

---

## 产品决策（已确认 — 2026-05-27）

1. **Webview button** → ✅ **要，加进 L2.1**。`sendCard`/`sendCarousel` buttons 支持 `type: 'webview'`，工作量 +1 天。

2. **图片/文件处理** → ✅ **真图片格式 + 多模态 API**。用户上传图片走端到端图片数据流（下载→base64→content blocks→Claude Vision），不再用 mock OCR。**同时改造 Intera Web Chat 已有的图片 input**（form-card.tsx 只存文件名 → 读文件内容 base64）。详见下方 L2.3 扩展设计。

3. **In-chat widget** → ✅ **保留，并嵌入 Console LiveChat 子页面**。Widget 双模改造（LiveChat SDK + postMessage fallback），Console `/admin/integrations/livechat` 子页面含 iframe 预览。详见 L3.4/L4.4 更新。

4. **多 customer webhook 隔离 (L4.3)** → ✅ **v1 就做**。维持原计划。

5. **测试覆盖率** → ✅ **硬性 CI gate 80%**。CI 配 coverage threshold（vitest config `coverage.lines: 80`），不达标不合并。

---

## 文件清单

### 新建
- `apps/chat/lib/livechat/webhook-dedup.ts`
- `apps/chat/lib/livechat/retry-queue.ts`
- `apps/chat/lib/livechat/channel-health.ts`
- `apps/chat/lib/livechat/image-utils.ts` (NEW — L2.3 图片下载+base64)
- `apps/chat/lib/livechat/__tests__/mocks/livechat-api-mock.ts`
- `apps/chat/lib/livechat/__tests__/unit/livechat-api.test.ts`
- `apps/chat/lib/livechat/__tests__/unit/webhook-dedup.test.ts`
- `apps/chat/lib/livechat/__tests__/unit/renderer.test.ts`
- `apps/chat/lib/livechat/__tests__/unit/render-skill-by-hint.test.ts`
- `apps/chat/lib/livechat/__tests__/unit/session-store.test.ts`
- `apps/chat/lib/livechat/__tests__/integration/webhook-to-bridge.test.ts`
- `apps/chat/lib/livechat/__tests__/integration/bridge-retry.test.ts`
- `apps/chat/lib/livechat/__tests__/integration/skill-rendering-end-to-end.test.ts`
- `apps/chat/channels/livechat/render-skill-by-hint.ts` （或移到 packages/shared/channels/）
- `apps/chat/app/api/cron/livechat-retry/route.ts`
- `apps/chat/app/api/cron/channel-ping/route.ts`
- `apps/chat/app/api/admin/channel-health/route.ts`
- `apps/console/app/admin/integrations/livechat/page.tsx` (NEW — L3.5 LiveChat 子页面 + widget iframe 预览)
- `apps/console/components/admin/skill-render-hints-editor.tsx`
- `apps/console/components/admin/skill-render-hints-preview.tsx`
- `apps/console/components/admin/__tests__/skill-render-hints-editor.test.tsx`

### 修改
- `apps/chat/lib/livechat/livechat-api.ts` — +5 函数 (card, carousel, image, system, typing)；buttons 加 webview 类型
- `apps/chat/lib/livechat/types.ts` — BridgeAction union 扩展、CardSpec 类型
- `apps/chat/lib/livechat/bridge.ts` — 失败处理、重试入队、新 BridgeAction dispatch、typing indicator 头尾、图片下载+contentBlocks 构造
- `apps/chat/lib/livechat/config-store.ts` — webhookSecret + transferTarget 读
- `apps/chat/lib/livechat/session-store.ts` — closeSession（L4.1）
- `apps/chat/app/api/livechat/webhook/route.ts` — dedup、新 event 类型（file, postback, chat_archived）、production secret 强制
- `apps/chat/app/api/livechat/webhook/[customerId]/route.ts` — per-customer 路由 (L4.3)
- `apps/chat/app/livechat-widget/page.tsx` — 错误态 + offline 提示 + 双模（SDK + postMessage preview）
- `apps/chat/channels/livechat/renderer.ts` — skill_result 读 renderHints、其他事件兼容性保留
- `apps/chat/app/api/messages/route.ts` — body 接受 `contentBlocks` (L2.3)
- `apps/chat/components/chat/form-card.tsx` — 文件字段读真实内容 base64 (L2.3)
- `apps/console/app/admin/integrations/page.tsx` — 集成卡片加健康度状态 + 跳转到 livechat 子页面
- `apps/console/app/admin/skills/page.tsx` — Edit 弹窗加 "LiveChat Rendering" tab
- `packages/shared/types/index.ts` — 新增 `ContentBlock` 类型，`BaseMessage` 加 `contentBlocks?` (L2.3)
- `packages/shared/channels/render-hints.ts` — LivechatRenderHint 类型完善（card/carousel/quick_replies/plain/status_track 各自字段）
- Prisma schema — 8 个 migration (含 Message.contentBlocks)

### 不动
- 引擎层核心逻辑（apps/chat/lib/agent）— 不对现有 text-only 路径做任何改动；content block 支持是增量，`buildApiMessages()` 有 contentBlocks 时走新路径，没有时 fallback 到现有行为
- Console 其他页面（agent config, case types, sub-agents 等）
- 测试基础设施 vitest.config.ts、mocks/anthropic.ts —已就绪复用

---

## 给执行工程师的开工注意事项

1. **从 L1.1 + L5.1 开始**：dedup 是后续所有改动的安全网，mock infra 是所有测试的基础
2. **每个新文件先写测试**（TDD）：L5.2 单测代码已具体到 case 级，对照写
3. **不要扩范围**：plan 里没的内容不要做，遇到就开新 ticket。明确的 "需要确认" 之外的产品决策不自行决定
4. **真实 LiveChat token 用于 staging 验证**：unit/integration test 用 mock，但 Week 1 末和 Week 3 末必须用真 token 跑一次全链路
5. **每个 PR 必须**：
   - 包含对应单元/集成测试
   - 通过 `pnpm test:livechat`
   - 描述里写清楚改了哪个 L 项
   - feature flag 开关默认 off，验证后再开
