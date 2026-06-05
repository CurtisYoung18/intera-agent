# Playground Trace & UX Hardening Plan

> **For the coding agent team:** Architect hand-off. Dispatch sub-agents per the wave plan; one sub-agent per file (never two on the same file at once). Steps use `- [ ]`. The architect wrote the plan, **you write the code**, following the direction + acceptance below.

**Goal:** Make the Agent Playground's trace + transcript reflect reality — show the *effective* model, real token usage, the *actual* per-message lifecycle (not a static stage template), persistent per-message thinking, copy buttons on every data block, and a "Save to Chat" action that materializes a dry-run as a tagged test conversation.

**Architecture:** The Playground runs in-memory (`createMemoryPersistence()` — no DB writes) and streams SSE events → `trace-aggregator` → `playground/page.tsx`. Most fixes split into a **backend contract layer** (runner/aggregator/route emit richer, lifecycle-accurate data) and a **frontend layer** (`page.tsx` consumes it). Backend lands first so the FE has a stable contract.

**Tech stack:** Next.js 15 App Router · SSE · Prisma/Postgres · React (inline styles) · vitest.

---

## ⛔ Safety red line (inherited from project state)

Local `apps/console/.env.local` `DATABASE_URL` points at **production** Postgres via SSH tunnel. Items ①②a③④⑤ are **DB-safe** (Playground is in-memory). **②b (Save to Chat) WRITES to the DB** — its write-path acceptance MUST run against a **local** Postgres (docker-compose Postgres:16 + throwaway `DATABASE_URL` + `SESSION_SECRET` in `.env.test.local`), **never** prod. See `2026-06-04-google-invite-flow-hardening.md` Task 0 for the harness.

---

## Shared contract (all tasks align to this)

Extend `PlaygroundTraceStep` (`apps/console/lib/agent/trace-aggregator.ts`) and the run payload:

```ts
// trace-aggregator.ts
export interface PlaygroundTraceStep {
  stage: string
  source: TraceSource
  status: TraceStatus | 'skipped'
  fired: boolean              // NEW — did this stage actually execute this turn?
  ms: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number } // NEW — Model generation only
  summary: string
  detail: [string, string][]
  json?: object
  promptData?: { systemPrompt: string; messages: unknown[] }
}

// PlaygroundResult (playground-runner.ts) gains:
//   resolvedModel: string          // effective model actually used this turn
//   applicableStages: TraceStage[] // the pipeline this turn's path could involve
```

Rule the aggregator now obeys: **emit a stage iff it is in `applicableStages`.** `fired = (records.length > 0)`. Non-applicable stages (e.g. `Stage SOP` on a plain QA) are **never** emitted.

**Image/multimodal contract:** `ModelInfo` (`/api/admin/models`) gains `supportsVision: boolean`. The Playground `run` route input gains `contentBlocks?: ContentBlock[]` (base64 image blocks — `types/index.ts:28`); the runner forwards them as `agentLoop.run(message, sendEvent, contentBlocks)` — **the loop already supports images** (`loop.ts:177,202`), so this is wiring, not new runtime.

---

## WAVE 0 — Foundation (parallel; disjoint files)

### Task 0a — Reusable `<CopyButton>` (FE, new file)

**Files:** Create `apps/console/components/ui/copy-button.tsx`. Test: `apps/console/components/ui/__tests__/copy-button.test.tsx`.

- [ ] **Step 1 — Test first:** renders a button; on click calls `navigator.clipboard.writeText(text)` and flips to a "Copied ✓" state for ~1.5s. Assert the clipboard mock received the exact `text`.
- [ ] **Step 2 — Run, confirm fail.**
- [ ] **Step 3 — Implement:** `function CopyButton({ text, label }: { text: string; label?: string })` — small icon button (`lucide-react` `Copy`/`Check`), `aria-label`, inline-style consistent with existing trace pills (fontSize 9-10, `var(--fog)`). No external deps.
- [ ] **Step 4 — Run green. Commit:** `feat(ui): reusable CopyButton`.

