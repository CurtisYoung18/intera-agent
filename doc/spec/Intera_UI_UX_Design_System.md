# Intera UI/UX Design System

**Last updated:** 2026-06-09
**Status:** CURRENT companion source of truth for the Console UI/UX reset
**Audience:** founder, architect, UI/UX lead, frontend lanes, AI coding teams
**Related architecture:** [`Intera_Harness_架构梳理.md`](./Intera_Harness_架构梳理.md)
**Related implementation plan:** [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md)

This document freezes the owner-approved UI/UX direction for Intera before the commercial delivery reset. It should guide route structure, layout, design tokens, component behavior, i18n, and UI refactor lane ownership.

---

## 0. Owner decisions frozen in this session

### 0.1 Product shell

- The logged-in first screen is **Build -> Pilot Lab**, not an analytics dashboard or release dashboard.
- Top-level navigation has exactly three blocks:
  - `Build`
  - `Operate`
  - `Settings`
- `Delivery` and `Operations` are collapsed into `Operate`.
- `Integrations` belongs under `Build`, not `Settings`.
- `Agent versions` belongs under `Build -> Release`.
- `Blueprint` is removed as a product concept for the first launch.
- `Case` is not a standalone product concept for first launch. Conversation and handoff detail should show Chat, User, ProcedureRun, HumanTask, Trace, and Memory context.

### 0.2 Build structure

`Build` has three main destinations:

- `Release`
- `Pilot Lab`
- `Components`

`Components` is one workspace with six second-level subroutes:

- `Brain`
- `Procedures`
- `Tools`
- `Hooks`
- `Knowledge`
- `Integrations`

Each Component subroute owns its own URL, fetch/save lifecycle, dirty state, test panel, and frontend file boundary. Do not put all six into one giant stateful page.

### 0.3 Operate and Settings structure

`Operate` has only:

- `Conversations`
- `Human Handoff`

`Settings` has only:

- `Organization`

Members, organization defaults, billing placeholders, and language defaults belong inside `Organization` until the product needs a deeper settings IA.

### 0.4 ConfigPilot

ConfigPilot is a first-class product surface:

- No global right-side assistant drawer in P0. ConfigPilot lives in `Pilot Lab` as the primary workspace.
- `Pilot Lab` has two main tabs:
  - `Pilot`: the default ChatGPT-like agent-building cockpit.
  - `Playground`: manual dry-run testing and trace/debug workspace.
- Can generate draft Tools, Hooks, Procedures, Test Scenarios, and package changes.
- Can apply draft configuration only through `proposal -> diff -> confirm -> typed API save`.
- Cannot publish live versions.
- Existing Playground dry-run and Trace Sidebar capability must be preserved and embedded under the `Playground` tab before any old standalone Playground route is removed.

### 0.5 Release and validation

`Release` is the Build command center:

- Shows current live version.
- Shows draft changes grouped by component.
- Shows recent Scenario receipts.
- Owns Package actions: Publish, Rollback, Import, Export, Duplicate Version.
- Supports explicit `Publish`; autosave/save draft never affects live.
- Supports at most five historical Agent versions per Agent.
- Uses a soft publish gate: if no passing receipt exists, show warning and require an override reason, but do not hard-block first launch.

### 0.6 Testing model

- Component-level tests live on Component pages.
- Agent-level building and validation live in `Pilot Lab`.
- `Pilot` is the chat-first Agent-building workflow: ask, propose, diff, accept, apply, and optionally run validation.
- `Playground` is manual ad hoc testing/debug: the operator sends messages directly, runs dry-run, and inspects Trace/Evidence.
- `Scenarios` are saved repeatable tests.
- `Receipts` are validation records and commercial proof artifacts.
- `Run timeline` / `Trace` / `Evidence checkpoints` are the product terms for breakpoint-like debugging. Do not call these "breakpoints" in operator UI.

### 0.7 i18n

- Product UI supports standard SaaS language switching: `en-US` and `zh-CN`.
- User/profile can switch language.
- Organization can set a default language.
- Product chrome, labels, buttons, empty states, errors, and system tags are localized.
- Business configuration content is not auto-translated: prompts, Procedure text, Hook rules, Tool descriptions, Knowledge content, Scenario inputs/outputs, and customer messages remain in the language chosen by delivery staff.
- Package schema, code fields, IDs, and API contracts remain English.

