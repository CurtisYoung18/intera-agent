# LiveChat 接管 ③ — Rich Message / iframe ↔ Intera tools/skills 联动（代码级指导）

> 作者：代码审计 2026-05-28
> 目标读者：开发工程师，照此实现
> 前置：文档 ① 的文字消息已打通（rich message 也是 `send_event`，同样受**在场/路由**、`ignore_requester_presence`、region 影响，务必先做完 ①）。

> **集成模型提醒**（见文档①§0.0）：本项目是 **Agent 账号接管**（PAT 以人工 agent 身份发），所有 rich message / custom 事件都**以该 agent 身份发出**，客户看到的是具名客服而非"机器人"。typing 对应 GPTBots 的 "Replying Status"；GPTBots 的 "Pre-Chat Form" 对应本文 iframe 的 `request_user_input` / `skill_render` 表单。渲染逻辑本身与 bot/agent 无关，下面的代码方案不受影响。

---

## 0. 一句话现状

**渲染管线（renderer → render-skill-by-hint → sendCard/sendCarousel）代码是齐的，但"哪个 skill 渲染成什么"这份配置从来没人填、也没人读——整条 skill↔rich message 链路是断的。** iframe 那侧能渲染 3 种内置视图，但**不能渲染任意 skill 的结构化结果**。本文给出把这两条都接通的代码方案。

---

## 1. 两条渲染通道（先分清）

Intera 在 LiveChat 上有两种"富"呈现方式，**别混**：

| 通道 | 走什么 | 渲染者 | 现在能渲染什么 | 代码位置 |
|---|---|---|---|---|
| **A. LiveChat 原生 rich_message** | `send_event` type=`rich_message`（cards / carousel / quick_replies 模板） | LiveChat 客户端自己 | 仅 `clarification`(propose_cases) → quick_replies | [livechat-api.ts:66-134](apps/chat/lib/livechat/livechat-api.ts:66) |
| **B. Intera 自定义 iframe widget** | `send_event` type=`custom` content=`intera_widget_payload` | 自家 React 页面 [livechat-widget/page.tsx](apps/chat/app/livechat-widget/page.tsx) | `status_track` / `propose_interaction` / `request_user_input` | renderer + 该页面 |

两条都靠 `LiveChatRenderer.render(SSEEvent)` 把 agent 的 SSE 事件翻译成 `BridgeAction`，再由 bridge 调 API 发出（[bridge.ts:181-241](apps/chat/lib/livechat/bridge.ts:181)）。

---

## 2. 为什么"skill 结果渲染成 rich message"完全没生效（断点逐个列）

`skill_result` SSE 事件在 renderer 里的处理（[renderer.ts:52-75](apps/chat/channels/livechat/renderer.ts:52)）：

```ts
case 'skill_result': {
  const livechatHint = d.renderHints?.livechat as LivechatRenderHint | undefined
  if (livechatHint && d.result !== undefined) {
    return renderSkillByHint(d.result, livechatHint)   // ← 想走这里：渲染成 card/carousel
  }
  // 否则退回 status_track widget
}
```

走 `renderSkillByHint` 的前提是 `d.renderHints.livechat` 有值。它从哪来？loop.ts 发事件时（[loop.ts:429](apps/chat/lib/agent/loop.ts:429)）：

```ts
renderHints: renderHints ?? skillDef?.renderHints,
```

`skillDef.renderHints` 又从哪来？**断点都在这条链上**：

| 断点 | 事实 | 后果 |
|---|---|---|
| **B1. Skill 表无 `renderHints` 列** | [schema.prisma:127-156](packages/shared/prisma/schema.prisma:127) Skill model 没有这列 | DB 里根本存不下 |
| **B2. skill loader 不读 renderHints** | [skills.ts:833-849](apps/chat/lib/agent/skills.ts:833) 映射 DB skill 时没有 `renderHints` 字段 | 业务/HTTP skill 的 `renderHints` 永远 `undefined` |
| **B3. 内置 skill 也没定义** | [skills.ts](apps/chat/lib/agent/skills.ts) `BUILT_IN_SKILLS` 无一项带 `renderHints` | 内置 skill 也走不到 rich |
| **B4. 类型不匹配** | [types/index.ts:107](packages/shared/types/index.ts:107) `renderHints?: Partial<Record<string, RenderHint>>`——这里的 `RenderHint` 是**通用 UI hint**（`CardHint`有`titleOverride`），但 renderer 把它当成 **`LivechatRenderHint`**（字段路径型，有`titleField`）用 | 两套类型互不兼容，就算填了也对不上 |
| **B5. ChannelBinding.toolOverrides 是死代码** | `resolveHint()`（[renderer.ts:26-43](packages/shared/channels/renderer.ts:26)）实现了"tool hint→binding override→default"，但全仓库**没有任何代码读写 `prisma.channelBinding`**，bridge 构造的 binding 只有 channel/enabled/credentials（[bridge.ts:163-167](apps/chat/lib/livechat/bridge.ts:163)），renderer 也没调用 `resolveHint` | toolOverrides / resolveHint 整条路废弃 |
| **B6. Console 编辑器是孤儿** | [skill-render-hints-editor.tsx](apps/console/components/admin/skill-render-hints-editor.tsx) 能产出 `LivechatRenderHint`，但**没有任何页面 import 它**，也没有保存目标 | 运营无处配置 |

