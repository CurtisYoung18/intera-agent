# Dark Glassmorphism Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the console shell and dashboard with Onero-style dark glassmorphism — aurora mesh background, dark frosted glass cards, blue-purple accent gradient.

**Architecture:** CSS custom properties under `.dark` scope for the dark palette, a new `AuroraBackground` component for the animated mesh, and dark glass card CSS classes. Shell chrome (sidebar, top bar) goes dark globally. Dashboard gets the full aurora + dark card treatment. Other pages keep light content inside the dark shell.

**Tech Stack:** React 19, Next.js 15 App Router, Tailwind CSS 3, CSS custom properties, CSS keyframe animations, existing glass-card design system

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/console/tailwind.config.ts` | Modify | Add `darkMode: 'class'` |
| `apps/console/app/globals.css` | Modify | Add `.dark` scope (~100 lines), dark glass classes, aurora keyframes |
| `apps/console/app/layout.tsx` | Modify | Add `dark` class to `<html>` |
| `apps/console/components/ui/aurora-bg.tsx` | **Create** | Aurora mesh background component |
| `apps/console/components/ui/glass-card.tsx` | Modify | Add `dark` variant |
| `apps/console/components/console-sidebar.tsx` | Modify | Dark glass sidebar styling |
| `apps/console/components/console-shell.tsx` | Modify | Dark shell, conditional aurora |
| `apps/console/app/ops/dashboards/page.tsx` | Modify | Aurora bg + dark glass cards |

---

### Task 1: Tailwind Config — Enable Dark Mode

**Files:**
- Modify: `apps/console/tailwind.config.ts`

- [ ] **Step 1: Add `darkMode: 'class'` to Tailwind config**

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/shared/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: 'var(--void)',
        abyss: 'var(--abyss)',
        basalt: 'var(--basalt)',
        obsidian: 'var(--obsidian)',
        mist: 'var(--mist)',
        fog: 'var(--fog)',
        smoke: 'var(--smoke)',
        vermillion: 'var(--vermillion)',
        indigo: 'var(--indigo)',
        amber: 'var(--amber)',
        malachite: 'var(--malachite)',
        gold: 'var(--gold)',
        'gold-hover': 'var(--gold-hover)',
        'gold-muted': 'var(--gold-muted)',
        lavender: 'var(--lavender)',
        sky: 'var(--sky)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/tailwind.config.ts
git commit -m "chore: enable Tailwind darkMode class strategy"
```

---

### Task 2: Dark Palette CSS + Dark Glass Classes + Aurora Keyframes

**Files:**
- Modify: `apps/console/app/globals.css`

- [ ] **Step 1: Add `.dark` scope and dark glass classes to globals.css**

Append the following block at the end of `globals.css` (after the existing `@keyframes` and animation utility classes, before the Playground section):