### 0.8 Responsive scope

- Desktop-first.
- 1440px and 1280px are the primary design targets.
- 1024px tablet should remain usable.
- Mobile is read-only / light-action only: login, Release status, Conversations, and Handoff. Complex editing may show an "open on desktop" state.

### 0.9 Approved motion and brand assets

Use the owner-provided local design references for brand and AI-generation motion:

- Logo / identity motion source: `/Users/curtis/Desktop/design/Globe loader`
  - Prefer `Context Lens Logo Animation.html` as the motion reference.
  - Frame screenshots under `screenshots/` can be used as static/logo-frame references.
- AI generation loading motion for Playground and Pilot Lab: `/Users/curtis/Desktop/design/Organic Loaders (standalone).html`
  - Approved loader variants: `01`, `02`, `05`, `06`, `10`, `11`, `12`, `17`, `20`.
  - Use these only for AI generation / thinking / running states, not ordinary page skeleton loading.
- AI generation text streaming for Playground and Pilot Lab: `/Users/curtis/Desktop/design/Text streaming (standalone).html`
  - Approved text animation: `07 token stream`.
  - Use for model/token output streaming states.

Implementation note: these Desktop paths are design sources, not runtime dependencies. When implementing, copy or recreate the minimal needed SVG/CSS/animation primitives into the app codebase or asset pipeline, preserve reduced-motion behavior, and keep product surfaces light-first.

---

## 1. UX thesis

Intera is not a generic admin console. It is an **Agent Studio for customer-service delivery**.

The primary user is an implementation / delivery person who needs to turn an industry template into a real customer Agent quickly, validate it, publish it, and understand failures. The UI should make configuration feel precise and trustworthy while still giving the product a modern, agentic personality.

The product should feel like:

```text
quiet enterprise editor
  + focused light agent workbench
  + trustworthy diff and receipt system
  + fast command-driven navigation
```

It should not feel like:

- a generic SaaS dashboard full of cards
- a marketing landing page
- a flowchart-first chatbot builder
- a dark neon AI toy
- a CRM/task-management clone

---

## 2. Information architecture

### 2.1 Target route map

Use this as the UI refactor target after the Foundation Reset contracts and Hook/Tool vocabulary stabilize.

| Block | Target route | Purpose |
|---|---|---|
| Build | `/build/release` | Version, draft changes, receipts, package actions. |
| Build | `/build/pilot-lab` | Default landing page. Two-tab cockpit: Pilot chat for building, Playground for manual dry-run testing and trace. |
| Build | `/build/components/brain` | Model, prompt, memory. |
| Build | `/build/components/procedures` | Procedure types and ProcedureStep Hook bindings. |
| Build | `/build/components/tools` | HTTP, Static Fixture, System Managed Tools, test panel, Tool Hook bindings. |
| Build | `/build/components/hooks` | Hook library, builder, binding manager, Hook simulation. |
| Build | `/build/components/knowledge` | GPTBots connection, KB binding, read-only documents/status, retrieval test. |
| Build | `/build/components/integrations` | LiveChat, Web Chat, API Access, channel sample payloads. |
| Operate | `/operate/conversations` | Inbox, conversation detail, ProcedureRun context, Trace. |
| Operate | `/operate/handoff` | Human task queue, handoff metrics, handoff detail. |
| Settings | `/settings/organization` | Organization profile, members, default locale, workspace-level preferences. |

### 2.2 Current-to-target route migration

| Current route | Target route |
|---|---|
| `/admin/playground` | `/build/pilot-lab` |
| `/admin/model` | `/build/components/brain` |
| `/admin/memory` | `/build/components/brain` |
| `/admin/case-types` | `/build/components/procedures` |
| `/admin/tools` | `/build/components/tools` |
| `/admin/guardrails` | `/build/components/hooks` after `guardrails` redirects to Hooks |
| `/admin/hooks` | `/build/components/hooks` |
| `/admin/knowledge` | `/build/components/knowledge` |
| `/admin/integrations` | `/build/components/integrations` |
| `/ops/chats` | `/operate/conversations` |
| `/ops/dashboards` | Remove as standalone first-launch page; fold relevant metrics into Handoff or Conversations. |
| `/ops/users` | Remove as standalone first-launch page; show customer/user context inside Conversations. |
| `/admin/organization` | `/settings/organization` |

