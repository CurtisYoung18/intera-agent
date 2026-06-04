# Intera Design System — Coding Agent Handoff

> **For the implementing developer / coding agent:**
> This document describes every change needed to migrate the Intera design system (UI kit + tokens + components) into the existing Next.js monorepo (`apps/chat` and `apps/console`). Follow each section in order. The design assets are in the downloaded zip alongside this file.
>
> Source repo for context: [`CurtisYoung18/intera-agent`](https://github.com/CurtisYoung18/intera-agent)

---

## 0. What's in the design system zip

```
colors_and_type.css          ← all design tokens (copy into globals.css)
assets/liquid-glass.css      ← atmosphere layers + glass utility classes
assets/logo-animation.html   ← animated wordmark demo (reference for implementation)
ui_kits/console/             ← full interactive Console UI (reference code)
  index.html                 ← runnable prototype (open in browser to see final look)
  kit.css                    ← layout + component CSS
  playground.css             ← Preview & Debug 3-pane playground CSS
  logo.jsx                   ← InteraLogo animated wordmark component
  engine.jsx                 ← behavior trace mock (shows API contract)
  components.jsx             ← Sidebar, Topbar, icons, primitives
  screens.jsx                ← ConfigPanel, TestChat, TraceInspector, Playground
  screens2.jsx               ← Dashboard, AgentConfig, Guardrails, Dock, stubs
  app.jsx                    ← shell + routing + useAgentChat hook
ui_kits/chat/                ← Chat surface reference
preview/                     ← design spec cards (open in browser)
README.md                    ← full design guidelines (READ THIS FIRST)
SKILL.md                     ← agent skill manifest
```

> Open `ui_kits/console/index.html` and `assets/logo-animation.html` in Chrome to see the target visuals before starting.

---

## 1. Design tokens — add to `globals.css`

Both `apps/chat/app/globals.css` and `apps/console/app/globals.css` already contain these tokens. **No changes needed** — the existing files ARE the source of truth. The `colors_and_type.css` in the zip is a standalone reference copy.

If you add a new surface (e.g. marketing site), copy the `:root {}` block from `colors_and_type.css`.

---

## 2. Animated wordmark — `InteraLogo` component

### 2a. Create the component

```tsx
// packages/shared/ui/intera-logo.tsx
'use client'
import { useEffect, useState } from 'react'

interface Props {
  collapsed?: boolean   // collapse to "I" (sidebar icon mode)
  size?: number         // font-size in px
  phase?: 'intera' | 'ia' | 'ai'  // forced phase (omit for default behaviour)
}

export default function InteraLogo({ collapsed = false, size = 22, phase }: Props) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 60)
    return () => clearTimeout(t)
  }, [])

  const isCollapsed = collapsed

  return (
    <span
      className={[
        'intera-logo',
        revealed ? 'is-revealed' : '',
        isCollapsed ? 'is-collapsed' : '',
      ].join(' ')}
      style={{ fontSize: size }}
      aria-label="Intera"
    >
      <span className="il-anchor">I</span>
      {'ntera'.split('').map((ch, i) => (
        <span
          key={i}
          className="il-letter"
          style={{ transitionDelay: `${(isCollapsed ? (4 - i) : i) * 28}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
```

### 2b. Add CSS to `globals.css` (both apps)

```css
/* ── Animated wordmark ── */
.intera-logo {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.02em;
  display: inline-flex;
  align-items: baseline;
  line-height: 1;
  user-select: none;
}
.il-anchor { display: inline-block; }
.il-letter {
  display: inline-block;
  max-width: 0;
  opacity: 0;
  transform: translateX(-3px);
  white-space: pre;
  overflow: hidden;
  transition:
    max-width 0.5s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.32s ease,
    transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.intera-logo.is-revealed .il-letter {
  max-width: 0.66em;
  opacity: 1;
  transform: none;
}
.intera-logo.is-collapsed .il-letter {
  max-width: 0 !important;
  opacity: 0 !important;
  transform: translateX(-3px) !important;
}
```

### 2c. Replace the wordmark in `console-sidebar.tsx`

Find the existing sidebar header that shows the org name / logo and replace with:

```tsx
import InteraLogo from '@intera/shared/ui/intera-logo'

// In the expanded sidebar header:
<InteraLogo size={20} />

// In the collapsed sidebar icon:
<InteraLogo size={15} collapsed />
```

---

## 3. Preview & Debug Playground

This is the primary new feature. It is a 3-pane screen:

```
┌──────────────────┬──────────────────────┬────────────────────┐
│  Config knobs    │   Test chat          │  Behavior trace    │
│  (live config)   │   (as a customer)    │  (pipeline steps)  │
└──────────────────┴──────────────────────┴────────────────────┘
```

### 3a. Add nav item

In `apps/console/components/console-sidebar.tsx`, add to `OPS_ITEMS` or create a new `BUILD_ITEMS` group above OPS:

```ts
// Add at the TOP of the nav, new group "Build"
const BUILD_ITEMS: NavItem[] = [
  { href: '/admin/playground', slug: 'playground', icon: FlaskConical, color: '#8b6ff5', badge: 'NEW' },
]
```

Import `FlaskConical` from `lucide-react`.

Add the nav group label "Build" above "OPS" in the sidebar render.

### 3b. Create the playground page

```
apps/console/app/admin/playground/page.tsx
```

**Layout — 3 columns:**

```tsx
// apps/console/app/admin/playground/page.tsx
'use client'

export default function PlaygroundPage() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '268px 1fr 360px', height: '100%' }}>
      <ConfigPanel />
      <TestChat />
      <TraceInspector />
    </div>
  )
}
```

### 3c. `ConfigPanel` — left rail

Shows the currently active agent config with live toggles. Changes should propagate to the test chat so the trace updates.

```tsx
// What to show:
// - Model selector (Claude / MiniMax / DeepSeek) — Seg control
// - Persona toggle (Concise / Warm)
// - Memory on/off switch
// - Knowledge base on/off switch
// - Guardrails: per-rule on/off chips (PII, Refund policy, Abuse, Escalation)
// - Debug Mode switch (shows raw JSON payloads in trace when on)
// - "Edit guardrails →" link to /admin/guardrails
```

**State:** lift config state to the page level and pass down. Config shape:

```ts
interface PlaygroundConfig {
  model: 'claude-sonnet' | 'minimax' | 'deepseek'
  persona: 'concise' | 'warm'
  memory: boolean
  knowledge: boolean
  debug: boolean
  guardrails: {
    pii: boolean
    refundPolicy: boolean
    profanity: boolean
    escalation: boolean
  }
}
```

### 3d. `TestChat` — center

A minimal chat UI for sending test messages as a simulated customer. On send, call a new API endpoint (see §3f) and display the reply.

```tsx
// Features:
// - 4 suggestion buttons (quick-start scenarios):
//   "Where is my order?" / "I want a refund" / "How much is the Pro plan?" / "This is useless, I'm furious"
// - Composer: same glass pill style as the main chat app
// - Message bubbles: same glass-chat-user / glass-chat-assistant classes
// - Responding bubble with cycling verb: 
//   ['Classifying intent', 'Checking guardrails', 'Searching knowledge', 'Calling tools', 'Generating reply']
// - Each assistant turn shows a "view trace →" tag that selects it in the right panel
```

### 3e. `TraceInspector` — right rail

Displays the behavior trace for the selected turn as an interactive timeline.

```tsx
// Each step has:
// - Stage name (Intent classification / Guardrails / Knowledge retrieval / Skills & tools / Stage SOP / Model generation)
// - Status dot: ok (green) / info (blue) / warn (amber) / block (red)
// - Duration in ms
// - Summary line
// - Expandable detail: key-value pairs
// - "Driven by → [Config screen]" link that navigates to that screen
// - Raw JSON payload section (only when debug: true in config)
```

**Trace data structure** (what the API should return per turn):

```ts
interface TraceStep {
  stage: string
  status: 'ok' | 'info' | 'warn' | 'block' | 'neutral'
  ms: number
  summary: string
  detail: [key: string, value: string][]
  source: 'caseTypes' | 'guardrails' | 'knowledge' | 'tools' | 'agent' | 'humanTasks'
  json?: object   // raw payload, only shown when debug=true
}