> **净结论**：渲染器和 `renderSkillByHint`（[render-skill-by-hint.ts](apps/chat/channels/livechat/render-skill-by-hint.ts)）是好的、可用的，缺的只是"**让 `renderHints.livechat` 真正带着值流到 renderer**"。下面 §3 就补这一段。

---

## 3. 接通通道 A：skill 结果 → 原生 rich card / carousel / quick_replies

**选型**：在 `Skill` 表上加 `renderHints` 列（直接、和现有 loader 路径一致），并把类型统一成 `LivechatRenderHint`。（备选：复活 `ChannelBinding.toolOverrides` + `resolveHint`，见 §3.6。）

### 3.1 Schema：Skill 加列

[packages/shared/prisma/schema.prisma:127](packages/shared/prisma/schema.prisma:127)：

```prisma
model Skill {
  // …existing…
  displayVerb String?
  renderHints String?   // ← 新增。JSON: { livechat?: LivechatRenderHint, "web-chat"?: ... }
  // …
}
```

`npm run db:generate && npm run db:push`（生产用 migration）。

### 3.2 统一类型（修 B4）

`renderHints.livechat` 的**权威类型是 `LivechatRenderHint`**（字段路径型），不是通用 `RenderHint`。改 [types/index.ts:107](packages/shared/types/index.ts:107)：

```ts
import type { RenderHint } from '../channels/render-hints'
import type { LivechatRenderHint } from '../channels/render-hints'

export interface SkillDefinition {
  // …
  renderHints?: {
    livechat?: LivechatRenderHint
    'web-chat'?: RenderHint           // web 渠道仍可用通用 hint
    [channel: string]: RenderHint | LivechatRenderHint | undefined
  }
}
```

renderer 里就不必再 `as LivechatRenderHint` 强转了。

### 3.3 Loader：读 renderHints（修 B2）

[skills.ts:833-849](apps/chat/lib/agent/skills.ts:833) 在映射 DB skill 时加一行：

```ts
router.skills.set(s.name, {
  // …existing fields…
  displayVerb: s.displayVerb ? JSON.parse(s.displayVerb) : undefined,
  renderHints: s.renderHints ? JSON.parse(s.renderHints) : undefined,   // ← 新增
  isConcurrencySafe: s.isConcurrencySafe,
  enabled: s.enabled,
})
```

> KnowledgeSource 注入的 `kb_search_*` 工具（[skills.ts:859](apps/chat/lib/agent/skills.ts:859)）如果也想富渲染，同样给它们设一个默认 `renderHints.livechat`（比如 carousel 展示命中文档列表）。

### 3.4 业务工具适配器已就绪

[business-tool-adapter.ts:22](apps/chat/lib/agent/tools/business/business-tool-adapter.ts:22) 已经 `renderHints: def.renderHints`，会随 `tool.definition.renderHints` 经 [streaming-tool-executor.ts](apps/chat/lib/agent/streaming-tool-executor.ts) 回调，再到 loop.ts:429。**这条链一旦 §3.3 填上值就自动通**，无需改 executor。

### 3.5 配 hint 的写法（运营/开发都要懂）

`LivechatRenderHint` 用 **JSONPath 风格字段路径**从 skill 的返回 JSON 里取值（`$.` 前缀可选，见 [render-skill-by-hint.ts:68-79](apps/chat/channels/livechat/render-skill-by-hint.ts:68) 的 `readPath`）。