Route redirects may exist for old links, but new navigation, docs, tests, and screenshots should use the target IA.

---

## 3. Page behavior

### 3.1 Build -> Release

Release is the Build command center.

Primary jobs:

- Understand what is live.
- Understand what has changed.
- Understand whether validation is fresh.
- Publish or rollback deliberately.
- Import/export `.intera-agent.json`.
- Own package actions. Pilot may suggest import/export/duplicate flows, but Release is where the operator executes package actions.

Required sections:

| Section | Required content |
|---|---|
| Live Version | version id/name, published at, publisher, status, rollback action |
| Draft Changes | grouped by Brain, Procedures, Tools, Hooks, Knowledge, Integrations |
| Validation Receipts | latest passing/failing Scenario receipts and changed-since-validation badge |
| Package Actions | Publish, Rollback Preview, Export, Import, Duplicate Version |
| Pilot Entry | link into Pilot Lab with current release/package context and contextual prompt suggestions |

Do not show broad operational KPIs here. ProcedureRun count, handoff rate, and queue metrics belong in Operate.

### 3.2 Build -> Pilot Lab

Pilot Lab is the Agent-level workbench and the logged-in default route.

Primary tabs:

- `Pilot`: ChatGPT-like configuration cockpit. Delivery staff chat with Pilot to create or modify Brain, Procedures, Tools, Hooks, Knowledge refs, Integrations refs, Scenarios, and package drafts. The center is a conversation stream and composer; the right panel shows proposed changes, diff, accept/reject/apply controls, missing information, and relevant receipts.
- `Playground`: manual testing/debug cockpit. Preserves the current Playground dry-run AgentLoop path, Trace Sidebar, tool/hook evidence, and transcript-saving behavior where supported. Use it when the operator wants to test the Agent directly instead of asking Pilot to change config.

Supporting panels:

- Recent Scenario receipts.
- Runtime-backed vs fixture-only validation labels.
- Trace / Evidence panel for dry-run and Scenario execution.

Testing/debug model:

- `Pilot` answers "help me build or change the Agent." It can propose config patches and trigger validation, but every write requires explicit accept/apply.
- `Playground` answers "let me test this Agent manually." It is the place for multi-turn stuck-state debugging, dry-run Tool checks, Hook decision checks, ProcedureRun step inspection, and manual transcript testing.
- `Scenario` answers "prove this behavior keeps working." It stores repeatable cases and generates receipts.
- `Run timeline` answers "what happened in this run?" It should show Procedure, Tools, Hooks, Memory, Response, and Reconcile evidence in chronological or grouped form.
- A user stuck after multiple turns should be debugged by replaying or continuing the chat in Playground and inspecting the Run timeline. The product should make Tool/Hook/ProcedureRun effects visible without exposing code-level breakpoint language.

Rules:

- ConfigPilot may propose and apply drafts, but never publish.
- Every applied ConfigPilot change must pass through Diff Viewer.
- Scenario receipts must show Tool calls, Hook decisions, Knowledge hits, human transfer, and final response expectations where available.
- Failed receipts should be useful as debugging artifacts, not only pass/fail badges.
- Do not delete `/admin/playground`, `/build/playground`, `/api/admin/playground/run`, or `TraceSidebar` until the Pilot Lab `Playground` tab has proven equivalent dry-run and trace behavior with tests and browser smoke. Hiding old routes from navigation is acceptable; deleting capability is not.

### 3.3 Build -> Components

Components is a workspace shell with six independent routes.

Shared rules:

- Each Component route has explicit `Save draft`.
- No field-level server autosave.
- Each route owns local dirty state.
- Each route has a local test/simulation panel where applicable.
- Local tests validate the component, not publish readiness.
- Component pages can link to Pilot Lab with the current object/context; they should not mount a global ConfigPilot drawer.

#### Brain

Scope:

- Model
- Prompt
- Memory

Out of scope:

- Blueprint summary
- legacy assistant summary
- scattered Agent Config meta panels

Local test:

- Prompt preview.
- Sample response using selected model where feasible.

#### Procedures

Scope:

- Procedure types.
- Ordered Procedure steps.
- Step detail panel.
- ProcedureStep Hook picker/binding panel.

Layout:

- Left: Procedure type list.
- Center: ordered step list.
- Right: selected step detail and Hook bindings.

Do not use a flowchart canvas in the first launch. The Procedure is a soft ordered guide, not a rigid workflow graph.

#### Tools

First-launch Tool kinds:

- HTTP Tool.
- Static Fixture Tool.
- System Managed Tool.

Required panels:

- Tool list.
- Tool editor.
- Request/test panel.
- Static fixture editor.
- Hook bindings for the Tool scope.

OpenAPI/Swagger import:

- ConfigPilot may parse API docs and generate Tool drafts.
- Generated drafts still go through Diff Viewer before save.

#### Hooks

Scope:

- Hook library.
- Hook builder.
- Binding manager.
- Hook simulation.
- Visual binding relationship across agent, Procedure type, ProcedureStep, and Tool scopes.

Handler kinds:

- Declarative.
- Restricted JavaScript code.
- HTTP.

Do not call the page Guardrails or Policies in new UI.

#### Knowledge

First-launch GPTBots-dependent scope:

- GPTBots connection.
- Knowledge base binding.
- Read-only document/status view.
- Retrieval test.

Out of scope for first launch:

- Document CMS.
- Upload/delete/re-embed UI.
- Knowledge authoring.

Those APIs may exist in GPTBots, but Intera should not turn Knowledge into a full CMS before the customer delivery loop is stable.

#### Integrations

Scope:

- LiveChat.
- Web Chat.
- API Access.

API keys belong here as channel/access integration settings, not in Settings.

Human handoff configuration points:

- `create_human_task` Tool belongs in Tools.
- Handoff trigger logic belongs in Hooks.
- Handoff timing belongs in Procedures.
- LiveChat group/target belongs in Integrations.
- Operate -> Human Handoff observes and triages, but does not own configuration.

### 3.4 Operate -> Conversations

Use an Inbox + Detail + Trace layout.

Required structure:

- Left: conversation inbox, statuses `active`, `waiting_human`, `resolved`.
- Center: transcript.
- Right: ProcedureRun context, current Procedure type, Procedure step, handoff task if any.
- Expandable trace: Tool calls, Hook results, Knowledge hits, Procedure notes.

The page should answer:

- What conversations need attention?
- Why did the Agent reply or transfer?
- Who needs to take over?

### 3.5 Operate -> Human Handoff

Keep first launch lightweight: Queue + Metrics + Detail.

Required structure:

- Queue of `waiting_human` tasks.
- Metrics: handoff rate, average wait, top triggering Hooks, top ProcedureSteps.
- Detail: linked conversation, ProcedureRun context, handoff reason, target group/operator.
- Configuration shortcuts to Build pages.

Do not build a full task-management, SLA, approval, or scheduling system in the first launch.

### 3.6 Settings -> Organization

Scope:

- Organization profile.
- Members.
- Default locale.
- Basic workspace preferences.
- Future billing/security placeholders only if they do not distract from the first commercial delivery.

---

## 4. Core product components

### 4.1 App Shell

Structure:

- Global top navigation: Build, Operate, Settings.
- Left rail changes by selected block.
- Components workspace has an additional local nav for Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
- No global ConfigPilot drawer in P0. Pilot is opened through the main `Pilot Lab` route.

The shell should feel calm and spacious. Avoid nested cards, stacked dashboards, and decorative background blobs.

### 4.2 Command Bar

Required in first launch.

Activation:

- `Cmd+K` on macOS.
- `Ctrl+K` on Windows/Linux.

Capabilities:

- Search Agent config objects: Procedure, Tool, Hook, Knowledge source, Integration.
- Quick create: New Tool, New Hook, New Procedure Step, New Test Scenario.
- Quick action: Run Test Scenario, Open Diff, Export Package.
- Open Pilot Lab with current page/object context.

Visual:

- Centered overlay.
- Fast keyboard navigation.
- High-contrast selected row.
- No traditional dashboard search box as the primary command surface.

### 4.3 Pilot Chat Cockpit

Pilot:

- Lives in Pilot Lab.
- Default logged-in workspace.
- Chat-first, input-forward UI similar to ChatGPT/Claude.
- Supports longer configuration generation and multi-object proposals.
- Shows generated drafts before diff.
- Uses a right-side work panel for current context, proposed changes, diff, accept/reject/apply, receipts, and missing information.

Playground:

- Lives as the second Pilot Lab tab.
- Preserves the existing dry-run AgentLoop execution path.
- Preserves Trace Sidebar / evidence visualization.
- Supports manual test messages, dry-run Tool evidence, Hook decision visibility, and saved test transcript behavior where currently available.

Rules:

- No direct DB writes.
- No live Publish.
- All Apply actions require Diff Viewer and typed API save.

### 4.4 Config Diff Viewer

Diff is a first-class trust object.

Used by:

- ConfigPilot Apply.
- Release Publish.
- Package Import.
- Rollback Preview.

Required behavior:

- Group changes by Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
- Mark added, changed, removed fields.
- Show natural-language summaries for HookBinding and ProcedureStep changes.
- Make high-risk changes visible: Stop Hooks, Tool endpoint edits, HTTP Hook endpoint edits, human handoff triggers.
- Allow confirm/cancel.
- Publish diff may require override reason if validation is stale.

Preferred visual:

- Deep workspace surface.
- Structured two-column or grouped diff layout.
- Clear status language over decorative motion.

### 4.5 Trace Panel

Trace should be explainable, not noisy.

Primary label:

- Use `Run timeline` in operator-facing UI.
- Use `Trace` or `Raw trace` for deeper technical/debug panels.
- Use `Evidence checkpoints` for grouped proof points in receipts.
- Avoid `breakpoint` in product copy; it is an implementation analogy, not an operator concept.

Required trace groups:

- Procedure step.
- Tool call/result.
- Hook checkpoint and decision.
- Knowledge hit.
- Human handoff event.
- Stop retry if any.
- Memory read/write evidence where relevant.
- Reconcile/stale-input evidence where relevant.

Trace is most useful in Pilot Lab receipts and Operate conversation detail. Do not make traces dominate ordinary configuration pages.

### 4.6 Receipt Card

Receipt cards are validation artifacts.

Required content:

- Scenario name.
- Run status.
- Version/draft identity.
- Started/finished time.
- Expected vs actual summary.
- Tool/Hook/Knowledge/handoff evidence.
- Link to full trace.

Receipts should look deliberate and credible. They are a commercial delivery proof object.

### 4.7 Component Test Panel

Each Component page may include a local test panel:

| Component | Local test |
|---|---|
| Brain | prompt preview / sample response |
| Procedures | step simulation / Hook binding preview |
| Tools | request test / fixture result |
| Hooks | Hook simulation / binding impact |
| Knowledge | retrieval test |
| Integrations | connection test / sample payload |

Local tests do not replace Pilot Lab receipts.

---

## 5. Visual direction

### 5.1 Theme name

The first-launch theme is:

```text
Quiet Agent Studio
```

No theme switching in first launch. Add `theme.mode = light | dark | system` only after the commercial workflow is stable.

Intera Console is light-first across the entire app in P0. Use the same warm light shell and graphite typography everywhere:

- Release
- Pilot Lab
- Components
- Operate
- Settings
- Pilot Chat Cockpit
- Scenario receipts
- Trace panels
- Diff Viewer

Do not create dark immersive workspaces in P0. Use contrast through spacing, row grouping, subtle tint, dividers, density, and status color instead of dark product surfaces.

Small dark elements are allowed only when functionally useful:

- code editor area
- JSON preview
- terminal-like raw trace payload

### 5.2 Reference mix

Use this moodboard weighting:

| Reference | Weight | What to borrow |
|---|---:|---|
| RonDesignLab | 45% | premium light SaaS surfaces, refined dashboard composition, strong product-card hierarchy |
| Anthropic | 25% | warm restraint, editorial spacing, humane density |
| OpenAI | 15% | conversational entry points, calm controls, input-forward interaction |
| Xpander / Atlas-style builder references | 15% | enterprise builder practicality and reusable component patterns |

Reference links:

- [RonDesignLab](https://rondesignlab.com/)
- [RonDesignLab on Dribbble](https://dribbble.com/rondesignlab)
- [Synthex SaaS Analytics Mobile Dashboard by RonDesignLab](https://dribbble.com/shots/27086410-Synthex-SaaS-Analytics-Mobile-Dashboard)
- [Anthropic](https://www.anthropic.com/)
- [OpenAI](https://openai.com/)
- [Xpander Platform UX/UI](https://pixelbites.studio/our-work/xpander-platform-ux-ui/)
- [Atlas UI](https://ui.pacifio.dev/)

### 5.3 Surface strategy

Use:

- Light, warm product shell for normal editing.
- Focused light workspaces for Pilot Lab, Diff Viewer, Trace detail, and Release publish/rollback moments. Use slightly cooler or denser light surfaces, not dark mode.
- Precise status language and quiet micro-interactions.

Do not make product pages, receipts, Diff Viewer, Pilot work panels, or trace panels dark. Long configuration work should remain calm, readable, and visually unified.

### 5.4 Anti-patterns

Avoid:

- global black/neon dashboard skin
- dominant purple-blue gradients
- one-note cream/beige/brown palette
- visible decorative orbs, bokeh blobs, or background blobs
- stacked cards inside cards
- full-page glassmorphism
- flowchart canvas as Procedure Builder
- generic KPI dashboard as the logged-in landing page
- visible in-app text explaining keyboard shortcuts or feature philosophy
- marketing hero composition inside the app shell

---

## 6. Token direction

Use a three-layer token model: primitive -> semantic -> component.

### 6.1 Primitive tokens

Recommended starting primitives:

```css
:root {
  --primitive-canvas-0: #f7f7f3;
  --primitive-canvas-1: #efeee8;
  --primitive-surface-0: #fffdf8;
  --primitive-surface-1: #f2f0ea;

  --primitive-graphite-950: #151719;
  --primitive-graphite-900: #202427;
  --primitive-graphite-700: #4c5358;
  --primitive-graphite-500: #7c858b;
  --primitive-graphite-300: #c5cbd0;
  --primitive-graphite-150: #e3e6e8;

  --primitive-deep-950: #10171d;
  --primitive-deep-900: #17212a;
  --primitive-deep-800: #1f2b34;
  --primitive-deep-700: #2d3a43;

  --primitive-cyan-600: #357f7c;
  --primitive-cyan-400: #72aaa6;
  --primitive-amber-500: #d5963d;
  --primitive-green-500: #6f9e72;
  --primitive-red-500: #c9635b;
  --primitive-violet-500: #8172c8;
}
```

This palette is warm but not beige-dominated. Graphite and muted cyan should carry the product identity more than cream or purple.

### 6.2 Semantic tokens

```css
:root {
  --color-bg-app: var(--primitive-canvas-0);
  --color-bg-band: var(--primitive-canvas-1);
  --color-bg-surface: var(--primitive-surface-0);
  --color-bg-surface-muted: var(--primitive-surface-1);

  --color-text-primary: var(--primitive-graphite-950);
  --color-text-secondary: var(--primitive-graphite-700);
  --color-text-tertiary: var(--primitive-graphite-500);
  --color-border-subtle: var(--primitive-graphite-150);

  --color-accent-primary: var(--primitive-cyan-600);
  --color-accent-soft: var(--primitive-cyan-400);
  --color-signal-warning: var(--primitive-amber-500);
  --color-signal-success: var(--primitive-green-500);
  --color-signal-danger: var(--primitive-red-500);

  --color-workspace-bg: var(--primitive-deep-950);
  --color-workspace-surface: var(--primitive-deep-900);
  --color-workspace-raised: var(--primitive-deep-800);
  --color-workspace-border: var(--primitive-deep-700);
  --color-workspace-text: #f5f7f4;
  --color-workspace-muted: #aeb9bd;
}
```

### 6.3 Component tokens

```css
:root {
  --shell-sidebar-width: 248px;
  --shell-topbar-height: 56px;
  --pilot-drawer-width: 380px;
  --command-bar-width: 720px;

  --radius-control: 8px;
  --radius-card: 8px;
  --radius-panel: 12px;
  --radius-modal: 12px;

  --shadow-raised: 0 12px 36px rgba(21, 23, 25, 0.08);
  --shadow-workspace: 0 24px 80px rgba(4, 10, 14, 0.38);

  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-slow: 260ms;
  --ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
}
```

Rules:

- Functional cards use `8px` radius.
- Panels/modals may use `12px` radius when they need clear depth.
- Do not use oversized rounded cards as the default.
- Do not use viewport-width-scaled font sizes.
- Letter spacing should remain `0` unless a small all-caps label truly needs tracking.

### 6.4 Typography

Recommended:

- UI font: `Inter`, fallback `Noto Sans SC`, system sans.
- Mono font: `JetBrains Mono`, fallback monospace.
- No decorative serif in the product UI shell.

Scale:

| Token | Size | Use |
|---|---:|---|
| `--text-xs` | 12px | metadata, labels |
| `--text-sm` | 13px | dense controls, table cells |
| `--text-base` | 14px | normal app text |
| `--text-md` | 16px | important body text |
| `--text-lg` | 20px | section heading |
| `--text-xl` | 24px | page heading |
| `--text-display` | 32px | rare command-center emphasis |

Do not use hero-scale text inside compact dashboards, drawers, sidebars, tables, or control panels.

### 6.5 Motion

Motion should signal agentic work without becoming decoration.

Allowed:

- drawer open/close
- command bar row focus
- diff group expand/collapse
- trace step reveal
- receipt run status transition
- subtle activity pulse for running tests

Avoid:

- floating background shapes
- constant page-level ambient motion
- large parallax
- animated gradients as the main visual identity

---

## 7. Implementation lanes

These UI lanes are designed to be parallelizable without file conflicts. They should start after the Foundation Reset route/contracts are stable, except `UX0`, which can run earlier if it only introduces primitives and does not rewrite navigation.

| Lane | Scope | Parallel? | Suggested owned files |
|---|---|---|---|
| UX0 | Design primitives and shell tokens | Can run early | `apps/console/app/globals.css`, new shared UI primitives, Tailwind config if needed |
| UX1 | IA, routes, app shell, redirects | After F8 route vocabulary | `components/console-shell.tsx`, `components/console-sidebar.tsx`, route layout files, dictionaries |
| UX2 | Release command center and Config Diff Viewer | After package/version contracts | `/build/release`, Diff Viewer component, package action components |
| UX3 | Components workspace shell | Parallel after UX1 | `/build/components/**`, component local nav, shared draft/test panel |
| UX4 | Pilot Lab and ConfigPilot surfaces | Parallel after scenario + typed APIs | `/build/pilot-lab`, Pilot Chat Cockpit, Playground tab, receipt views |
| UX5 | Operate Conversations and Human Handoff | Parallel after trace/handoff contracts | `/operate/conversations`, `/operate/handoff`, Trace Panel |
| UX6 | i18n, responsive, browser QA sweep | Last | `dictionaries.ts`, mobile/read-only states, Playwright/browser verification |

Coordination rules:

- `dictionaries.ts` is high-collision. Let UX6 own the final parity sweep.
- Do not let UX3 recreate Hook/Tool runtime contracts. It consumes Foundation Reset APIs.
- Diff Viewer should be built once and reused by ConfigPilot, Release, Import, and Rollback.
- ConfigPilot should not be globally mounted as a drawer in P0. Use a single main Pilot Lab workspace and link into it with context.
- Visual primitives should not depend on business logic.

---

## 8. Definition of done

The UI/UX reset is done when:

- Logged-in first route is Build -> Pilot Lab.
- Main navigation is Build / Operate / Settings.
- Build has Release, Pilot Lab, Components.
- Components has Brain, Procedures, Tools, Hooks, Knowledge, Integrations as independent routes.
- Operate has Conversations and Human Handoff only.
- Settings has Organization only.
- ConfigPilot exists as the Pilot tab inside Pilot Lab; Playground exists as the second tab with dry-run and trace capability.
- Command Bar is available.
- Config Diff Viewer is used by ConfigPilot Apply, Publish, Import, and Rollback Preview.
- Release shows live version, draft changes, receipts, and package actions.
- Component pages use explicit Save draft and local test panels.
- Product UI supports `en-US` and `zh-CN`.
- Business configuration content is not auto-translated.
- Desktop 1440/1280 layouts are verified.
- 1024 tablet is usable.
- Mobile complex editing shows an appropriate read-only/open-on-desktop state.
- No current UI page uses Blueprint, Skill, Policy, or Guardrail as active product language.