interface PlaygroundTurnResult {
  turnId: string
  intent: string
  caseType: string
  reply: string
  blocked: boolean
  trace: TraceStep[]
}
```

### 3f. New API endpoint

```
POST /api/admin/playground/run
Body: { message: string, config: PlaygroundConfig }
Response: PlaygroundTurnResult
```

This endpoint should:
1. Classify intent using the real agent pipeline
2. Run guardrails with the provided config (overriding live config for the test)
3. Retrieve knowledge if `config.knowledge === true`
4. Run applicable tools
5. Generate a reply with the selected model + persona
6. Return the full trace with timing and config attribution

> Reference the mock logic in `ui_kits/console/engine.jsx` to understand the expected data shape for each trace step.

---

## 4. Docked preview ("Test agent" button)

On **any** config screen (Agent Config, Guardrails, etc.), add a "Test agent" button to the topbar. Clicking it opens a right-side slide-in dock (420px wide) containing the same TestChat + TraceInspector in a tabbed view.

```tsx
// Dock state: open/closed, persisted per-session in localStorage
// Width: 420px, slides from right via transform: translateX(100%) → translateX(0)
// Scrim: backdrop-filter: blur(1px) + rgba(20,18,14,0.12) overlay, click to close
// Tab bar: [Chat | Trace]
```

CSS for the dock is in `ui_kits/console/playground.css` — copy the `.dock`, `.dock-head`, `.dock-scrim` rules.

---

## 5. Dashboard improvements

Replace the existing dashboard at `/ops/dashboards/page.tsx` with the redesigned version in `ui_kits/console/screens2.jsx` (the `Dashboard` component). Key changes:

- 4-metric grid (Messages 24h, Active Cases, Avg Resolution, Guardrail Hits) with delta indicators
- Two-column second row: Recent Cases table + Channel Health
- All cards use `rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl`
- Hover lift: `transition: all 250ms; hover: translateY(-2px)`

---

## 6. Sidebar — nav group restructure

Current: OPS / ADMIN groups.
New: **Build** / **Operate** groups.

```
BUILD (formerly Admin, reordered):
  Preview & Debug  ← NEW (top item)
  Agent Config
  Guardrails
  Tools & Skills
  Case Types
  Knowledge
  Channels