**Acceptance:** component test green; copies exact text; shows copied state.

---

### Task 0b — Trace pipeline: lifecycle-accurate stages + real token usage (BE)

**Owns files:** `apps/console/lib/agent/trace-aggregator.ts`, `apps/console/lib/agent/playground-runner.ts`, `apps/console/lib/agent/trace.ts`, `apps/console/app/api/admin/playground/run/route.ts`. Test: `apps/console/lib/agent/__tests__/trace-aggregator.test.ts`.

**④ — applicable-only stages:**
- [ ] **Step 1 — Test first (aggregator):** given records for only `policy_hit` + `llm_request_start`/`llm_response`, and `applicableStages = ['Guardrails','Knowledge retrieval','Model generation']`, assert output contains exactly those 3 stages, `fired=true` for Guardrails + Model generation and `fired=false` for Knowledge retrieval, and **contains neither `Stage SOP` nor `Intent classification`** (the latter is dead — removed in Step 3b).
- [ ] **Step 2 — Run, confirm fail** (current code always returns all 6).
- [ ] **Step 3 — Implement:** change `aggregateTraces(traces, startTime, debug, applicableStages)` to iterate `applicableStages` instead of the hardcoded `allStages`; set `fired` from record presence; keep `status:'skipped'` for unfired.
- [ ] **Step 3b — Remove dead `intent_classify` / `Intent classification`** (deprecated 2026-05, **no producer** — `doc/spec/Intera_Harness_架构梳理.md:999`; intent routing now lives in Core Agent tools `propose_cases`/`create_case`). Delete the vestiges: `trace-aggregator.ts:7` (TraceStage union), `:30` (STAGE_MAP entry), `:89` (allStages); `trace.ts:26` (ActionType union); `playground-runner.ts:110` (listen-list) + the stub `intent` field (`PlaygroundResult.intent` at `playground-runner.ts:23,180,183` — **no consumers**). The `page.tsx:58` icon is removed in Task 1.
- [ ] **Step 4 — runner declares `applicableStages`:** in `playground-runner.ts`, derive the pipeline from the resolved path for the turn — base `['Guardrails','Model generation']` (Guardrails applicable iff guardrails are configured, `guardrailCount > 0`); add `'Knowledge retrieval'` if knowledge sources are bound; `'Skills & tools'` if tools are bound; `'Stage SOP'` **only** when the case/SOP loop is entered (`case-agent-loop.ts:505` is the sole `stage_eval` producer). **No `Intent classification`** (dead — Step 3b). Emit `applicableStages` on `PlaygroundResult`.

**③ — real token usage:**
- [ ] **Step 5 — capture usage:** at the LLM call site in the runner, capture `usage` from the provider response/stream (Anthropic-compatible: `message_start.usage.input_tokens`, `message_delta.usage.output_tokens`). Attach to the `llm_response` trace record's `usage` field (already typed in `trace.ts:186`).
- [ ] **Step 6 — aggregator attaches usage:** map `llm_response.usage` → the `Model generation` step's `step.usage = { inputTokens, outputTokens, totalTokens }`.
- [ ] **Step 7 — SSE passthrough:** ensure `run/route.ts` forwards `resolvedModel`, `applicableStages`, and per-step `usage` in the `trace` event (no stripping).
- [ ] **Step 8 — Test usage:** aggregator test — `llm_response` record with `usage:{input_tokens:120,output_tokens:40}` → Model generation step `usage.totalTokens === 160`.
- [ ] **Step 9 — Run green. Commit:** `feat(playground): lifecycle-accurate trace stages + real token usage`.