```css
/* ────────────────────────────────────────────
   Dark Glassmorphism Theme
   ──────────────────────────────────────────── */

.dark {
  /* Backgrounds — near-black with blue undertone */
  --void:     #08080f;
  --abyss:    #0c0c14;
  --basalt:   #12121c;
  --obsidian: #1a1a28;

  /* Text — white at varying opacities */
  --mist:     rgba(255, 255, 255, 0.92);
  --fog:      rgba(255, 255, 255, 0.45);
  --smoke:    rgba(255, 255, 255, 0.25);

  /* Glass surfaces */
  --surface:       rgba(255, 255, 255, 0.04);
  --surface-hover: rgba(255, 255, 255, 0.07);
  --surface-accent: rgba(99, 102, 241, 0.08);

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-hover:  rgba(99, 102, 241, 0.2);
  --border-focus:  rgba(99, 102, 241, 0.35);

  /* Shadows */
  --shadow-card:       0 4px 24px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  --shadow-card-hover: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  --shadow-glow:       0 0 24px rgba(99, 102, 241, 0.12);
}

/* Dark base background */
.dark body,
.dark html {
  background: #08080f;
  color: var(--mist);
}

/* ── Dark glass card ── */
.dark .glass-card-dark {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: all 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dark .glass-card-dark:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* ── Dark sidebar glass ── */
.dark .glass-sidebar-dark {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(32px) saturate(150%);
  -webkit-backdrop-filter: blur(32px) saturate(150%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Dark top bar glass ── */
.dark .glass-topbar-dark {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

/* ── Dark pill nav active ── */
.dark .glass-pill-active-dark {
  background: rgba(99, 102, 241, 0.15);
  color: rgba(167, 139, 250, 0.95);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

/* ── Dark nav item active ── */
.dark .nav-item-active-dark {
  background: rgba(99, 102, 241, 0.12);
  color: rgba(167, 139, 250, 0.95);
}

/* ── Dark dot grid overlay ── */
.dark .dot-grid-dark {
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
}

/* ── Aurora mesh background ── */
@keyframes aurora-float-1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -40px) scale(1.08); }
  66% { transform: translate(-20px, 25px) scale(0.95); }
}

@keyframes aurora-float-2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(-25px, 35px) scale(0.96); }
  66% { transform: translate(35px, -20px) scale(1.06); }
}

@keyframes aurora-float-3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, -15px) scale(1.04); }
}

.aurora-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  will-change: transform;
  pointer-events: none;
}

.aurora-orb-1 {
  width: 600px;
  height: 600px;
  top: -15%;
  right: -10%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.12), transparent 70%);
  animation: aurora-float-1 10s ease-in-out infinite;
}

.aurora-orb-2 {
  width: 500px;
  height: 500px;
  bottom: -10%;
  left: -5%;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.1), transparent 70%);
  animation: aurora-float-2 12s ease-in-out infinite 1.5s;
}

.aurora-orb-3 {
  width: 400px;
  height: 400px;
  top: 35%;
  left: 35%;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.06), transparent 70%);
  animation: aurora-float-3 11s ease-in-out infinite 3s;
}

/* Reduced motion: kill aurora animations */
@media (prefers-reduced-motion: reduce) {
  .aurora-orb {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/app/globals.css
git commit -m "feat(ui): add dark glassmorphism CSS — palette, glass classes, aurora keyframes"
```

---

### Task 3: Add `dark` Class to Layout

**Files:**
- Modify: `apps/console/app/layout.tsx`

- [ ] **Step 1: Add `dark` class to `<html>` element**

Change line 13 from:
```tsx
<html lang="en" className="light">
```
to:
```tsx
<html lang="en" className="dark">
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/app/layout.tsx
git commit -m "feat: enable dark theme on console shell"
```

---

### Task 4: Aurora Background Component

**Files:**
- Create: `apps/console/components/ui/aurora-bg.tsx`

- [ ] **Step 1: Create the AuroraBackground component**

```tsx
'use client'

interface AuroraBgProps {
  variant?: 'dashboard' | 'minimal'
  className?: string
}

export default function AuroraBg({ variant = 'dashboard', className = '' }: AuroraBgProps) {
  const orb3 = variant === 'dashboard'

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      {orb3 && <div className="aurora-orb aurora-orb-3" />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/ui/aurora-bg.tsx
git commit -m "feat(ui): add AuroraBackground component — CSS mesh gradient"
```

---

### Task 5: GlassCard — Add Dark Variant

**Files:**
- Modify: `apps/console/components/ui/glass-card.tsx`

- [ ] **Step 1: Add `dark` variant to GlassCard**

Replace the full file with:

```tsx
'use client'

import type { ReactNode } from 'react'

type GlassVariant = 'chat-user' | 'chat-assistant' | 'admin' | 'pill' | 'dark'

interface GlassCardProps {
  variant: GlassVariant
  children: ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
}

const VARIANT_STYLES: Record<GlassVariant, string> = {
  'chat-user':
    'glass-chat-user px-4 py-3',
  'chat-assistant':
    'glass-chat-assistant px-4 py-3',
  'admin':
    'glass-admin p-6',
  'pill':
    'glass-pill px-4 py-2',
  'dark':
    'glass-card-dark p-5',
}

export default function GlassCard({
  variant,
  children,
  className = '',
  onClick,
  hover = false,
}: GlassCardProps) {
  const base = VARIANT_STYLES[variant]
  const hoverClass = hover ? 'glass-card-hover cursor-pointer' : ''
  const role = onClick ? 'button' : undefined

  return (
    <div
      className={`${base} ${hoverClass} ${className}`}
      onClick={onClick}
      role={role}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/ui/glass-card.tsx
git commit -m "feat(ui): add dark variant to GlassCard component"
```