示例：`query_order_status` 返回
```json
{ "txnId": "TXU1_12345", "status": "pending", "amount": 500, "channel": "bKash" }
```
配一张 card（存进该 skill 的 `renderHints` 列）：
```json
{
  "livechat": {
    "kind": "card",
    "titleField": "$.txnId",
    "subtitleField": "$.status",
    "buttons": [
      { "id": "reissue", "postback": "reissue", "labelStatic": "申请补单", "type": "message" },
      { "id": "detail", "postback": "detail", "labelStatic": "查看详情", "type": "webview", "url": "https://intera-chat.up.railway.app/livechat-widget?case=${caseId}" }
    ]
  }
}
```
carousel（列表型结果，如多条订单 / KB 命中）：
```json
{
  "livechat": {
    "kind": "carousel",
    "itemsField": "$.results",
    "idField": "$.id",
    "itemTemplate": {
      "titleField": "$.title",
      "subtitleField": "$.snippet",
      "imageUrlField": "$.thumb",
      "buttons": [{ "id": "open", "postback": "open_doc", "labelStatic": "打开", "type": "url", "url": "$.url" }]
    }
  }
}
```
> carousel 的 button id 会自动拼成 `open_doc:<item.id>`（[render-skill-by-hint.ts:36](apps/chat/channels/livechat/render-skill-by-hint.ts:36)），postback 回流时就能区分点了哪条。

### 3.6 让运营能配（挂上孤儿编辑器，修 B6）

[skill-render-hints-editor.tsx](apps/console/components/admin/skill-render-hints-editor.tsx) 已能产 `LivechatRenderHint`，把它挂进 skills 编辑页：
1. 在 console 的 skill 编辑表单里 import 并渲染 `<SkillRenderHintsEditor value={...} onChange={...} mockFixture={skill.mockFixture}/>`。
2. 保存时把 `{ livechat: hint }` JSON.stringify 进 `Skill.renderHints` 列（走 skill 的 upsert API）。
3. 校验：填了 `card` 但 `titleField` 空时禁止保存（编辑器里加必填校验）。

> **备选方案（不加 Skill 列）**：复活 `ChannelBinding.toolOverrides` + `resolveHint`：bridge 读 `prisma.channelBinding`（customerId, 'livechat'）→ 填进 `RenderContext.binding.toolOverrides`（key=toolName）→ renderer 的 `skill_result` 分支改成 `resolveHint(d.renderHints, 'livechat', d.name, ctx.binding)`。好处是 per-channel 覆盖、不改 Skill 表；坏处是要把 `toolOverrides` 的类型也统一成 `LivechatRenderHint` 且 binding 持久化层要新写。**二选一即可，别两套并存。**

---

## 4. 接通通道 B：skill 结果 → 交互式 iframe widget

通道 A 是 LiveChat 原生卡片（静态、按钮回 postback）。当你需要**更复杂的交互**（订单时间线、KYC 进度、游戏列表多选、带本地校验的表单），用自家 iframe widget 渲染 skill 的结构化数据。

### 4.1 新增一个 widget payload kind：`skill_render`

[types.ts:29-64](apps/chat/lib/livechat/types.ts:29)：

```ts
export type WidgetPayloadKind =
  | 'status_track'
  | 'propose_interaction'
  | 'request_user_input'
  | 'skill_render'                       // ← 新增

export interface WidgetPayload {
  kind: WidgetPayloadKind
  caseId: string
  step?: StatusTrackStep
  options?: InteractionOption[]
  fields?: FormField[]
  // ↓ skill_render 专用
  template?: string                      // 模板名，如 'order_timeline' | 'kyc_status' | 'game_list'
  data?: unknown                         // skill 返回的结构化结果
  skill?: string                         // 来源 skill 名（埋点/调试）
}
```

### 4.2 renderer：把带 iframe hint 的 skill_result 转成 skill_render

给 `LivechatRenderHint` 增加一种 `iframe` kind（[render-hints.ts:43](packages/shared/channels/render-hints.ts:43)）：

```ts
export type LivechatRenderHint =
  | LivechatCardHint
  | LivechatCarouselHint
  | LivechatQuickRepliesHint
  | LivechatPlainHint
  | LivechatIframeHint                    // ← 新增

export interface LivechatIframeHint {
  kind: 'iframe'
  template: string                        // iframe 端按名渲染
  dataField?: string                      // 取 skill 结果的哪一段（默认整个 result）
}
```

renderer 的 `skill_result` 分支（[renderer.ts:52](apps/chat/channels/livechat/renderer.ts:52)）增加对 `iframe` 的处理（在 `renderSkillByHint` 之前判一下）：

```ts
if (livechatHint?.kind === 'iframe' && d.result !== undefined) {
  const data = livechatHint.dataField ? readPath(d.result, livechatHint.dataField) : d.result
  return [{
    type: 'send_widget_payload',
    payload: { kind: 'skill_render', caseId, template: livechatHint.template, data, skill: d.name },
  }]
}
```
（`readPath` 从 render-skill-by-hint 抽到一个共享小工具，或在 renderer 内联同款实现。）