**⑨ image input — backend half** (the loop already supports `contentBlocks` — `loop.ts:177,202`; wire the Playground path + guard):
- [ ] **Step 10 — run route accepts images:** extend `run/route.ts` body to accept `contentBlocks?: ContentBlock[]` and forward to `runPlaygroundTurn(...)`.
- [ ] **Step 11 — runner forwards to loop:** `runPlaygroundTurn` passes them as the 3rd arg: `agentLoop.run(message, sendEvent, contentBlocks)`.
- [ ] **Step 12 — non-vision guard (defense-in-depth):** if `contentBlocks` includes an image AND the resolved model's `supportsVision` (Task 0h) is `false`, return `{ code:'unsupported_media', message:'<model> does not support image input' }` — a bypassed UI gate fails clearly, never silently. **Commit** `feat(playground): image input passthrough + non-vision guard`.

**Acceptance:** keyless `npm test` green; a plain "hi" turn yields a trace with **no Stage SOP and no Intent classification**; Model generation step carries real token counts; `grep -rn intent_classify apps/console` returns nothing.

---

### Task 0c — Resolve effective model (BE, DRY)

**Owns files:** `apps/console/app/api/admin/agent/route.ts` (the GET the page calls at `page.tsx:145`), a shared resolver, `packages/shared/types/index.ts` (snapshot/agent types). Test: route or resolver unit test.

- [ ] **Step 1 — Extract a single resolver** `resolveEffectiveModel(config): string` (the same default logic the runner uses when `config.model` is empty — confirm the current default, e.g. `DEEPSEEK_V4_FLASH`). Put it where both the agent route and `playground-runner` import it (DRY — one source of truth; today the chip and the runtime disagree).
- [ ] **Step 2 — Test:** config with `model:''` → resolver returns the real default name, not `''`/`Unknown`. Config with explicit model → returns it.
- [ ] **Step 3 — Wire:** `/api/admin/agent` response includes `resolvedModel`. Runner uses the same resolver for `PlaygroundResult.resolvedModel`.
- [ ] **Step 4 — Run green. Commit:** `fix(agent): expose resolved effective model (kill "Unknown" chip)`.

**Acceptance:** route returns a concrete `resolvedModel` for an agent with no explicit model.

---

### Task 0d — Save-to-Chat backend (BE, new feature, DB-write → local-only test)

**Owns files:** Create `apps/console/app/api/admin/playground/save-to-chat/route.ts`. Modify `packages/shared/prisma/schema.prisma` (+ migration). Test: `apps/console/app/api/admin/playground/__tests__/save-to-chat.test.ts`.

**Design (isolation is the point):**
- Add a `source String @default("live")` column to `Case` (values `live | playground`). Migration with a **distinct** prefix.
- New endpoint `POST /api/admin/playground/save-to-chat` via `defineRoute` (session auth, `requireRole:['admin','owner','operator']`): input = `{ agentId, messages: {role,content,thinking?}[], traces? }`. Creates one `Case` (`orgId` from session, `source:'playground'`, `type:'playground'`, a synthetic/test `userId`, generated `chatId`, `status:'resolved'`) + `Message` rows (and optional `ActionTrace` rows). Returns `{ caseId, chatId }`.
- **Bypass analytics side-effects:** do **not** touch `UserProfile` counters (`totalChats/totalCases/...`) or any dashboard rollup. This path only inserts the Case + Messages. Audit the write.

- [ ] **Step 1 — Test first** (against local DB): POST a 2-message transcript → 200 `{caseId}`; `SELECT source,type FROM cases WHERE id=…` → `playground/playground`; 2 message rows; **`user_profiles` row count unchanged**.
- [ ] **Step 2 — Run, confirm fail.**
- [ ] **Step 3 — Implement** schema field + migration + endpoint per Design.
- [ ] **Step 4 — Run green on LOCAL DB. Commit:** `feat(playground): save dry-run transcript as tagged test Case`.

**Acceptance (LOCAL DB ONLY):** endpoint creates a `source:'playground'` Case + messages; UserProfile untouched; appears in an org-scoped Case query.

---

### Task 0e — `<MessageContent>` markdown renderer (FE, new file — chat-app parity)

