# Intera — Design System

**Intera** (品牌中文界面：「Intera」) is an **AI-Agent–first customer-service SaaS platform**. A customer opens a chat, describes an issue, and an autonomous agent investigates it as a *case* — pulling knowledge, running skills/tools, asking clarifying questions, escalating to a human when guardrails require it, and resolving the ticket end-to-end. It is **multi-tenant**: each organization ("Customer") gets its own agent configuration, knowledge sources, guardrails, channels, and operator console. The platform is heading into production with multiple organizations onboarding.

The product is **bilingual (English / 简体中文)** and ships two distinct surfaces that share one visual language:

| Surface | App | Who | What it is |
|---|---|---|---|
| **Chat** | `apps/chat` | End customers | The conversational AI support experience — welcome screen, message thread, voice/text composer, live "case" investigation panel, case history. |
| **Console** | `apps/console` | Operators & admins | The per-org control plane — live chat/case viewer, human-task queue, dashboards, and admin config (agent blueprint, tools, guardrails, case types, knowledge, channels). |

The signature look is **"iOS Liquid Glass"**: a warm paper background, slow-drifting blurred color orbs, a fine grain texture, and frosted translucent cards floating above it all. It is **light-mode only**, restrained, and editorial — a serif wordmark and serif message prose give it a calm, premium, almost literary feel that sets it apart from the typical blue-gradient SaaS chatbot.

---

## Sources

This system was reverse-engineered from the product's own source code. If you have access, explore these to build with higher fidelity:

- **GitHub:** [`CurtisYoung18/intera-agent`](https://github.com/CurtisYoung18/intera-agent) — the monorepo (`apps/chat`, `apps/console`, `packages/shared`). Design tokens live in `apps/chat/app/globals.css` and `apps/console/app/globals.css`; shared UI primitives in `packages/shared/ui/`.

> The reader is encouraged to browse that repository directly — reading the real components (`message-bubble.tsx`, `voice-input-bar.tsx`, `console-sidebar.tsx`, `status-pill.tsx`, the glass utility classes) will let any agent reproduce screens with pixel fidelity rather than approximation.

---

## CONTENT FUNDAMENTALS

How Intera writes.

- **Voice — calm, competent, human.** It addresses the customer directly ("How can I help you?", "Describe your issue…"). Operator-facing copy is terse and functional ("System overview and health monitoring", "Queue of escalations awaiting human action").
- **Person:** Customer-facing = **you** (the customer) + an implicit, unnamed agent ("Intera AI"). The agent rarely says "I" — it shows *what it is doing* via status verbs instead ("Thinking", "Working", "Online").
- **Casing:** Sentence case for body and buttons. **UPPERCASE + letter-spacing** (`0.04–0.12em`) reserved for tiny eyebrow labels and status pills (`ONLINE · THINKING`, `OPS`, `ADMIN`). Headings are sentence case, never Title Case Everywhere.
- **Brand wordmark:** always the single word **Intera**, set in *italic Cormorant Garamond serif* — large (48px) on the welcome screen. Treated as a logotype, not body text.
- **Status as language.** Much of the UI "copy" is actually live state: `Thinking`, `Working`, `Waiting`, `Resolved`, `Escalated`, `N messages queued`, `3h ago`. Short, present-tense, lowercase except status pills.
- **Tone is reassuring, not chirpy.** No exclamation marks, no "Oops!", no marketing hype. Empty states are quiet ("No data yet", "—").
- **Bilingual by construction.** Strings exist as `{ en, zh }` pairs. English is primary in the design language; 中文 is a first-class peer (Noto Sans/Serif SC companions). Example pairs: *Dashboard / 运营仪表盘*, *Active Cases / 活跃案例*, *Channel Health / 渠道健康度*.
- **No emoji.** None in the product UI. Meaning is carried by Lucide icons + colored status dots, never emoji.
- **Numbers & IDs** are mono (JetBrains Mono): case IDs, member IDs (`JAYA113C88F`), versions, timestamps. Big metrics are bold sans with tight tracking (`-0.02em`).
- **Microcopy examples:** placeholder *"Describe your issue… (Shift+Enter for new line)"*; queue hint *"Agent is responding — queue your next question…"*; suggestion affordance *"Press Tab · Esc clears"*.

---

## VISUAL FOUNDATIONS

The "iOS Liquid Glass" system, answered in detail.

### Background
Never flat. Every screen is built in layers (see `.liquid-glass-*` classes and `FluidBackground`):
1. **Paper base** — warm cream radial gradient. Chat `#faf6f0 → #f3ebE2`; Console cooler `#f8f7f4 → #f0eeea`.
2. **Color orbs** — 3–4 large (300–500px) blurred (`blur(80px)`) radial circles in lavender, sky and gold, ~5–12% opacity, slowly **floating** (8–11s `float` loops, staggered).
3. **Grain** — a tiled 256px SVG `feTurbulence` fractal-noise texture at **2–2.5% opacity**. Subtle, always present.
4. **Frost + edge highlights** — a faint `backdrop-filter: blur(2px)` and top/edge white gradients for depth.

There are **no photographs and no illustrations** in the product. The "imagery" is entirely this generated atmosphere — soft, warm, abstract.

### Color vibe
Warm, paper-like, low-saturation. Ink is **never pure black** (`#1a1814`) and paper **never pure white**. Accents are used sparingly and only with meaning: lavender `#8b6ff5` is the brand/decorative hue (orbs, user bubbles); indigo `#5b8af7` is primary action & focus; malachite/amber/vermillion are success/warning/error. Color appears as *tints* — `rgba(accent, 0.04–0.12)` fills with matching low-alpha borders.

### Type
- **Serif (Cormorant Garamond)** — brand wordmark + **chat message prose** (16–18px, the bubbles read like print). This editorial serif-in-the-conversation choice is the system's most distinctive move.
- **Sans (Inter)** — all UI chrome: nav, labels, buttons, tables, metrics.
- **Mono (JetBrains Mono)** — IDs, code, metadata.
- Weights stay restrained: 400/500/600, 700 only for metrics & H1.

### Glass / cards
The core component. Cards are `rgba(255,255,255,0.45–0.55)` + `backdrop-filter: blur(24px) saturate(160%)` + a **white** (not gray) hairline border `rgba(255,255,255,0.6)` + a soft drop shadow **and** an inset white highlight (`0 0 0 1px rgba(255,255,255,0.4) inset`). They sit *on* the orb field, so the blur actually does work. Plain console data cards use a simpler `bg-white/60 backdrop-blur-xl border border-black/[0.06]`.

### Corner radii
Generous and soft. Chat: 12/16/20/24px (bubbles 20px, composer pill 28px, full-round send button). Console slightly tighter: 8/12/16/20px. Pills & dots are fully round (`999px`).

### Borders
Two flavors: **white translucent** hairlines on glass (`rgba(255,255,255,0.5–0.6)`), and **black translucent** hairlines on opaque console surfaces (`rgba(0,0,0,0.05–0.08)`). Focus rings are indigo: `border-color rgba(91,138,247,0.4)` + `0 0 0 3px rgba(91,138,247,0.08)`.

### Shadows / elevation
Low and warm. `--shadow-card: 0 2px 12px rgba(0,0,0,0.04)` + inset white. Hover lifts to `0 4px 20px rgba(0,0,0,0.06)`. Inputs use *inset* shadow (`inset 0 1px 3px rgba(0,0,0,0.04)`). Nothing is heavy or dark; depth comes from blur + translucency more than from drop shadow.

### Motion
Tasteful, organic, never bouncy-cartoonish. House easings: **`cubic-bezier(0.22,1,0.36,1)`** (enter/lift/settle) and **`cubic-bezier(0.16,1,0.3,1)`** (fade-up). Named animations: `float` (orbs), `breathe` (status dots, 1.4–3s opacity/scale pulse), `fadeUp`/`messageIn` (content entering, ~400–500ms translateY), `shimmer` (loading), `pingRing` (radar ring on "thinking"), `glowPulse`, `slideInRight`. Durations 150ms (press) → 300ms (hover) → 400–500ms (entrance). Respects `prefers-reduced-motion`.

### Hover / press states
- **Hover:** surface brightens (`white/0.45 → 0.65`), border picks up a lavender/indigo tint, card lifts `translateY(-1px to -2px)`, icons scale `1.06–1.10`.
- **Press / active:** scales **down** (`scale(0.95–0.98)`) — a confident tactile "push". Primary buttons darken slightly.
- **Focus-visible:** always an indigo ring, never a default browser outline.

### Transparency & blur — when
Blur is the load-bearing material. Used on: every card/bubble, the sidebar (`blur(28px)`), composer, pills, modals (`backdrop-blur-sm` scrims). Opaque white is reserved for dense data (tables, nested list rows) and the password modal, where legibility beats atmosphere.

### Status system
A consistent vocabulary of **colored dot + uppercase micro-label**: online/resolved = malachite, waiting = amber, escalated/error = vermillion, in-progress = indigo, neutral = smoke. "Thinking" adds a ping ring; "Working/executing" uses a conic-gradient spinner ring. See `status-pill.tsx` and `.console-status-pill`.

---

## ICONOGRAPHY

- **System:** [**Lucide**](https://lucide.dev) (`lucide-react`), used everywhere. This is the single icon language — no second set, no custom glyph font, no emoji.
- **Style:** outline / stroked, `strokeWidth` **1.5** at rest and **1.75–2.0** when active or emphasized. Sizes 14–20px (`w-3.5`–`w-5`). Round line caps/joins.
- **Color:** icons inherit `--fog` (muted) by default and switch to a **per-item accent color** when active — the sidebar maps each nav item to its own hue (chats→indigo, users→lavender, dashboards→teal, agent→malachite, tools→indigo, guardrails→vermillion, case-types→amber, knowledge→teal, channels→violet).
- **Common icons seen:** `MessageSquare, Users2, BarChart3, BookOpen, Bot, Puzzle, Shield, Layers, Search, Plug, ClipboardList, Building2, ChevronLeft/Right/Down, User, LogOut, Languages, Loader2` (spin), `Send` (custom inline SVG paper-plane in the composer), `PenLine` (new chat), `Activity, Clock, Briefcase, ArrowRight`.
- **Status icons are not icons** — they're colored dots / rings drawn in CSS (see status system above), keeping the chrome quiet.
- **In this design system:** UI kits load Lucide from CDN (`unpkg.com/lucide@latest`). The one custom mark is the **Send paper-plane** (inline SVG, lifted verbatim from `voice-input-bar.tsx`). The Intera "logo" is a **typographic wordmark**, not an image — set the word *Intera* in italic Cormorant Garamond.

> No raster icon assets, sprite sheets, or icon fonts exist in the repo to copy — the product depends on the Lucide package at build time. CDN-linking Lucide is therefore the faithful reproduction, not a substitution.

---

## Font substitution note

The product loads **Cormorant Garamond, Inter, JetBrains Mono** (and Noto SC) directly from **Google Fonts** — so this system links the exact same families from Google Fonts in `colors_and_type.css`. **No substitution was needed.** If you later want them self-hosted, drop the `.woff2` files into `fonts/` and swap the `@import` for `@font-face` rules.

---

## Index — what's in this folder (manifest)

| Path | What |
|---|---|
| `README.md` | This file — product context, visual foundations, content fundamentals, iconography. |
| `SKILL.md` | Agent-Skill manifest (Claude Code compatible). Invoke to start designing for Intera. |
| `colors_and_type.css` | **All design tokens** — CSS vars for every color, font family, semantic type class, radius, shadow, easing. |
| `assets/liquid-glass.css` | **The atmosphere** — `.liquid-glass-*` layers + all glass utility classes + keyframe animations. Drop-in for any HTML artifact. |
| `assets/logo-animation.html` | **Animated wordmark showcase** — Intera ⇄ I monogram demo, sidebar collapse preview, auto-cycle + controls. |
| `preview/` | **22 spec cards** in the Design System tab. Colors (paper, ink, semantic, brand, tints), Type (wordmark, sans, serif, mono), Spacing (radii, elevation, glass material, motion), Components (buttons, status pills, bubbles, composer, metrics, sidebar, inputs), Brand (atmosphere, iconography). |
| `ui_kits/chat/` | **Chat UI kit** — fully interactive: login screen → welcome → live conversation with case investigation panel. Components: `logo.jsx`, `components.jsx` (shell, bubbles, composer, status), `panels.jsx` (login, case panel), `app.jsx`. |
| `ui_kits/console/` | **Console UI kit** — the centerpiece. Interactive operator console with: **Preview & Debug Playground** (3-pane: config knobs · test chat · behavior trace), Dashboard, Agent Config, Guardrails, docked preview panel, animated sidebar. Components: `logo.jsx`, `engine.jsx` (config→trace mock), `components.jsx`, `screens.jsx`, `screens2.jsx`, `app.jsx`. |

*No slide template was provided in the source, so no `slides/` were generated.*

---

### The Preview & Debug Playground — design rationale

The user asked where best to place a "debug" function showing how console configs shape Intera's behavior. The answer delivered here is **two surfaces**:

1. **Dedicated Playground** (`/preview-debug` nav item under **Build**) — a 3-pane studio:
   - **Left** — live config knobs (model, persona, memory, knowledge, per-guardrail toggles). Changes take effect on next send.
   - **Center** — test chat (send messages as a customer, with scripted suggestions covering refund/order/billing/abuse scenarios).
   - **Right** — behavior trace: a timeline of every pipeline stage (intent → guardrails → knowledge → tools → stage/SOP → model), each annotated with which config screen drove it, expandable to show raw debug payloads when Debug Mode is on.

2. **Docked preview** (the `Test agent` button on any config screen) — a slide-in panel giving the same test chat + trace without leaving the config editor. Lets operators iterate on a guardrail and immediately test without context-switching.