OPERATE (formerly Ops):
  Dashboard
  Live Chats
  Human Tasks
  Users
```

This surfaces the debug tool prominently since it's the primary value-add for multi-tenant onboarding.

---

## 7. CSS changes to `apps/console/app/globals.css`

Append these rules (they don't override anything existing):

```css
/* Animated wordmark — see §2b above */
.intera-logo { ... }
.il-anchor { ... }
.il-letter { ... }
.intera-logo.is-revealed .il-letter { ... }
.intera-logo.is-collapsed .il-letter { ... }

/* Playground layout */
.pg { display: grid; grid-template-columns: 268px 1fr 360px; height: 100%; min-height: 0; }
/* ... copy full .pg-* rules from ui_kits/console/playground.css */

/* Dock */
.dock { ... }
.dock-scrim { ... }
/* ... copy from playground.css */
```

---

## 8. Visual QA checklist

After implementation, verify in Chrome (not Safari — backdrop-filter works differently):

- [ ] Sidebar logo: "Intera" → reveals on load, collapses to "I" when sidebar collapses
- [ ] Playground nav item appears at top of sidebar with "NEW" badge
- [ ] Config knobs respond to toggle: flipping a guardrail off and resending a message shows a different trace
- [ ] Trace timeline: 6 steps per turn, each expandable, "Driven by →" links navigate correctly
- [ ] Debug Mode: toggling it on shows JSON payload sections in the trace
- [ ] Dock: "Test agent" button on Agent Config and Guardrails screens slides the dock in from the right
- [ ] Dashboard: 4-metric cards + table + channel health render correctly
- [ ] All glass cards have visible text (backdrop-filter may fail in some testing tools — test in real browser)

---

## 9. Files to copy from the zip

| From zip | To project |
|---|---|
| `colors_and_type.css` | Reference only — tokens already in globals.css |
| `assets/liquid-glass.css` | Merge glass utility classes into `apps/console/app/globals.css` |
| `assets/logo-animation.html` | Open in browser as visual reference |
| `ui_kits/console/index.html` | Open in browser as target visual |
| `ui_kits/console/playground.css` | Copy `.pg-*`, `.dock`, `.tl-*`, `.cfg-*` rules into `apps/console/app/globals.css` |

Do **not** copy the `.jsx` files directly — they are Babel/UMD prototypes. Rewrite as proper TypeScript React components following the patterns shown.

---

## 10. Priority order

1. **Wordmark animation** (§2) — 1–2h, purely CSS + one component
2. **Playground page** (§3) — 1 day, the core feature
3. **Docked preview** (§4) — 2–3h, reuses playground components
4. **Dashboard redesign** (§5) — 2h, mostly CSS
5. **Sidebar restructure** (§6) — 1h

Total estimate: **2–3 days** for a focused engineer.