### 4.3 iframe 端：按模板名渲染 + 回流

[livechat-widget/page.tsx](apps/chat/app/livechat-widget/page.tsx) 的 `processPayload`（[:288](apps/chat/app/livechat-widget/page.tsx:288)）加一个 case：

```ts
case 'skill_render':
  return { ...prev, view: 'skill_render', caseId: payload.caseId,
           template: payload.template ?? '', data: payload.data }
```

新增一个 `<SkillRender template data caseId onSubmit/>` 组件，内部按 `template` switch 出不同 UI。交互回流复用现成的 `sendToLiveChat('intera_interaction_submit', { caseId, optionId, input })`（[:104](apps/chat/app/livechat-widget/page.tsx:104)）：

```tsx
function SkillRender({ template, data, caseId, onSubmit }: {...}) {
  switch (template) {
    case 'order_timeline':
      return <OrderTimeline data={data} caseId={caseId}
        onAction={(id) => { sendToLiveChat('intera_interaction_submit', { caseId, optionId: id }); onSubmit() }} />
    case 'kyc_status':
      return <KycStatus data={data} caseId={caseId} onAction={...} />
    case 'game_list':
      return <GameList data={data} caseId={caseId}
        onSelect={(gameId) => { sendToLiveChat('intera_interaction_submit', { caseId, optionId: `pick_game:${gameId}` }); onSubmit() }} />
    default:
      return <pre className="text-[11px] p-3">{JSON.stringify(data, null, 2)}</pre>
  }
}
```

> **务必确认 iframe 的加载方式**（当前架构里这点最模糊，开工前先验证）：
> `livechat-widget/page.tsx` 用 `window.LiveChatWidget.on('new_event')`（**Customer Widget SDK**）接收 `intera_widget_payload` 自定义事件。这要求该 React 页面与 LiveChat widget 跑在同一上下文。两种正规落地：
> - **(a) Customer SDK 内嵌**：把这段渲染逻辑作为 widget 的一部分加载（你已有 dual-mode：`postMessage` 预览 + `LiveChatWidget` 事件，[:268-286](apps/chat/app/livechat-widget/page.tsx:268)）。
> - **(b) webview 按钮**：在 card 上放一个 `type:'webview'` 按钮（[livechat-api.ts:95](apps/chat/lib/livechat/livechat-api.ts:95) 已支持），`url` 指向 `…/livechat-widget?case=${caseId}`，点开后在 webview 里渲染 + 用 `send_event` 或 postMessage 回流。
> 先用 §3 的原生 card（最稳），iframe 作为进阶；上线前在真实 widget 里验证 (a)/(b) 哪条通。

---

## 5. 回流（postback / submit）参考

skill 渲染出的按钮/表单，用户操作后怎么回到 agent：

### 5.1 原生 rich_message 按钮（type=message）→ postback

```
用户点卡片按钮(type:message, postback_id="reissue:TXU1_12345")
   │ LiveChat 发 incoming_event type=rich_message_postback
   ▼ webhook ([route.ts:103](apps/chat/app/api/livechat/webhook/route.ts:103))
   { type:'postback', postbackId:'reissue:TXU1_12345' }
   ▼ bridge.buildMessagesBody ([bridge.ts:66](apps/chat/lib/livechat/bridge.ts:66))
   message = '[用户点击] reissue:TXU1_12345'
   ▼ /api/messages → agent 看到这句普通文本
```
**改进点**：现在 postback 退化成纯文本 `[用户点击] xxx`，agent 只能靠 prompt 理解。若要更可靠，把 postback 也走结构化通道——在 `buildMessagesBody` 里对 `postback` 解析 `id:arg` 并组成 `interactionResult`，让 `/api/messages` 走 [messages/route.ts:333](apps/chat/app/api/messages/route.ts:333) 的 `interactionResult` 分支（生成 `Tool propose_interaction result: {...}`），agent 当成工具结果处理，更稳。

### 5.2 iframe 提交 → custom 事件

```
iframe 调 sendToLiveChat('intera_interaction_submit', {caseId, optionId, input})
   │ → LiveChat send_event type=custom content.type='intera_interaction_submit'
   ▼ webhook ([route.ts:96](apps/chat/app/api/livechat/webhook/route.ts:96))
   { type:'interaction_submit', interaction:{caseId, optionId, input} }
   ▼ bridge.buildMessagesBody ([bridge.ts:60](apps/chat/lib/livechat/bridge.ts:60))
   { interactionResult: { caseId, optionId, input } }
   ▼ /api/messages ([messages/route.ts:333](apps/chat/app/api/messages/route.ts:333))
   userMessage = 'Tool propose_interaction result: {...}'  → agent 续跑
```
表单 `intera_form_submit` 同理走 `formResult` 分支（[messages/route.ts:315](apps/chat/app/api/messages/route.ts:315)）。**这条链已经是通的**，iframe 新模板直接复用即可。