---

### Task 6: Dark Glass Sidebar

**Files:**
- Modify: `apps/console/components/console-sidebar.tsx`

- [ ] **Step 1: Update sidebar `<aside>` background classes**

On line 198-200, change the `<aside>` className from:
```tsx
className={`relative z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-out
  bg-white/50 backdrop-blur-2xl border-r border-black/5
  ${collapsed ? 'w-14' : 'w-56'} h-full`}
```
to:
```tsx
className={`relative z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-out
  glass-sidebar-dark
  ${collapsed ? 'w-14' : 'w-56'} h-full`}
```

- [ ] **Step 2: Update logo border divider**

On line 202, change:
```tsx
<div className="relative z-30 flex-shrink-0 border-b border-black/[0.05] pb-3 pt-3">
```
to:
```tsx
<div className="relative z-30 flex-shrink-0 border-b border-white/[0.06] pb-3 pt-3">
```

- [ ] **Step 3: Update collapsed logo toggle button**

On line 208, change:
```tsx
className="flex w-full flex-col items-center gap-2 rounded-xl p-3 text-[var(--fog)] transition-colors hover:bg-black/[0.04] hover:text-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25 focus-visible:ring-offset-2"
```
to:
```tsx
className="flex w-full flex-col items-center gap-2 rounded-xl p-3 text-[var(--fog)] transition-colors hover:bg-white/[0.06] hover:text-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25 focus-visible:ring-offset-2"
```

- [ ] **Step 4: Update collapsed logo icon border**

On line 211, change:
```tsx
<div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
```
to:
```tsx
<div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo/30 bg-gradient-to-br from-indigo/20 to-indigo/5">
```

- [ ] **Step 5: Update agent switcher border**

On line 237, change:
```tsx
<div className="flex-shrink-0 px-3 py-2 border-b border-black/[0.04]">
```
to:
```tsx
<div className="flex-shrink-0 px-3 py-2 border-b border-white/[0.06]">
```

- [ ] **Step 6: Update agent settings button hover**

On line 249, change:
```tsx
className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/[0.05] text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
```
to:
```tsx
className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
```

- [ ] **Step 7: Update controls panel border**

On line 263, change:
```tsx
<div className="border-t border-white/[0.06]">
```
to:
```tsx
<div className="border-t border-white/[0.06]">
```
(This is already correct — the sidebar bottom border uses `border-white` which works in both themes. Keep as-is.)

- [ ] **Step 8: Update controls panel buttons hover**

On line 271, change:
```tsx
className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
```
to:
```tsx
className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-white/[0.06] rounded-lg transition-all"
```

Apply the same `hover:bg-black/5` → `hover:bg-white/[0.06]` change to all similar button classes in the controls panel (lines ~271, ~279, ~316).

- [ ] **Step 9: Update customer list border**

On line 287, change:
```tsx
<div className="ml-4 py-1 space-y-0.5 border-l border-black/[0.06] pl-2">
```
to:
```tsx
<div className="ml-4 py-1 space-y-0.5 border-l border-white/[0.08] pl-2">
```

- [ ] **Step 10: Update customer list items hover**

On line 298, change:
```tsx
className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.03] rounded-md transition-all text-left"
```
to:
```tsx
className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-white/[0.05] rounded-md transition-all text-left"
```

- [ ] **Step 11: Update sign out button hover**

On line 316, change:
```tsx
className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/5 rounded-lg transition-all"
```
to:
```tsx
className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/10 rounded-lg transition-all"
```

- [ ] **Step 12: Update bottom bar user button**