**Why:** AI replies are Markdown; the Playground renders raw text. The chat app already renders Markdown (`apps/console/app/ops/chats/[chatId]/page.tsx:95` — `<ReactMarkdown remarkPlugins={[remarkGfm]}>`). Extract ONE shared component so Playground + chat render **identically** (`react-markdown`/`remark-gfm` already installed — used by ops/chats).

**Files:** Create `apps/console/components/chat/message-content.tsx`. Modify `apps/console/app/ops/chats/[chatId]/page.tsx` to consume it (parity guarantee). Test: `apps/console/components/chat/__tests__/message-content.test.tsx`.

- [ ] **Step 1 — Test first:** `<MessageContent content={"**b**\n- a\n- b"} />` renders `<strong>` + a list; content starting with `"Tool "` renders `<pre className="whitespace-pre-wrap break-words">` (mirror chat's `isToolResult` special-case); raw HTML is NOT executed.
- [ ] **Step 2 — Run, confirm fail.** **Step 3 — Implement** `MessageContent({ content }: { content: string })` → react-markdown + remark-gfm; tool-result → `<pre>`. **Step 4 — repoint** ops/chats to it (output unchanged). **Step 5 — green. Commit** `feat(chat): shared MessageContent markdown renderer`.

**Acceptance:** gfm markdown (bold/list/code/table) renders; tool-result stays mono `<pre>`; ops/chats visually unchanged.

### Task 0f — `<RenderHintCard>` web-chat hint renderer (FE, new file)

**Why:** Playground only handles `form/card/quick_replies` and mixes channel contracts. The web-chat `RenderHint` union is `card|form|plain|list|image` (`packages/shared/channels/render-hints.ts:4`) — `plain/list/image` are unhandled. `request_user_input` → `form` must render **and be submittable** so dry-run flows continue (the messages route already accepts a request_user_input result: `apps/console/app/api/messages/route.ts:278`).

**Files:** Create `apps/console/components/chat/render-hint-card.tsx`. Test: `apps/console/components/chat/__tests__/render-hint-card.test.tsx`.

- [ ] **Step 1 — Test first:** a `form` hint with `result.fields=[{key,label,type,required}]` renders inputs + submit → `onSubmit(values)` fires with typed values; `card`/`list`/`image`/`plain` each render their contract shape.
- [ ] **Step 2 — fail. Step 3 — Implement** `RenderHintCard({ hint, result, onSubmit })` covering all 5 web-chat kinds (keep `quick_replies` if still emitted): `form` interactive; `card` title/subtitle/image/buttons; `plain` wrap quote/code/none; `list` bulleted/index; `image` urlPath/altPath. **Step 4 — green. Commit** `feat(chat): RenderHintCard for web-chat render hints`.

**Acceptance:** request_user_input form is interactive + submits; card/list/image/plain render per contract.

### Task 0g — shared status accents + `<StatusDot>` (FE, new file — chat-app parity)

**Why:** Chat-app status colors live in `apps/console/components/ops/case-trace-view.tsx:32` (`ACCENTS`): green `#2ea04a` (success / `skill_result` / resolved), red `#e64539` (`policy_hit` / block / fail), amber `#d4912e` (`skill_called` / `human_task` / **escalate** / in-progress), blue `#5b8af7` (llm / user). Playground lacks the amber escalate dot and uses a different system. Extract ONE accent source both use.

**Files:** Create `apps/console/components/chat/status-accents.tsx` (export `ACCENTS` + `StatusDot` + `statusColor(status)`). Modify `case-trace-view.tsx` to import from it (single source). Test: unit.

- [ ] **Step 1 — Test:** `statusColor('skill_result')==='#2ea04a'`, `statusColor('policy_hit')==='#e64539'`, escalate/`human_task`→`#d4912e`. **Step 2-3 — Implement** the map (copied verbatim from case-trace-view) + `<StatusDot status>` (rounded-full dot + lucide icon, mirroring `case-trace-view.tsx:351/365`); repoint case-trace-view to import it. **Step 4 — green. Commit** `refactor(chat): shared status accents (single source for trace dots)`.

**Acceptance:** success=green, fail=red, escalate/human-task=amber; case-trace-view renders unchanged.

### Task 0h — model vision capability flag (BE, models route)

**Why:** `ModelInfo` (`apps/console/app/api/admin/models/route.ts:8`) has no capability flag, so the UI can't tell which models accept images. OpenRouter multimodal (`openai/gpt-4o`, `google/gemini-*`) + Anthropic Claude support vision; MiniMax/DeepSeek (Anthropic-compatible text endpoints) do not.

**Owns file:** `apps/console/app/api/admin/models/route.ts`. Test: route unit test.

- [ ] **Step 1 — add `supportsVision: boolean` to `ModelInfo`** + set per model: `true` for `openai/gpt-4o`, `google/gemini-*`, `claude-*`; `false` for `MiniMax-*`, `deepseek-*`.
- [ ] **Step 2 — Test:** GET returns `supportsVision:true` for a Gemini/GPT-4o id, `false` for a MiniMax id.
- [ ] **Step 3 — green. Commit** `feat(models): supportsVision capability flag`.

**Acceptance:** `/api/admin/models` reports accurate `supportsVision` per model.

---

## WAVE 1 — Frontend (after Wave 0 contracts + CopyButton land)

### Task 1 — `playground/page.tsx` consumes everything (FE, single owner of this file)

**Owns file:** `apps/console/app/admin/playground/page.tsx` (one sub-agent — this file is the collision bottleneck; do all of ①②a③④⑤②b-button **+ ⑥ markdown / ⑦ hints / ⑧ status-dots** here, sequentially, consuming the Wave-0 components 0e/0f/0g).

- [ ] **① effective model chip** — `page.tsx:160`: set `modelLabel` from the agent route's `resolvedModel` (fallback to it; never `'Unknown'`).
- [ ] **②a persistent thinking** — change `chatMessages` item to `{ role, content, thinking? }` (`page.tsx:109`). On turn completion, archive the streamed `thinking` onto the agent message. In the history render loop, when `raw.showThinking` is on AND the message has `thinking`, render a `<details>` (default **collapsed**) ABOVE that message's bubble labeled `t('model.showThinking')`. Remove the floating ephemeral block (`page.tsx:523`) that currently sits below. Result: thinking is per-message, above the bubble, default-collapsed, never drowned.
- [ ] **③ token + step timing display** — in the trace panel, surface per-step `ms` (already present) and the Model generation step's `usage` (e.g. `↑120 ↓40 · 2700ms`). Repurpose the "Live activity" empty/header copy to show the turn's token+timing summary instead of only "Tools called by the agent will appear here."
- [ ] **④ lifecycle trace UI** — the aggregator now emits applicable-only stages with `fired`. Default render: only `fired` steps. Add a **"Show skipped (N)"** toggle that reveals `fired===false` (applicable-but-skipped) steps. Delete the old auto-collapse-empty logic (`page.tsx:246-255`, `812-867` empty handling) — it's superseded. Also delete the dead `intent_classify: Brain` icon mapping (`page.tsx:58`).
- [ ] **⑤ copy buttons** — drop `<CopyButton text={…}>` into `PromptViewer` (system prompt + each message), the debug JSON block (`page.tsx:876`), and the Model generation request. Every `<pre>`/data block gets one.
- [ ] **②b Save-to-Chat button** — near the top-right (by "Edit agent"): a button that POSTs `chatMessages` (+ thinking, + last turn traces) to `/api/admin/playground/save-to-chat`; on success show a toast linking to the chat. Disabled when transcript empty.
- [ ] **⑥ Markdown rendering** — render agent message content (both the streamed `reply` and archived history bubbles) via `<MessageContent>` (Task 0e) instead of raw text / `whiteSpace:pre-wrap`. User messages stay plain. Streaming partial markdown is fine.
- [ ] **⑦ renderHints via `<RenderHintCard>`** — replace the inline hint blocks (`page.tsx:721-784`) with `<RenderHintCard>` (Task 0f) covering all web-chat kinds. Wire the `request_user_input` form's `onSubmit(values)` to feed the next turn (POST as the user's reply — the messages route already accepts a request_user_input result), so the dry-run flow continues like the real chat.
- [ ] **⑧ status dots** — replace the liveTools icons (`page.tsx:696-701`) and behavior-trace status icons with `<StatusDot>` / shared `ACCENTS` (Task 0g): tool success = green, fail = red, **escalate / human-task = amber** — identical palette to the chat app.
- [ ] **⑨ image / multimodal input** — add an image attach button + paste-image handler in the composer; encode files as base64 `ContentBlock`s and send with the turn (0b run-route field). **Capability gate (design):** when the selected model's `supportsVision` (Task 0h) is `false`, **grey the button + tooltip** ("{model} doesn't support images — switch to a vision model, e.g. GPT-4o / Gemini"); if the user pastes an image anyway, show a **toast** with the same message (never silently drop). When `true`, attach + render image thumbnails in the user bubble. (0b Step 12 is the backend defense-in-depth fallback.)
- [ ] **Commit** after each sub-item (frequent commits): `feat(playground): <sub-item>`.

