# S5 — Channel Binding

> **Wave 2, sub-project 5 of 6.** Part of the Intera-vs-CC alignment audit.
> **Depends on**: S4 (Tool interface — the `renderHints` field on tools is the seam this spec consumes).
> **Foundation for**: S6 (console renders the binding config; the trace viewer respects channel context).

---

## 0. The goal (one sentence)

> **Make the agent generic and channel-pluggable: a single canonical event stream from the engine flows through per-channel renderers that translate it into channel-native UX, so the same tool (e.g. `propose_interaction`) shows up as inline buttons in the chat widget, a rich card in LiveChat, and a block-kit message in Slack — without the engine knowing which channel it's serving.**

After S5:
- The engine emits **canonical** SSE events. No channel-specific shape leaks into the engine.
- Each channel has a **renderer** that consumes canonical events and produces channel-native UX actions.
- Per-tool **render hints** (from S4) let operators tune how each tool appears on each channel without writing renderer code.
- Operators configure **channel bindings** in `/admin/integrations` — which channels are active, channel-specific defaults, per-tool overrides.

---

## 1. Why this is needed

### 1.1 Today's shape

The engine emits SSE events with a typed `SSEEventType` ([packages/shared/types/index.ts:348](packages/shared/types/index.ts#L348)). Two consumers exist:

1. **Web chat widget** ([apps/chat/components/chat/](apps/chat/components/chat/)) — reads SSE directly, renders React components.
2. **LiveChat bridge** ([apps/chat/lib/livechat/](apps/chat/lib/livechat/)) — `event-translators.ts` is a per-event-type switch that maps `SSEEvent → BridgeAction` for the LiveChat API.

Two channels, two ad-hoc consumers. Adding Slack today means writing a third translator from scratch, copy-pasting the switch shape, and discovering inconsistencies between how each channel renders the same event.

### 1.2 What this prevents us from doing

| Want | Blocker |
|---|---|
| Same tool, channel-native UX (`propose_interaction` as buttons / rich card / block-kit) | No per-tool render hint plumbed through to the renderer — every tool renders identically per channel |
| Channel-specific limits (Slack block-kit max 50 blocks; WhatsApp max 3 quick replies) | No place to express channel constraints; renderer would have to silently clip |
| Operator-configurable channel binding (which channels active, per-tool defaults) | No `/admin/integrations` config beyond LiveChat credentials |
| Test a tool's rendering across channels without launching every channel | No isolated renderer to invoke against synthetic events |

### 1.3 Where this fits in CC's architecture

CC has one channel (REPL/Ink). Tool rendering is bundled into the tool itself via `userFacingName`, `renderToolUseMessage`, `renderToolResultMessage` — co-located with the tool's code.

Intera can't co-locate: the engine runs in `apps/chat`, the renderers live partly in `apps/chat/lib/livechat` (server-side bridge) and partly in `apps/chat/components/chat` (client-side React). We split:

- **What the tool owns** (S4): `renderHints` — a channel-keyed config record.
- **What the renderer owns** (S5): the actual translation from canonical event + render hint → channel-native action.
- **What the channel adapter ships** (S5): the renderer is per-channel; the dispatch loop is shared.

---

## 2. Design

### 2.1 The Channel abstraction

Already defined in S4 (`packages/shared/tools/tool.ts`):

```ts
export type Channel = 'web-chat' | 'livechat' | 'slack' | 'discord' | 'whatsapp'
```

S5 promotes this to a first-class concept with **capabilities** describing what each channel supports:

```ts
// packages/shared/channels/channel.ts (new)
export interface ChannelCapabilities {
  /** Whether the channel supports rich cards (buttons, images). */
  richCards: boolean
  /** Max number of buttons per card; null = unlimited. */
  maxButtonsPerCard: number | null
  /** Whether the channel can render markdown directly. */
  markdown: boolean
  /** Whether the channel supports forms (multi-field inputs). */
  forms: boolean
  /** Whether the channel can stream text deltas (true) or only full messages (false). */
  streaming: boolean
  /** Max plain-text message length; null = unlimited. */
  maxMessageChars: number | null
  /** Whether the channel supports inline images / attachments. */
  attachments: boolean
  /** Whether the channel exposes a typing indicator. */
  typingIndicator: boolean
}

export const CHANNEL_CAPS: Record<Channel, ChannelCapabilities> = {
  'web-chat':  { richCards: true,  maxButtonsPerCard: null, markdown: true,  forms: true,  streaming: true,  maxMessageChars: null, attachments: true,  typingIndicator: true  },
  'livechat':  { richCards: true,  maxButtonsPerCard: 11,   markdown: true,  forms: false, streaming: false, maxMessageChars: 4000, attachments: true,  typingIndicator: true  },
  'slack':     { richCards: true,  maxButtonsPerCard: 5,    markdown: false, forms: true,  streaming: false, maxMessageChars: 3000, attachments: true,  typingIndicator: false },
  'discord':   { richCards: true,  maxButtonsPerCard: 5,    markdown: true,  forms: false, streaming: false, maxMessageChars: 2000, attachments: true,  typingIndicator: false },
  'whatsapp':  { richCards: false, maxButtonsPerCard: 3,    markdown: false, forms: false, streaming: false, maxMessageChars: 1024, attachments: true,  typingIndicator: false },
}
```

The capabilities table is the renderer's contract. Renderers MUST respect their channel's caps — clip text, fall back from card to plain when not supported, etc.

### 2.2 Canonical event schema (already mostly canonical)

The 24 `SSEEventType` values stay. We tighten the `data` payloads so they're channel-agnostic:

| Event | Canonical payload (post-S5) |
|---|---|
| `text_delta` | `{ text: string }` |
| `tool_executing` | `{ toolName, displayVerb: { text, icon }, toolUseId }` |
| `skill_result` | `{ toolName, toolUseId, output, latencyMs }` |
| `interaction_proposed` | `{ title, description?, options: InteractionOption[], multiSelect?, toolUseId, renderHints? }` |
| `form_request` | `{ title, fields: FormField[], toolUseId, renderHints? }` |
| `case_created` / `case_status` / `finalized` | `{ caseId, status, summary? }` |
| `policy_blocked` | `{ toolName, policyNames: string[] }` |
| `escalated` | `{ reason, blocker? }` |

The `renderHints?` field on UI-bearing events is **populated by the engine** from the tool's `renderHints` (S4's `Tool.renderHints[channel]`). Channels that don't know what to do with a hint ignore it gracefully.

**Engine wiring (one-line addition in the executor's `skill_result` emission)**:

```ts
// in streaming-tool-executor.ts after S4
sendEvent({
  type: 'skill_result',
  data: {
    toolName: tool.name,
    toolUseId: t.id,
    output: t.result.output,
    latencyMs: t.result.latencyMs,
    renderHints: tool.renderHints,  // ← new
  },
  timestamp: new Date().toISOString(),
})
```

For chat-app SSE consumers (which see ALL channels' events), `renderHints` is the full per-channel dict. The renderer picks `renderHints[myChannel]`.

### 2.3 The `ChannelRenderer` interface

```ts
// packages/shared/channels/renderer.ts (new)
export interface ChannelRenderer<Action = unknown> {
  readonly channel: Channel
  readonly capabilities: ChannelCapabilities

  /**
   * Translate a canonical SSE event into one or more channel-native actions.
   * Returns [] when the event is irrelevant for this channel.
   */
  render(event: SSEEvent, ctx: RenderContext): Action[]

  /**
   * Optional setup/teardown for the channel's session lifecycle.
   * Web-chat: no-op. LiveChat: open SSE subscription. Slack: setup webhook.
   */
  init?(ctx: RenderContext): Promise<void>
  dispose?(ctx: RenderContext): Promise<void>
}

export interface RenderContext {
  caseId: string
  customerId: string
  /** Channel-specific session id (LiveChat thread id, Slack channel id, etc.). */
  sessionId: string
  /** Operator-configured binding (S5 §2.5). */
  binding: ChannelBindingConfig
}
```

Each renderer is a small module:

- `apps/chat/channels/web-chat/renderer.ts` — produces React-side actions (same shape as today's SSE consumer; mostly a passthrough).
- `apps/chat/channels/livechat/renderer.ts` — produces `BridgeAction[]` (refactor of today's `event-translators.ts`).
- `apps/chat/channels/slack/renderer.ts` — produces Slack `chat.postMessage` payloads (new, future).
- One per channel.

### 2.4 Tool render hints — concrete shape per tool

Per S4 §2.1, a tool exposes:

```ts
renderHints?: Partial<Record<Channel, RenderHint>>
```

S5 fills in the `RenderHint` schema concretely:

```ts
// packages/shared/channels/render-hints.ts (new)
export type RenderHint =
  | CardHint
  | FormHint
  | PlainHint
  | ListHint
  | ImageHint

export interface CardHint {
  kind: 'card'
  /** Where in the card layout the buttons go. */
  buttonStyle?: 'inline' | 'block' | 'quick-reply'
  /** Maps an option's id/label to a channel-specific button color or accent. */
  buttonAccent?: Record<string, 'default' | 'primary' | 'danger'>
  /** Optional channel-specific override of the title (rare; usually engine provides). */
  titleOverride?: string
}

export interface FormHint {
  kind: 'form'
  /** Whether to render fields in one screen (single) or paged (multi). */
  layout?: 'single' | 'multi'
  /** Submit-button label override. */
  submitLabel?: string
}

export interface PlainHint {
  kind: 'plain'
  /** Whether to wrap the output in a quote-block, code-block, or plain. */
  wrap?: 'quote' | 'code' | 'none'
}

export interface ListHint {
  kind: 'list'
  /** Show item index? Bullet style? */
  bulleted?: boolean
  showIndex?: boolean
}

export interface ImageHint {
  kind: 'image'
  /** Where to source the image URL in the tool output. JSON-pointer-ish. */
  urlPath: string
  /** Where to source the alt text. */
  altPath?: string
}
```

Example — `propose_interaction` built-in tool's render hints:

```ts
// apps/chat/lib/agent/tools/builtin/propose-interaction.ts
renderHints: {
  'web-chat':  { kind: 'card', buttonStyle: 'inline' },
  'livechat':  { kind: 'card', buttonStyle: 'quick-reply' },
  'slack':     { kind: 'card', buttonStyle: 'block', buttonAccent: { confirm: 'primary', cancel: 'danger' } },
  'whatsapp':  { kind: 'card', buttonStyle: 'quick-reply' }, // WA caps at 3 — renderer enforces
}
```

Example — `kb_hybrid_retrieve`'s output (citations):

```ts
renderHints: {
  'web-chat': { kind: 'list', bulleted: true, showIndex: false },
  'livechat': { kind: 'list', bulleted: false, showIndex: true },
  'slack':    { kind: 'list', bulleted: true, showIndex: false },
}
```

For **business tools** (DB-backed), `renderHints` is a nullable JSON column added in S4 Phase 4d. Operators edit it in the Skills page (S6 wires the editor).

### 2.5 Channel binding config — per-customer

```ts
// packages/shared/channels/binding.ts (new)
export interface ChannelBindingConfig {
  channel: Channel
  enabled: boolean
  /** Credentials / connection params — channel-specific shape. */
  credentials: unknown
  /** Per-tool overrides (operator can override a tool's render hints for this channel). */
  toolOverrides?: Record<string /* toolName */, RenderHint>
  /** Channel-wide defaults applied when a tool has no hint for this channel. */
  defaults?: {
    plain?: PlainHint
    card?: CardHint
    form?: FormHint
  }
  /** Optional skill access list — restrict which tools the engine can invoke
   *  when serving this channel. Useful for compliance (e.g. don't expose
   *  refund_money on a public web-chat). */
  channelSkillBinding?: string[]
}
```

Stored as one row per (customerId, channel) in a new table:

```
ChannelBinding {
  id              String  @id
  customerId      String
  channel         String  // 'web-chat' | 'livechat' | ...
  enabled         Boolean @default(false)
  credentials     String  // JSON (encrypted for secrets)
  toolOverrides   String? // JSON: Record<string, RenderHint>
  defaults        String? // JSON
  channelSkillBinding String? // JSON: string[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([customerId, channel])
}
```

**Resolution order** when rendering an event:

1. Look up `tool.renderHints[currentChannel]` (from S4).
2. If absent, look up `binding.toolOverrides[toolName]`.
3. If absent, look up `binding.defaults[hintKind]`.
4. If absent, use the renderer's hard-coded channel default.

This lets operators add render config without touching tool code OR override per-customer/per-channel for special cases.

### 2.6 `channelSkillBinding` — engine integration

When a case turn runs through the engine, the engine knows the active channel (`ctx.channel`, derived from the request entry point). Before building the tool set:

```ts
const tools = await resolveToolSet({ customerId, caseType, iteration, isSubAgent, policy })
const binding = await loadBinding(customerId, channel)
const channelFilteredTools = binding?.channelSkillBinding
  ? tools.filter((t) => t.source === 'builtin' || binding.channelSkillBinding!.includes(t.name))
  : tools
```

Built-in lifecycle tools (`create_case`, `finalize_case`, etc.) are NOT filterable — they're required for the engine to function. Only business tools and `dispatch_subagent` (cc mode) are gated by `channelSkillBinding`.

### 2.7 Refactoring existing channels

**Web chat widget**: today reads SSE in [`apps/chat/components/chat/message-list.tsx`](apps/chat/components/chat/message-list.tsx) and similar. After S5, a thin `WebChatRenderer` runs server-side, producing a typed `WebChatAction[]` that the client consumes via the existing SSE channel (just with cleaner discrimination on shape).

In practice the web-chat client today already handles the canonical events directly — so the renderer is mostly a passthrough plus the render-hint application. Estimated diff: ~200 lines refactor of the React components to consume the typed actions.

**LiveChat bridge**: [`apps/chat/lib/livechat/event-translators.ts`](apps/chat/lib/livechat/event-translators.ts) renames to `apps/chat/channels/livechat/renderer.ts`, exports a `LiveChatRenderer` that implements `ChannelRenderer<BridgeAction>`. The `translateSSEEvent` function becomes the `render` method body. **No behavioral change in Phase 5b** — just module relocation + interface conformance.

In Phase 5c, the renderer starts respecting `renderHints`:

```ts
case 'interaction_proposed': {
  const d = event.data as InteractionProposedData
  const hint = resolveHint('livechat', d.toolName, d.renderHints, binding) as CardHint
  if (hint.buttonStyle === 'quick-reply') return renderAsQuickReply(d)
  return renderAsCard(d)
}
```

### 2.8 New `/admin/integrations` channel binding UI

Extends Phase E of console-audit-v5 (channels landing grid). Today the LiveChat card has 4 form fields. After S5, clicking a channel card opens a detail page with three tabs:

```
LiveChat configuration
├ Connection      (existing credentials form)
├ Skill access    (channelSkillBinding multi-select; default = all enabled)
└ Render overrides
   • Tool: propose_interaction
       Channel default (livechat): card / quick-reply
       Override:         [card / quick-reply ▾]  [+ Reset to default]
   • Tool: kb_hybrid_retrieve
       Channel default (livechat): list / numbered
       Override:         [list / bulleted ▾]
   • [+ Add per-tool override]
```

Operators can preview a render hint's effect for a sample payload — S6 owns the preview component.

### 2.9 Sub-agents don't have a channel

Sub-agents run "headless" — they don't emit SSE to the user. Their outputs are merged into case memory and surfaced as `sub_agent_complete` events to the main flow, which the channel renderer handles like any other event. Tool render hints DO apply when a sub-agent calls a business tool (the tool's output rendering is decided by the channel of the parent case, not the sub-agent's "channel" — sub-agents have none).

---

## 3. Phasing

| Phase | What | Effort |
|---|---|---|
| **5a** | Define types in `packages/shared/channels/`: `Channel`, `ChannelCapabilities`, `CHANNEL_CAPS`, `RenderHint` union, `ChannelBindingConfig`. Prisma migration for `ChannelBinding` table. | 2 days |
| **5b** | Refactor LiveChat translator into `LiveChatRenderer` implementing `ChannelRenderer`. Module-relocation only — zero behavior change. CI green. | 2 days |
| **5c** | Wire `renderHints` resolution into both renderers (LiveChat + web-chat). Empty hints fall back to current behavior. Behavior diffs only when a tool defines a hint. | 3 days |
| **5d** | Add `renderHints` per built-in tool (9 tools after S4). Per-tool diff is small — most tools end up with `card` or `plain` hints. | 2 days |
| **5e** | Engine: wire `channelSkillBinding` filter into `resolveToolSet`. Trace event `channel_skill_filtered` emitted when a tool is filtered out. | 1 day |
| **5f** | `/admin/integrations` channel detail page — tabs (Connection / Skill access / Render overrides). Reuses the sentence-builder pattern from console-audit-v5 for overrides. | 4 days |
| **5g** | Slack renderer scaffold (the channel itself doesn't ship in S5 — but the module exists, with a TODO comment for future wiring). Proves the abstraction supports a new channel. | 1 day |

**Total: ~15 working days (≈3 weeks).**

Each phase is its own PR. 5a–5e are engine-side; 5f is console-side; 5g is forward-compat scaffolding.

---

## 4. Acceptance criteria

### 4.1 Unit tests
- [ ] `CHANNEL_CAPS` matches known channel limits (Slack 5 buttons, WhatsApp 3, etc.).
- [ ] `LiveChatRenderer.render` produces the same `BridgeAction[]` as today's `translateSSEEvent` for every event type (golden snapshot diff).
- [ ] Render-hint resolution order (tool > binding override > binding default > renderer default) covered by tests for each layer.
- [ ] `channelSkillBinding` filter excludes only business tools and `dispatch_subagent`; never built-ins.

### 4.2 Integration tests
- [ ] **Same engine event, two channels**: emit one `interaction_proposed` event; verify the LiveChat renderer produces quick-reply payload and the web-chat renderer produces card payload — both for the same canonical event.
- [ ] **Per-tool override via binding**: configure `binding.toolOverrides.propose_interaction = { kind: 'card', buttonStyle: 'block' }`. Verify LiveChat renderer produces block-style payload despite the tool's default being `quick-reply`.
- [ ] **`channelSkillBinding` filter**: customer with `channelSkillBinding: ['get_account_status']` on the livechat binding. Engine tool set for a livechat case excludes other business tools. Trace event `channel_skill_filtered` fires once per excluded tool per case turn.
- [ ] **Slack scaffold**: `SlackRenderer.render` for an `interaction_proposed` event returns a stubbed block-kit shape with the correct buttons. Channel is gated as "coming soon" — not actually dispatched.

### 4.3 Production smoke (1 week)
- [ ] No regression in LiveChat behavior — golden trace diff zero meaningful changes.
- [ ] No regression in web-chat behavior.
- [ ] Console operators can configure a per-tool override and see it reflected in a real chat session.

---

## 5. File map

### New
- `packages/shared/channels/channel.ts` — `Channel`, `ChannelCapabilities`, `CHANNEL_CAPS`.
- `packages/shared/channels/render-hints.ts` — `RenderHint` union types.
- `packages/shared/channels/binding.ts` — `ChannelBindingConfig`.
- `packages/shared/channels/renderer.ts` — `ChannelRenderer` interface, `RenderContext`, `resolveHint` helper.
- `apps/chat/channels/web-chat/renderer.ts` — `WebChatRenderer`.
- `apps/chat/channels/livechat/renderer.ts` — `LiveChatRenderer` (moved from `lib/livechat/event-translators.ts`).
- `apps/chat/channels/slack/renderer.ts` — scaffold.
- `apps/chat/channels/__tests__/*.test.ts` — per-renderer.
- `apps/console/app/admin/integrations/[channel]/page.tsx` — channel detail page with tabs.
- `apps/console/app/api/admin/channel-bindings/route.ts` + `[channel]/route.ts` — CRUD.
- Prisma migration `<ts>_channel_binding`.

### Modified
- `apps/chat/lib/agent/streaming-tool-executor.ts` — emit `renderHints` in `skill_result` payloads.
- `apps/chat/lib/agent/loop.ts` — emit `renderHints` in `interaction_proposed` / `form_request` / similar.
- `apps/chat/lib/livechat/bridge.ts` — consumes `LiveChatRenderer` instead of `translateSSEEvent` directly.
- `apps/chat/components/chat/*.tsx` — consume render-hint-aware actions where relevant (mostly `interaction-card.tsx`, `form-card.tsx`, `agent-progress-card.tsx`).
- `apps/console/app/admin/integrations/page.tsx` — channel landing grid links to channel detail pages.
- `packages/shared/types/index.ts` — `SSEEvent.data` payload shapes tightened (renderHints fields added where applicable).
- `apps/console/components/admin/skills` — Skills page editor for business tools gains a "Render hints" section.

### Untouched
- Engine loop structure (S3).
- Tool execution semantics (S4).
- Existing SSE event types — only `data` payloads are tightened, never removed.

---

## 6. Risk + rollback

**Risk 1**: web-chat refactor breaks subtle React rendering. *Mitigation*: 5b–5c land the renderer as a *parallel* path behind `INTERA_CHANNEL_RENDERERS=1`. Both paths run side-by-side in staging for one week before the old path is removed.

**Risk 2**: per-tool render hints become a sprawl — operators add overrides faster than they can audit. *Mitigation*: the console editor shows a "Hint resolution chain" preview (tool default → binding override → binding default → renderer default) so operators see exactly what fires.

**Risk 3**: `channelSkillBinding` accidentally locks out a tool the engine needs. *Mitigation*: built-in tools are never filterable. `dispatch_subagent` filterability is gated on a confirm dialog. Trace event names every excluded tool per turn.

**Risk 4**: LiveChat's quick-reply rendering changes mid-deploy and causes a customer-visible regression. *Mitigation*: golden-trace snapshot tests for LiveChat. PR diff shows BridgeAction-by-BridgeAction parity.

**Rollback**: each phase is squash-revertable. The new `ChannelBinding` table is additive — engine reads it lazily; if absent, falls back to the old "everything goes" behavior.

---

## 7. Open questions (for product confirmation)

### 7.1 Channel taxonomy

Locked five channels: `web-chat`, `livechat`, `slack`, `discord`, `whatsapp`. Each customer-service vendor has its own opinion on what's first-class. If you have a target channel I missed (Telegram, WeChat, Messenger, Line, native iOS/Android SDK), say so — adding one is one row in `CHANNEL_CAPS` plus a renderer module.

### 7.2 Should `channelSkillBinding` be allowlist or denylist?

Defaulted to **allowlist** (binding declares which tools are exposed). Alternative: denylist (binding declares which are blocked, default = all). Allowlist is safer for compliance ("we KNOW only these tools are exposed on LiveChat") but operationally heavier ("we forgot to add a new business tool to the list and it's invisible on LiveChat for a week"). Pick one before 5e lands.

### 7.3 Where do channel **credentials** live?

Today LiveChat's `botAccessToken` is in the `LiveChatConfig` table separately. After S5, all channel credentials live in `ChannelBinding.credentials`. Migration moves the LiveChat data; deprecates the old table. Worth a confirm — does any other code path read `LiveChatConfig` directly?

### 7.4 Sub-agent → channel association

Confirmed in §2.9: sub-agents have no channel; their outputs flow through the parent case's channel. But — a sub-agent might invoke a tool whose render hint changes the UI mid-investigation. That's correct behavior (the user sees the right rendering for their channel), but worth verifying with one real case before 5d ships.