On line 326-327, change:
```tsx
className={`w-full flex items-center gap-2.5 px-3 transition-all ${collapsed ? 'justify-center py-2.5' : 'py-2 hover:bg-black/[0.02]'}`}
```
to:
```tsx
className={`w-full flex items-center gap-2.5 px-3 transition-all ${collapsed ? 'justify-center py-2.5' : 'py-2 hover:bg-white/[0.04]'}`}
```

- [ ] **Step 13: Update user avatar border**

On line 329, change:
```tsx
<div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
```
to:
```tsx
<div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-indigo/30 bg-gradient-to-br from-indigo/20 to-indigo/5">
```

- [ ] **Step 14: Update version text opacity**

On line 341, change:
```tsx
<p className="text-[9px] text-[var(--fog)]/40 font-mono px-3 pb-2">{t('shell.version')}</p>
```
to:
```tsx
<p className="text-[9px] text-[var(--smoke)] font-mono px-3 pb-2">{t('shell.version')}</p>
```

- [ ] **Step 15: Update NavGroup label color**

On line 373, change:
```tsx
<p className="px-2.5 mb-1 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--fog)]/40">
```
to:
```tsx
<p className="px-2.5 mb-1 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--smoke)]">
```

- [ ] **Step 16: Update NavGroup link hover**

On line 389-392, change:
```tsx
className={`flex items-center rounded-lg transition-all duration-200 group relative ${
  collapsed ? 'justify-center py-2.5 px-0' : 'gap-2.5 px-2.5 py-2'
} ${
  active
    ? 'bg-black/[0.04]'
    : 'hover:bg-black/[0.02]'
}`}
```
to:
```tsx
className={`flex items-center rounded-lg transition-all duration-200 group relative ${
  collapsed ? 'justify-center py-2.5 px-0' : 'gap-2.5 px-2.5 py-2'
} ${
  active
    ? 'nav-item-active-dark'
    : 'hover:bg-white/[0.05]'
}`}
```

- [ ] **Step 17: Update badge background**

On line 411, change:
```tsx
<span className="ml-1.5 inline-flex items-center rounded-full bg-indigo/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo">
```
to:
```tsx
<span className="ml-1.5 inline-flex items-center rounded-full bg-indigo/15 px-1.5 py-0.5 text-[9px] font-semibold text-indigo">
```

- [ ] **Step 18: Commit**

```bash
git add apps/console/components/console-sidebar.tsx
git commit -m "feat(sidebar): dark glass styling — backdrop blur, white borders, active state glow"
```

---

### Task 7: Dark Console Shell

**Files:**
- Modify: `apps/console/components/console-shell.tsx`

- [ ] **Step 1: Replace LiquidGlassBg with conditional aurora**

Replace the full file with:

```tsx
// ConsoleShell — full-width canvas with dark glass shell

'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import ConsoleBackToTop from '@/components/console-back-to-top'
import ConsoleSidebar from './console-sidebar'
import AuroraBg from '@/components/ui/aurora-bg'
import { AgentProvider } from '@/lib/agent/agent-context'
import AgentOnboardingGate from '@/components/admin/agent-onboarding'

interface ConsoleShellProps {
  children: ReactNode
}

export default function ConsoleShell({ children }: ConsoleShellProps) {
  const pathname = usePathname()
  // The login page renders standalone — no sidebar / preview chrome.
  if (pathname === '/login') return <>{children}</>

  const isDashboard = pathname.startsWith('/ops/dashboards')

  return (
    <AgentProvider>
      <div className="relative flex h-[100dvh] min-h-0 overflow-hidden bg-[#08080f]">
        {/* Aurora background — full dashboard, minimal elsewhere */}
        <AuroraBg variant={isDashboard ? 'dashboard' : 'minimal'} />

        {/* Subtle dot grid overlay — command center feel */}
        <div
          className="fixed inset-0 z-[1] pointer-events-none dot-grid-dark opacity-[0.04]"
        />

        <ConsoleSidebar />

        <main
          id="console-scroll-root"
          className="relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain"
        >
          <AgentOnboardingGate>
            {children}
          </AgentOnboardingGate>
          <ConsoleBackToTop />
        </main>
      </div>
    </AgentProvider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/console-shell.tsx
git commit -m "feat(shell): dark glass shell with aurora background, conditional variant"
```

