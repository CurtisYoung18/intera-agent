# Intera Harness — UI Design Spec

> **Purpose:** AI-implementation-ready design specification. Every component has
> exact CSS values, animation keyframes, and file paths. Follow sections in order.
>
> **Design Language:** Void + Fluid Glass（虚白 · 流光）
> **Primary Target:** Desktop web (1440px), responsive to mobile (375px)
> **Implementation Stack:** Next.js 15 + React 19 + Tailwind CSS 3 + TypeScript

---

## 0. Route Restructuring

### 0.1 New Route Map

```
User-facing routes:
  /                    → redirect to /chat
  /chat                → Chat Frontend (C端)
  /admin               → Admin Console (B端)
  /admin/skills        → Skill Registry
  /admin/policies      → Policy Rules
  /admin/case-types    → Case Type Config
  /admin/routing       → Human Routing
  /admin/customer      → Customer Config
  /ops/human-tasks     → Human Task List
  /ops/human-tasks/[id] → Human Task Detail
  /ops/cases/[id]      → Case Trace Timeline

API routes:
  POST /api/messages           → Agent message entry (SSE)
  GET  /api/admin/agent-config → Agent orchestration config
  PUT  /api/admin/agent-config
  GET  /api/admin/skills       → Skill registry
  POST /api/admin/skills
  GET  /api/human-tasks        → Human task list
  POST /api/human-tasks/[id]/resolve

Internal modules:
  lib/agent/loop.ts
  lib/agent/memory.ts
  lib/agent/skills.ts
  lib/agent/policy.ts
  lib/agent/trace.ts
  lib/agent/streaming-tool-executor.ts
```

### 0.2 Migration Steps (do this FIRST)

1. `git mv app/try/chat app/chat`
2. `git mv app/try/admin app/admin`
3. `git mv app/try/ops app/ops`
4. `git mv app/api/try/messages app/api/messages`
5. `git mv app/api/try/admin app/api/admin`
6. `git mv app/api/try/human-tasks app/api/human-tasks`
7. `git mv lib/try/agent lib/agent`
8. Delete `app/try/`
9. Update all `@/lib/try/agent` imports → `@/lib/agent`
10. Update `app/page.tsx` redirect: `/try/chat` → `/chat`
11. Delete `app/try/page.tsx`
12. Run `npx next build` to verify

---

## 1. Design Token System

### 1.1 CSS Custom Properties

Create `app/globals.css` with these exact tokens:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* ── Void Palette ── */
  --void:        #08080a;
  --abyss:       #0f0f12;
  --basalt:      #1a1a1f;
  --obsidian:    #24242b;

  /* ── Mist (text) ── */
  --mist:        #f5f3ef;
  --fog:         #8c8a85;
  --smoke:       #3d3b38;

  /* ── Accent (use sparingly) ── */
  --vermillion:  #e64539;
  --indigo:      #5b6ef5;
  --amber:       #d4912e;
  --malachite:   #2ea04a;

  /* ── Glass tokens ── */
  --glass-chat:       rgba(255, 255, 255, 0.03);
  --glass-input:      rgba(255, 255, 255, 0.03);
  --glass-admin:      rgba(15, 15, 15, 0.70);
  --glass-pill:       rgba(15, 15, 15, 0.50);
  --glass-hover:      rgba(255, 255, 255, 0.04);
  --glass-border:     rgba(255, 255, 255, 0.06);
  --glass-border-hover: rgba(255, 255, 255, 0.10);

  /* ── Spacing ── */
  --chat-max-w:       560px;
  --admin-sidebar-w:  48px;
  --admin-content-w:  720px;
  --radius-sm:        6px;
  --radius-md:        12px;
  --radius-lg:        16px;
  --radius-xl:        24px;

  /* ── Typography ── */
  --font-serif:       'Cormorant Garamond', 'Noto Serif SC', serif;
  --font-sans:        'Inter', 'Noto Sans SC', sans-serif;
  --font-mono:        'JetBrains Mono', monospace;
}