**Acceptance (manual, run the Playground — DB-safe except ②b):** chip shows real model; thinking sits above its bubble, default-collapsed, survives further turns, hidden when `showThinking` off; a "hi" turn shows no Stage SOP, "Show skipped" reveals applicable-but-skipped; Model generation shows token counts; every data block copies; "Save to Chat" (against LOCAL DB) creates a visible test chat.

### Task 1b — ops/chats "test" badge (FE, parallel with Task 1 — different file)

**Owns file:** the ops/chats list page under `apps/console/app/ops/chats/`. 

- [ ] Show a small **"test"** badge on Cases with `source:'playground'` so test transcripts are visually distinct from real customer chats. Confirm the list query returns `source`.
- [ ] **Commit:** `feat(ops): badge playground-sourced test chats`.

---

## Final verification

```bash
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # 0a/0b/0c/0d unit tests green
```
Then **manual Playground click-through** (the real UX acceptance) for ①②a③④⑤ **⑥⑦⑧** — incl. Markdown render of an AI reply, an interactive `request_user_input` form (fill + submit → flow continues) plus `card/list/image/plain` hints, and green/red/**amber-escalate** status dots matching the chat app; **image input on a vision model (GPT-4o/Gemini) → model sees the image, and the greyed button + tooltip/toast on MiniMax/DeepSeek** — and the **②b save → ops/chats** round-trip **on the LOCAL DB only**. Capture screenshots for the architect review.

## Self-review (architect)

- **Coverage:** ①→0c+T1 · ②a→T1 · ②b→0d+T1+T1b · ③→0b+T1 · ④→0b+T1 · ⑤→0a+T1 · ⑥markdown→0e+T1 · ⑦hints→0f+T1 · ⑧dots→0g+T1 · ⑨image→0h+0b+T1. ✅
- **Parity strategy:** ⑥⑦⑧ extract shared components (`components/chat/*`) reused by BOTH Playground and the chat app (ops/chats + case-trace-view) → identical experience by construction, single source of truth. Radiating points (ops/chats markdown, case-trace-view dots) are repointed to the shared components, not duplicated.
- **File-collision safety:** `page.tsx` is single-owner (Task 1). Backend tasks own disjoint files except `types/index.ts` (0c owns it) — if 0d needs a type, put it in its own route/contract file.
- **Ordering:** Wave 0 (0a‖0b‖0c‖0d) → Wave 1 (Task 1 ‖ Task 1b). Task 1 cannot start until 0a–0c contracts are committed; ②b-button needs 0d.
- **Out of scope (separate tickets):** auto-expiry/cleanup of saved test chats; cost estimation on top of token usage; making `applicableStages` configurable per case-type beyond bound/unbound detection.