---

### Task 8: Dashboard Page — Dark Glass Cards

**Files:**
- Modify: `apps/console/app/ops/dashboards/page.tsx`

- [ ] **Step 1: Update dashboard page with dark glass cards**

Replace the full file with:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Briefcase, Clock, Shield, ArrowRight, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import RingProgress from '@/components/ui/ring-progress'
import DotMatrixNumber from '@/components/ui/dot-matrix-number'
import AnimatedCounter from '@/components/ui/animated-counter'

interface DashboardData {
  overview: {
    messages24h: number
    activeCases: number
    avgResolutionMin: number | null
  }
  guardrailHits: Array<{ name: string; hits: number }>
  channelHealth: Array<{ channel: string; status: string; lastChecked: string; lastError: string | null }>
  recentCases: Array<{ id: string; type: string; status: string; createdAt: string }>
}

const L = {
  title: { en: 'Dashboard', zh: '运营仪表盘' },
  subtitle: { en: 'System overview and health monitoring', zh: '系统概览与健康监控' },
  messages24h: { en: 'Messages 24h', zh: '24H 消息' },
  activeCases: { en: 'Active Cases', zh: '活跃案例' },
  avgResolution: { en: 'Avg Resolution', zh: '平均响应' },
  guardrailHits: { en: 'Guardrail Hits', zh: '护栏命中' },
  guardrailHits24h: { en: 'Guardrail Hits (24h)', zh: '护栏命中 (24h)' },
  channelHealth: { en: 'Channel Health', zh: '渠道健康' },
  recentCases: { en: 'Recent Cases', zh: '最近案例' },
  noData: { en: 'No data yet', zh: '暂无数据' },
  min: { en: 'min', zh: '分钟' },
  healthy: { en: 'Healthy', zh: '正常' },
  token_expired: { en: 'Token expired', zh: '令牌过期' },
  unreachable: { en: 'Unreachable', zh: '不可达' },
  rate_limited: { en: 'Rate limited', zh: '限流中' },
  loading: { en: 'Loading…', zh: '加载中…' },
  noGuardrails: { en: 'No guardrail activity yet.', zh: '暂无护栏活动' },
  viewAll: { en: 'View all', zh: '查看全部' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

const statusColors: Record<string, string> = {
  healthy: 'bg-emerald-400', token_expired: 'bg-red-400', unreachable: 'bg-red-400', rate_limited: 'bg-amber-400',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const l = useL()

  useEffect(() => {
    apiClient<DashboardData>('/api/ops/dashboard')
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('loading')}</div>
  if (!data) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('noData')}</div>

  const { overview, guardrailHits, channelHealth, recentCases } = data
  const totalGuardrail = guardrailHits.reduce((s, g) => s + g.hits, 0)

  return (
    <div className="relative p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{l('title')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      {/* ── Top metrics: 4-column ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 24H Messages */}
        <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#6366f1]/15 icon-pulse">
              <MessageSquare className="w-4 h-4 text-[#a78bfa]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('messages24h')}</span>
          </div>
          <AnimatedCounter target={overview.messages24h} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
        </div>

        {/* Active Cases */}
        <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#f59e0b]/12 icon-pulse">
              <Briefcase className="w-4 h-4 text-[#fbbf24]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('activeCases')}</span>
          </div>
          <AnimatedCounter target={overview.activeCases} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
        </div>

        {/* Avg Resolution — Ring */}
        <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#14b8a6]/12 icon-pulse">
              <Clock className="w-4 h-4 text-[#2dd4bf]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('avgResolution')}</span>
          </div>
          <div className="flex justify-center">
            <RingProgress
              value={overview.avgResolutionMin != null ? Math.min(100, Math.max(0, 100 - overview.avgResolutionMin)) : 0}
              size={110}
              strokeWidth={6}
              color="var(--malachite)"
              label={`${overview.avgResolutionMin ?? '—'} ${l('min')}`}
            />
          </div>
        </div>

        {/* Guardrail Hits */}
        <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#8b6ff5]/12 icon-pulse">
              <Shield className="w-4 h-4 text-[#a78bfa]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('guardrailHits')}</span>
          </div>
          <AnimatedCounter target={totalGuardrail} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
          {guardrailHits.length > 0 && (
            <div className="mt-3 space-y-1">
              {guardrailHits.slice(0, 3).map((g) => (
                <div key={g.name} className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--fog)] truncate max-w-[120px]">{g.name}</span>
                  <span className="text-[10px] font-mono text-[var(--smoke)]">{g.hits}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Cases */}
        <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-bold text-[var(--mist)]">{l('recentCases')}</h2>
            <Link href="/ops/chats" className="flex items-center gap-1 text-[11px] text-indigo/60 hover:text-indigo transition-colors">
              {l('viewAll')} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentCases.length === 0 ? (
            <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noData')}</p>
          ) : (
            <div className="space-y-2">
              {recentCases.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'resolved' ? 'bg-emerald-400' : c.status === 'escalated' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="text-[12px] text-[var(--mist)] flex-1 min-w-0 truncate">{c.type.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-[var(--smoke)] flex-shrink-0">{timeAgo(c.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channel Health + Guardrail Hits */}
        <div className="space-y-4">
          <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
            <h2 className="text-[13px] font-bold text-[var(--mist)] mb-4">{l('channelHealth')}</h2>
            {channelHealth.length === 0 ? (
              <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noData')}</p>
            ) : (
              <div className="space-y-2">
                {channelHealth.map((ch) => (
                  <div key={ch.channel} className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[ch.status] || 'bg-white/20'}`} />
                    <span className="text-[12px] text-[var(--mist)] flex-1 capitalize">{ch.channel}</span>
                    <span className="text-[11px] text-[var(--fog)]">{l(ch.status as keyof typeof L)}</span>
                    <span className="text-[10px] text-[var(--smoke)]">{timeAgo(ch.lastChecked)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card-dark p-5 transition-all duration-250 hover:-translate-y-0.5">
            <h2 className="text-[13px] font-bold text-[var(--mist)] mb-4">{l('guardrailHits24h')}</h2>
            {guardrailHits.length === 0 ? (
              <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noGuardrails')}</p>
            ) : (
              <div className="space-y-2">
                {guardrailHits.map((g) => (
                  <div key={g.name} className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--mist)]">{g.name}</span>
                    <span className="text-[11px] font-mono text-[var(--fog)]">{g.hits.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/app/ops/dashboards/page.tsx
git commit -m "feat(dashboard): dark glass cards with aurora background"
```

---

### Task 9: Verify and Polish

- [ ] **Step 1: Run dev server and verify**

```bash
cd apps/console && npm run dev
```

Open `http://localhost:3000/ops/dashboards` — verify:
- Dark shell with aurora background visible
- Sidebar has dark glass effect with backdrop blur
- Top bar has subtle glass effect
- Dashboard cards use dark glass treatment
- All metric numbers, ring progress, and dot-matrix render correctly
- Text is readable on dark backgrounds (high contrast)
- Hover states work on cards and nav items
- No console errors

- [ ] **Step 2: Check other pages render correctly**

Navigate to `/admin/agent`, `/ops/chats` — verify:
- Dark shell chrome (sidebar + background) present
- Page content stays light/readable
- No visual breakage on non-dashboard pages

- [ ] **Step 3: Check responsive layout**

Resize to mobile width — verify:
- Sidebar collapses correctly
- Dashboard cards stack to single column
- Text remains readable

- [ ] **Step 4: Check reduced motion**

Enable `prefers-reduced-motion: reduce` in browser dev tools — verify:
- Aurora orb animations stop
- Other transitions still work

- [ ] **Step 5: Final polish commit**

```bash
git add -A
git commit -m "fix(dashboard): polish dark glass spacing, contrast, and responsive layout"
```