---

## 6. 端到端示例：HTTP skill → carousel → 点按钮 → agent 续跑

目标：`query_order_status` 返回多笔订单，渲染成 carousel；用户点某笔的"申请补单"，agent 收到结构化意图继续处理。

1. **配 skill renderHints**（§3.1/3.5）：给 `query_order_status` 的 `Skill.renderHints` 存
   ```json
   {"livechat":{"kind":"carousel","itemsField":"$.orders","idField":"$.txnId",
     "itemTemplate":{"titleField":"$.txnId","subtitleField":"$.status",
       "buttons":[{"id":"reissue","postback":"reissue","labelStatic":"申请补单","type":"message"}]}}}
   ```
2. **agent 调用** `query_order_status` → loop 发 `skill_result`，`renderHints.livechat` 现在有值（§3.3 修好后）。
3. **renderer** 命中 carousel 分支 → `renderSkillByHint` → `BridgeAction{type:'send_carousel'}`。
4. **bridge** 调 `sendCarousel`（[bridge.ts:198](apps/chat/lib/livechat/bridge.ts:198)）→ LiveChat 展示横滑卡片。每个按钮 postback_id = `reissue:<txnId>`。
5. **用户点** TXU1_12345 的"申请补单" → §5.1 回流 → 建议按"改进点"组成 `interactionResult{optionId:'reissue', input:'TXU1_12345'}`。
6. **agent** 收到 `Tool propose_interaction result: {optionId:'reissue',input:'TXU1_12345'}`，按 prompt/case 逻辑发起补单 skill 或转人工。

---

## 7. 验收标准（本文档）

- [ ] Skill 表有 `renderHints` 列；loader 读取；类型为 `LivechatRenderHint`（B1/B2/B4 修复）。
- [ ] 给至少 1 个业务 skill 配了 `card`，1 个配了 `carousel`，在真实 widget 里看到富卡片（不是 status_track 文本）。
- [ ] Console skill 编辑页能配 renderHints 并保存生效（编辑器挂载，B6 修复）。
- [ ] quick_replies 仍正常（propose_cases 不回归）。
- [ ] iframe 新增 `skill_render` payload + 至少 1 个模板（如 order_timeline）能渲染并回流到 agent。
- [ ] postback / interaction_submit 回流后 agent 能续跑（结构化优先）。
- [ ] 单元测试：扩 [render-skill-by-hint.test.ts](apps/chat/lib/livechat/__tests__/unit/render-skill-by-hint.test.ts) 覆盖 card/carousel/quick_replies/iframe；扩 renderer.test 覆盖 skill_result 带 hint 的分支。

---

## 8. 涉及文件清单

**通道 A（rich message）**
- `packages/shared/prisma/schema.prisma`（Skill.renderHints 列）
- `packages/shared/types/index.ts`（SkillDefinition.renderHints 类型统一为 LivechatRenderHint）
- `apps/chat/lib/agent/skills.ts`（loader 读 renderHints）
- `apps/console/**`（skill 编辑页挂 SkillRenderHintsEditor + 保存到 Skill.renderHints）
- （备选）`packages/shared/channels/renderer.ts` resolveHint 接入 + bridge 读 ChannelBinding

**通道 B（iframe）**
- `apps/chat/lib/livechat/types.ts`（WidgetPayload 加 skill_render）
- `packages/shared/channels/render-hints.ts`（LivechatIframeHint）
- `apps/chat/channels/livechat/renderer.ts`（iframe 分支）
- `apps/chat/app/livechat-widget/page.tsx`（skill_render 视图 + 模板组件）

**回流改进**
- `apps/chat/lib/livechat/bridge.ts`（postback → interactionResult 结构化）

**不动**：render-skill-by-hint.ts（已可用，只是没被喂数据）；livechat-api 的 sendCard/sendCarousel/sendQuickReplies（已实现，注意补文档①的 `ignore_requester_presence`）。

---

## 参考来源（LiveChat / Text Platform 官方）

- rich message 类型（card 单卡 / carousel 多卡 / quick_replies 最多 11 个）、postback 机制：LiveChat Rich Messages 帮助文档
- rich_message / send_event 需 requester 在会话内（见文档 ①）：Agent Chat API changelog
