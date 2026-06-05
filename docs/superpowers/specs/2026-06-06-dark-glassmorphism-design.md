# Dark Glassmorphism Console — Design Spec

## Overview

Redesign the Intera console shell and dashboard page with a dark glassmorphic aesthetic inspired by the Onero and VidGen Dribbble shots. The shell chrome (sidebar, top bar) goes dark glass everywhere. The dashboard gets the full treatment: aurora mesh background, dark glass floating cards, pill navigation. Other pages (admin, ops/chats) keep light content inside the dark shell.

**Approach:** Hybrid — CSS custom property overrides for the dark palette + new aurora background component + dark glass card CSS classes.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Shell chrome + dashboard page | High-impact, contained scope |
| Other pages | Dark shell + light content | Avoids full-dark refactor risk |
| Background | Animated CSS aurora mesh | No image assets needed, lightweight |
| Accent color | Blue-purple gradient (#6366f1 → #a78bfa) | Bridges existing palette with Onero energy |
| Implementation | CSS variables + component enhancements | Balances simplicity with visual depth |

---

## Color System

### Dark Palette (CSS Custom Properties)

Added under `.dark` class on `<html>`:

```css
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
  --shadow-card:       0 4px 24px rgba(0,0,0,0.2);
  --shadow-card-hover: 0 8px 32px rgba(0,0,0,0.3);
  --shadow-glow:       0 0 24px rgba(99, 102, 241, 0.12);
}
```

Accent colors stay the same (`--vermillion`, `--indigo`, `--amber`, `--malachite`) — they already work on dark backgrounds.

---

## Components

### 1. Aurora Background (`aurora-bg.tsx`) — NEW

**Path:** `apps/console/components/ui/aurora-bg.tsx`

Pure CSS animated background. Three radial gradient orbs with blur and float animation.

**Props:**
- `variant: 'dashboard' | 'minimal'` — dashboard = 3 orbs full opacity, minimal = 2 orbs reduced
- `className?: string`

**Implementation:**
- 3 `<div>` elements positioned absolutely, each with a radial gradient
- Colors: indigo (`rgba(99,102,241,0.12)`), violet (`rgba(139,92,246,0.1)`), blue (`rgba(59,130,246,0.06)`)
- `filter: blur(80-100px)` on each
- CSS `float` animation (8-11s, staggered delays)
- `prefers-reduced-motion: reduce` disables animation
- `pointer-events: none` — non-interactive

### 2. Dark Glass Card CSS — NEW

New classes in `globals.css`:

```css
.dark .glass-card-dark {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.2),
              inset 0 1px 0 rgba(255,255,255,0.04);
  transition: all 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dark .glass-card-dark:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
}
```

Additional dark variants:
- `.glass-sidebar-dark` — sidebar glass (32px blur, slightly more opaque)
- `.glass-topbar-dark` — top bar glass (16px blur, minimal)
- `.glass-pill-dark` — pill nav active state

### 3. Shell Chrome Updates

**File:** `apps/console/components/console-shell.tsx`

Changes:
- Sidebar: apply `glass-sidebar-dark` class, dark background
- Top bar: pill-style segmented navigation (replace current tabs)
- Active nav item: blue-purple glow background instead of lavender tint
- User avatar section at sidebar bottom
- Notification badge on bell icon

**File:** `apps/console/components/console-sidebar.tsx`

Changes:
- Dark glass background
- White text at varying opacities
- Active item: `rgba(99,102,241,0.12)` background + purple text
- Section labels: `rgba(255,255,255,0.25)` uppercase

### 4. Dashboard Page Updates

**File:** `apps/console/app/ops/dashboards/page.tsx`

Changes:
- Wrap page in `<AuroraBackground variant="dashboard" />`
- All cards use `glass-card-dark` class
- Keep existing data fetching and widget components (RingProgress, DotMatrixNumber, AnimatedCounter)
- Metric card icons get dark-compatible backgrounds
- Status dots and text colors adjusted for dark backgrounds

### 5. GlassCard Component Update

**File:** `apps/console/components/ui/glass-card.tsx`

Add `dark` variant:
```tsx
type GlassVariant = 'chat-user' | 'chat-assistant' | 'admin' | 'pill' | 'dark'
```

`dark` variant applies `glass-card-dark` class.

### 6. Tailwind Config Update

**File:** `apps/console/tailwind.config.ts`

```ts
darkMode: 'class',
```

---

## Layout

### Dashboard Page Layout

```
┌──────────────────────────────────────────────┐
│  [Aurora Background — full viewport]          │
│  ┌──────────────────────────────────────────┐ │
│  │  Top Bar: Pill nav (Overview|Chats|...)  │ │
│  ├──────────────────────────────────────────┤ │
│  │  Page Title                              │ │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │ │
│  │  │ Msgs │ │Cases │ │ Res. │ │Guard.│   │ │
│  │  │ 24h  │ │      │ │ Ring │ │ Hits │   │ │
│  │  └──────┘ └──────┘ └──────┘ └──────┘   │ │
│  │  ┌──────────────┐ ┌──────────────┐      │ │
│  │  │ Recent Cases  │ │Channel Health│      │ │
│  │  │              │ │              │      │ │
│  │  └──────────────┘ └──────────────┘      │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### Shell Layout

```
┌────────┬────────────────────────────────────┐
│Sidebar │  Top Bar (pill nav + notifications) │
│        ├────────────────────────────────────┤
│ Logo   │                                    │
│ Nav    │  Page Content                      │
│ Items  │  (dark shell, light content for    │
│        │   non-dashboard pages)             │
│ User   │                                    │
└────────┴────────────────────────────────────┘
```

---

## Accessibility

- `prefers-reduced-motion: reduce` — disable aurora float animations
- All text colors meet WCAG AA contrast on dark backgrounds (white at 92% on #08080f = ~15:1 ratio)
- Focus rings use `--border-focus` (blue-purple at 35% opacity) — visible on dark
- Glass cards have sufficient border contrast (6% white on near-black)
- Status indicators use color + text (not color alone)

---

## Performance

- Aurora background: CSS-only, no JS animation loops. `will-change: transform` on orbs for GPU acceleration
- `backdrop-filter` is GPU-composited — no layout thrashing
- No new dependencies added
- Reduced motion respected — zero animation cost when disabled

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `apps/console/app/globals.css` | Modify | Add `.dark` scope (~80 lines), dark glass classes |
| `apps/console/tailwind.config.ts` | Modify | Add `darkMode: 'class'` |
| `apps/console/app/layout.tsx` | Modify | Add `dark` class to `<html>` |
| `apps/console/components/console-shell.tsx` | Modify | Dark glass sidebar + top bar |
| `apps/console/components/console-sidebar.tsx` | Modify | Dark sidebar styling |
| `apps/console/app/ops/dashboards/page.tsx` | Modify | Aurora bg + dark glass cards |
| `apps/console/components/ui/aurora-bg.tsx` | **Create** | Aurora background component |
| `apps/console/components/ui/glass-card.tsx` | Modify | Add `dark` variant |

---

## Out of Scope

- Light/dark mode toggle (shell is always dark)
- Dark mode for admin/ops content pages (they stay light inside dark shell)
- 3D background or WebGL (CSS aurora only)
- Bottom dock (not in current shell design)
- New dashboard data widgets (existing RingProgress, DotMatrixNumber, AnimatedCounter reused)