/* ── Global base ── */
body {
  background: var(--void);
  color: var(--mist);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### 1.2 Tailwind Config

Extend `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        void: '#08080a',
        abyss: '#0f0f12',
        basalt: '#1a1a1f',
        mist: '#f5f3ef',
        fog: '#8c8a85',
        smoke: '#3d3b38',
        vermillion: '#e64539',
        indigo: '#5b6ef5',
        amber: '#d4912e',
        malachite: '#2ea04a',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      maxWidth: {
        chat: '560px',
        'admin-content': '720px',
      },
      backdropBlur: {
        glass: '24px',
        'glass-sm': '12px',
        'glass-md': '16px',
        'glass-lg': '30px',
      },
      animation: {
        'breathe': 'breathe 2s ease-in-out infinite',
        'message-in': 'messageIn 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        'tool-spin': 'toolSpin 1.5s linear infinite',
        'tool-done': 'toolDone 300ms ease-out forwards',
        'fade-up': 'fadeUp 500ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1.0' },
        },
        messageIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        toolSpin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        toolDone: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
```

### 1.3 Font Loading

In `app/layout.tsx`, load fonts:

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Intera — Agentic Customer Service',
  description: 'AI-powered case resolution',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-void">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&family=Noto+Sans+SC:wght@400;500&family=Noto+Serif+SC:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

---

## 2. Component Architecture

### 2.1 File Tree (implementation order)

```
app/
├── globals.css                          # 1. Design tokens
├── layout.tsx                           # 2. Font loading
├── page.tsx                             # 3. Redirect / → /chat
│
├── chat/
│   └── page.tsx                         # 10. Chat page (assembles all chat components)
│
├── admin/
│   ├── page.tsx                         # 12. Admin dashboard (redirect to /admin/agent)
│   ├── layout.tsx                       # 11. Admin shell layout (sidebar + content)
│   ├── agent/
│   │   └── page.tsx                     # 13. Agent config page
│   ├── skills/
│   │   └── page.tsx                     # 14. Skill registry page
│   └── policies/
│       └── page.tsx                     # 15. Policy rules page
│
├── ops/
│   └── human-tasks/
│       ├── page.tsx                     # 16. Human task list
│       └── [id]/
│           └── page.tsx                 # 17. Human task detail
│
components/
├── ui/
│   ├── fluid-background.tsx             # 4. WebGL fluid canvas (core visual)
│   ├── glass-card.tsx                   # 5. Reusable glass card wrapper
│   ├── glass-input.tsx                  # 6. Glass input field
│   ├── status-pill.tsx                  # 7. Capsule status indicator
│   ├── icon-button.tsx                  # 8. Minimal icon button
│   └── tool-indicator.tsx               # 9. Tool execution animation
│
├── chat/
│   ├── chat-shell.tsx                   # 10a. Centered chat container
│   ├── message-bubble.tsx               # 10b. Single message (user/assistant)
│   ├── message-list.tsx                 # 10c. Scrollable message area
│   ├── voice-input-bar.tsx              # 10d. Bottom input + timer + save
│   └── case-rail.tsx                    # 10e. Side case list (desktop only)
│
├── admin/
│   ├── admin-sidebar.tsx                # 11a. 48px icon navigation
│   ├── admin-shell.tsx                  # 11b. Sidebar + content layout
│   ├── config-card.tsx                  # 13a. Reusable config panel
│   ├── json-editor.tsx                  # 13b. JSON field editor
│   └── config-section.tsx               # 13c. Section within a config card
│
└── ops/
    ├── task-list-item.tsx               # 16a. Single task in queue
    └── task-detail-card.tsx             # 17a. Task detail view
```

---

## 3. Component Specifications

### 3.1 FluidBackground

**File:** `components/ui/fluid-background.tsx`
**Dependency:** WebGL Fluid Simulation library (or custom canvas)

```typescript
// Props
interface FluidBackgroundProps {
  intensity?: 'subtle' | 'normal'   // default: 'normal'
  interactive?: boolean             // default: true (follows cursor)
  className?: string
}
```

**Behavior:**
- Renders a `<canvas>` element, position fixed, z-index 0, full viewport
- On mount: initialize WebGL fluid simulation with these config values:
  - `SIM_RESOLUTION`: 128
  - `DYE_RESOLUTION`: 512
  - `DENSITY_DISSIPATION`: 0.995 (ink stays visible for a long time)
  - `VELOCITY_DISSIPATION`: 0.98 (fluid keeps flowing)
  - `PRESSURE`: 0.8
  - `PRESSURE_ITERATIONS`: 20
  - `CURL`: 30
  - `SPLAT_RADIUS`: 0.25
- Auto-inject "splats" every 8-15 seconds at random positions
- Splat colors: `[100,80,160]` (purple), `[60,40,100]` (indigo), `[180,60,50]` (vermillion, rare), `[200,180,140]` (warm grey, rare)
- On `mousemove`: apply splat at cursor position (with velocity damping so it's subtle)
- On `touchmove` (mobile): same behavior
- `intensity='subtle'`: reduce splat frequency to every 20-30s (for admin pages)

**Implementation notes:**
- Use `next/dynamic` with `ssr: false` (canvas is browser-only)
- Wrap in a client component (`'use client'`)
- The fluid canvas renders BELOW all content (z-index: 0)
- Add a gradient overlay on top of the canvas to darken edges: `radial-gradient(ellipse at center, transparent 60%, rgba(8,8,10,0.4) 100%)`

```tsx
// Simplified structure
'use client'
import { useEffect, useRef } from 'react'

export default function FluidBackground({ intensity = 'normal' }: FluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // [MOCK] Initially: use CSS-only animated gradient blobs
    // Production: WebGL fluid simulation
    // CSS blobs are 3-5 large divs with filter: blur(60px) rotating slowly
  }, [intensity])

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 z-0" />
      <div className="fixed inset-0 z-[1] pointer-events-none"
           style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(8,8,10,0.4) 100%)' }} />
    </>
  )
}
```

### 3.2 GlassCard

**File:** `components/ui/glass-card.tsx`

```typescript
interface GlassCardProps {
  variant: 'chat-user' | 'chat-assistant' | 'admin' | 'pill'
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean  // default: false, enables hover effect
}
```

**CSS mapping:**

| variant | background | blur | border | radius |
|---------|-----------|------|--------|--------|
| `chat-user` | `rgba(255,255,255,0.06)` | 20px | `rgba(255,255,255,0.08)` | 16px 4px 16px 16px |
| `chat-assistant` | `rgba(255,255,255,0.02)` | 16px | `rgba(255,255,255,0.04)` | 4px 16px 16px 16px |
| `admin` | `rgba(15,15,15,0.7)` | 16px | `rgba(255,255,255,0.05)` | 8px |
| `pill` | `rgba(15,15,15,0.5)` | 20px | `rgba(255,255,255,0.06)` | 999px |

**Hover state** (when `hover=true`):
```css
.glass-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.10);
  transform: translateY(-1px);
  transition: all 200ms ease-out;
}
```

### 3.3 GlassInput

**File:** `components/ui/glass-input.tsx`

```typescript
interface GlassInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
}
```

**CSS:**
```css
.glass-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  padding: 12px 20px;
  color: var(--mist);
  font-family: var(--font-sans);
  font-size: 15px;
  outline: none;
  transition: border-color 200ms ease-out, box-shadow 200ms ease-out;
}
.glass-input:focus {
  border-color: rgba(230, 69, 57, 0.3);
  box-shadow: 0 0 0 3px rgba(230, 69, 57, 0.08);
}
.glass-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
}
```

### 3.4 StatusPill

**File:** `components/ui/status-pill.tsx`

```typescript
interface StatusPillProps {
  status: 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'
  label: string
}
```

**Renders:**
```
┌─────────────────────────────────┐
│  ●  Intera AI                   │
│  ↑  ↑                           │
│  dot label                      │
└─────────────────────────────────┘
```

**Dot behavior per status:**
- `online`: malachite `#2ea04a`, animation `breathe` (2s pulse)
- `thinking`: indigo `#5b6ef5`, animation `breathe`
- `executing`: amber `#d4912e`, rotating ring (conic-gradient spinner, 12px, 1.5s)
- `waiting`: amber, static (no animation)
- `offline`: smoke `#3d3b38`, static

**CSS:**
```css
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--glass-pill);
  backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--fog);
  text-transform: uppercase;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
```

### 3.5 IconButton

**File:** `components/ui/icon-button.tsx`

```typescript
interface IconButtonProps {
  icon: React.ReactNode
  label?: string           // tooltip text
  onClick?: () => void
  variant?: 'ghost' | 'glass'  // default: 'ghost'
  size?: 'sm' | 'md'           // default: 'md'
}
```

**CSS:**
```css
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--fog);
  transition: all 150ms ease-out;
  background: transparent;
  border: none;
  cursor: pointer;
}
.icon-button:hover {
  color: var(--mist);
  background: rgba(255, 255, 255, 0.06);
}
.icon-button.glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.04);
}
```

### 3.6 ToolIndicator

**File:** `components/ui/tool-indicator.tsx`

```typescript
interface ToolIndicatorProps {
  toolName: string
  status: 'executing' | 'completed' | 'error'
}
```

**Renders:**
- `executing`: A 24px ring with conic-gradient that rotates. Tool name text below in fog, 11px.
- `completed`: Ring becomes a solid green dot, then fades out after 300ms.
- `error`: Ring becomes a solid red dot, text shows error message.

```css
.tool-indicator-ring {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(255,255,255,0.03) 0deg,
    var(--vermillion) 360deg
  );
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #fff calc(100% - 2px));
  animation: toolSpin 1.5s linear infinite;
}
```

---

## 4. Chat Frontend — Complete Specification

### 4.0 Page Layout

**File:** `app/chat/page.tsx`

```
Desktop (≥640px):
┌────────────────────────────────────────────────────┐
│              FluidBackground (full screen)           │
│                                                    │
│         ┌──────────────────────────┐               │
│         │     max-w-[560px]        │               │
│         │     mx-auto              │               │
│         │                         │               │
│         │  StatusPill (centered)  │               │
│         │                         │               │
│         │  MessageList            │               │
│         │  (flex-1, overflow-y)   │               │
│         │                         │               │
│         │  VoiceInputBar          │               │
│         │  (sticky bottom)        │               │
│         └──────────────────────────┘               │
│                                                    │
└────────────────────────────────────────────────────┘

Mobile (<640px):
┌──────────────────┐
│  FluidBg (full)   │
│                  │
│  StatusPill      │
│  (top, centered) │
│                  │
│  MessageList     │
│  (flex-1)        │
│                  │
│  VoiceInputBar   │
│  (bottom fixed)  │
└──────────────────┘
```

### 4.1 ChatShell

Wrapper that centers content and applies the narrow-column constraint.

```tsx
// components/chat/chat-shell.tsx
export default function ChatShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <FluidBackground intensity="normal" />
      <div className="relative z-10 max-w-chat mx-auto min-h-screen flex flex-col px-4">
        {children}
      </div>
    </div>
  )
}
```

### 4.2 StatusPill Bar

Positioned at top of chat area, centered.

```tsx
// In app/chat/page.tsx
<div className="flex justify-center pt-6 pb-8">
  <StatusPill status={agentStatus} label="Intera AI" />
</div>
```

`agentStatus` derives from SSE events:
- `stream_request_start` → `'thinking'`
- `tool_executing` → `'executing'`
- `human_task_created` → `'waiting'`
- `message_stop` (and no tools pending) → `'online'`

### 4.3 MessageBubble

```typescript
interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  toolUses?: ToolUseInfo[]
  timestamp: Date
}
```

**CSS per role:**

```css
/* User message */
.message-user {
  margin-left: auto;
  margin-right: 0;
  max-width: 85%;
  animation: messageIn 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Assistant message */
.message-assistant {
  margin-left: 0;
  margin-right: auto;
  max-width: 90%;
  animation: messageIn 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

**Content rendering:**
- Normal text: `<p>` with `font-serif text-[18px] leading-relaxed text-mist`
- Streaming cursor: inline `<span>` with `animate-pulse opacity-70` — a thin vertical bar `│`
- Tool uses: rendered as `<ToolIndicator />` components below the message text

**Timestamp:**
```css
.message-timestamp {
  font-family: var(--font-sans);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.15);
  margin-top: 6px;
}
```

### 4.4 MessageList

Scrollable container for messages. Auto-scrolls to bottom on new messages.

```tsx
export default function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto py-6 space-y-6">
      {messages.length === 0 && <WelcomeMessage />}
      {messages.map(msg => (
        <MessageBubble key={msg.id} {...msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

**Scrollbar styling:**
```css
.message-list::-webkit-scrollbar {
  width: 4px;
}
.message-list::-webkit-scrollbar-track {
  background: transparent;
}
.message-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}
```

### 4.5 WelcomeMessage

Shown when no messages exist. Sets the tone.

```
┌─────────────────────────────────┐
│                                 │
│         Intera                  │  ← Cormorant Garamond, 32px, mist, italic
│                                 │
│    How can I help you?          │  ← Inter, 15px, fog
│                                 │
│  ┌─────────────────────────┐   │
│  │  Describe your issue...  │   │  ← GlassInput placeholder card
│  └─────────────────────────┘   │
│                                 │
└─────────────────────────────────┘
```

### 4.6 VoiceInputBar — Always-Unlocked + Queue Mode

**Design Principles:**
- Input is **never disabled**. User can type and queue messages at any time, even while Intera is responding.
- Loading/responding state is shown as a bubble **below** the message list, not inside the input area.
- When a message is submitted while Intera is responding, it enters a **queue** and is sent automatically when the current response finishes.

```tsx
interface VoiceInputBarProps {
  onSubmit: (text: string) => void
  // isLoading removed — input is always unlocked
}
```

**Layout:**
```
┌──────────────────────────────────────────────────┐
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Describe your issue...                   │   │  ← Always unlocked
│  └──────────────────────────────────────────┘   │
│                                                  │
│      00:32       [Save Memory]    [✕]           │
│      ↑ timer     ↑ saves to case  ↑ clear        │
│                  memory                          │
└──────────────────────────────────────────────────┘
```

**Behavior:**
- `disabled` prop is removed from GlassInput. User can always type.
- `onSubmit` behavior: if `isLoading`, store message in a `queuedMessages` array (state in page.tsx). When SSE emits `message_stop`, flush the queue in order.
- When queued messages exist, show a small inline hint below the input: "2 messages queued" with a subtle indicator.
- Clear button clears both current input AND queued messages.

### 4.7 Responding Bubble — Loading State Below Messages

**Design Principles:**
- There is **no loading spinner inside the input area**.
- While Intera is generating a response, a "responding bubble" appears at the bottom of the message list, below all existing messages.
- This bubble contains a cycling verb + animated indicator, similar to Claude Code's thinking indicator.
- When Intera stops responding (`message_stop` SSE), the bubble disappears and queued messages (if any) are sent.

**Bubble structure:**
```
┌──────────────────────────────────────────────────┐
│  ○ ○ ○   Intera is examining your order…        │  ← responding bubble
└──────────────────────────────────────────────────┘
   ↑ dot ring   cycling verb phrase
```

**Verb phrase pool** (cycles randomly, ~12-15 varieties, no repetition until exhausted):

| Verb | Tone |
|------|------|
| examining your order | neutral |
| checking payment channels | neutral |
| reviewing your case | neutral |
| looking into this | casual |
| analyzing transaction data | formal |
| verifying deposit status | formal |
| tracing the payment | neutral |
| consulting our records | neutral |
| investigating | short/neutral |
| reviewing details | neutral |
| processing your request | neutral |
| working on it | casual |
| checking the status | casual |
| pulling up your information | casual |
| following the paper trail | playful |

**Dot ring animation** (3 dots, staggered pulse, same timing as `breathe` keyframe):
```css
@keyframes breathe {
  0%, 100% { opacity: 0.3; }
  50%       { opacity: 1.0; }
}
/* Three dots, each delayed by 0.25s */
.dot-1 { animation: breathe 1.4s ease-in-out infinite; }
.dot-2 { animation: breathe 1.4s ease-in-out 0.25s infinite; }
.dot-3 { animation: breathe 1.4s ease-in-out 0.5s infinite; }
```

**Bubble CSS:**
```css
.responding-bubble {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  max-width: 320px;
  animation: fadeUp 400ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.responding-bubble .dots {
  display: flex;
  gap: 4px;
  align-items: center;
}
.responding-bubble .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--indigo);
}
.responding-bubble .verb {
  font-family: var(--font-serif);
  font-size: 14px;
  font-style: italic;
  color: var(--fog);
  letter-spacing: 0.01em;
}
```

**Placement:** Rendered as the last item in `MessageList`, outside the scrollable area, always visible at the bottom — similar to how Claude Code's thinking indicator stays pinned below the latest content.

**Queue hint** (shown below VoiceInputBar when queue is non-empty):
```
┌─────────────────────────┐
│  ⌛ 2 messages queued   │  ← small pill, fog color
└─────────────────────────┘
```

### 4.8 CaseRail

A collapsible side panel showing the user's cases. NOT visible in the centered chat layout by default — shown as an overlay when toggled.

```tsx
// Hidden by default on desktop, toggle with a button in the top-left corner
// Slides in from left, 320px wide, glass background
<div className="fixed left-0 top-0 bottom-0 w-80 z-20
                bg-abyss/80 backdrop-blur-glass-lg
                border-r border-glass-border
                transform -translate-x-full transition-transform duration-300
                data-[open]:translate-x-0">
  {/* Case list content */}
</div>
```


