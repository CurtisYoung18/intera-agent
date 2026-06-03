# Intera Animated Logo Lockup — Implementation Handoff

> **Source prototype**: `/Users/curtis/Desktop/LOGO_LOCKUP.html`
> **Target**: Replace `packages/shared/ui/intera-logo.tsx`
> **Date**: 2026-06-03

---

## Phase 0 — Audit: Where the logo lives today

Only **3 usage sites** (surprisingly clean):

| # | File | Usage | Current props |
|---|------|-------|---------------|
| 1 | `apps/console/components/console-sidebar.tsx` | Expanded sidebar header | `<InteraLogo size={26} />` |
| 2 | `apps/console/components/console-sidebar.tsx` | Collapsed sidebar icon | `<InteraLogo size={15} collapsed />` |
| 3 | `apps/console/app/login/page.tsx` | Login brand panel (dark bg) | `<InteraLogo size={22} />` |

**CSS that must change**: `apps/console/app/globals.css` lines with `.intera-logo`, `.il-anchor`, `.il-letter`, `.is-revealed`, `.is-collapsed`.

**Files that must NOT change**: No other files reference the logo component. `apps/chat` doesn't use it. The `page.tsx` root redirect doesn't use it. The admin layout doesn't use it.

---

## Phase 1 — Extract SVG helpers

**File**: `packages/shared/ui/intera-svg.ts` (NEW)

Extract from `LOGO_LOCKUP.html`:

```ts
// packages/shared/ui/intera-svg.ts
// Pure DOM helpers — no React, no state. Callable from any component.

export function gradientDefs(id: string): string
export function serifISvg(size: number, strokeColor: string): SVGSVGElement
export function serifASvg(size: number, strokeColor: string): SVGSVGElement
export interface DiscElements { disc: HTMLDivElement; shimmer: HTMLDivElement }
export function makeDisc(
  size: number,
  theme: 'light' | 'dark'
): DiscElements
```

**What to copy from the prototype:**
- `gradDefs()` — generates `<defs><linearGradient>...</linearGradient></defs>` string
- `iSvg()` — the **second** definition only (the first with `withBase` param is dead code, DELETE IT)
- `aSvg()` — the serif "A" with 7 strokes: left leg, left serif, right leg, right serif, crossbar, apex, base line
- `makeDisc()` — creates a glass disc div with gradient bg, border, box-shadow, and shimmer child

**Color mapping** (replace prototype hardcodes):

| Prototype | New |
|-----------|-----|
| `'#1a1814'` | `getComputedStyle(document.documentElement).getPropertyValue('--mist').trim()` |
| `'#5b8af7'` | `var(--indigo)` |
| `'#8b6ff5'` | `var(--lavender)` |
| `'#5bb8f7'` | `var(--sky)` |
| `'rgba(139,111,245,...)'` | template literal using `var(--lavender)` decomposed to RGB — or compute at runtime |

**Gradient strings**: Since CSS variables can't be used inside `rgba()` in inline styles, compute the gradient at call time:

```ts
function discBackground(theme: 'light' | 'dark'): string {
  if (theme === 'dark') {
    return 'linear-gradient(150deg, rgba(139,111,245,0.30), rgba(91,138,247,0.10))'
  }
  return 'linear-gradient(150deg, rgba(139,111,245,0.15), rgba(91,138,247,0.05))'
}
```

(These specific rgba values are stable design constants — they don't change per-theme beyond light/dark toggle.)

**Verification**: This module has no React dependency. It returns DOM elements. Test by calling `serifISvg(84, '#1a1814')` and checking it renders in a browser.

**Dead code to delete**: The prototype has two `iSvg()` definitions. Only keep the second (2-param version). Delete the first (3-param `withBase` version) entirely. Also delete the unused `aNatW` variable.

---

## Phase 2 — Rewrite `intera-logo.tsx`

**File**: `packages/shared/ui/intera-logo.tsx` (REWRITE, don't create new)

### 2a. Props

```ts
interface InteraLogoProps {
  /** Base size in px. Everything scales: discs, fonts, stroke widths.
   *  15 = collapsed sidebar | 22 = login brand | 26 = expanded sidebar | 84 = hero */
  size?: number

  /** Sidebar collapsed — show only the I disc mark */
  collapsed?: boolean

  /** Animation mode:
   *  'idle'  — shimmer + wordmark, no AI transition (sidebar, login)
   *  'click' — idle by default, click to trigger AI reveal (sidebar interactive)
   *  'none'  — static render, no JS animation (SSR fallback) */
  mode?: 'idle' | 'click' | 'none'

  /** Theme — affects disc background and text color */
  theme?: 'light' | 'dark'

  /** Click handler. When mode='click', this fires AFTER the AI reveal animation */
  onClick?: () => void
}
```

### 2b. Behavior per mode

| mode | Sidebar expanded (size=26) | Login brand (size=22) | Sidebar collapsed (size=15) |
|------|---------------------------|-----------------------|-----------------------------|
| `'idle'` | I disc shimmers once, "ntera" text appears. Static after ~1.5s. | Same as sidebar. | Just the I disc. Static. |
| `'click'` | Default idle. On click → AI reveal transition. | Not used here. | N/A (no text to click on). |
| `'none'` | Static "Intera" serif text. No JS at all. | Used during SSR fallback. | Static I disc. |

### 2c. Implementation structure

```
intera-logo.tsx
├── Imports: useRef, useEffect, useCallback, useState
├── Import SVG helpers from './intera-svg'
├── Props interface
├── Animation utility hooks (useRef-based)
│   ├── animsRef: Animation[]
│   ├── timersRef: number[]
│   ├── addAnim(a: Animation): void
│   ├── addTimer(id: number): void
│   ├── clearAll(): void
│   └── schedule(fn, ms): void
├── Scaling helpers
│   ├── scaledDiscSize(size): number      // = size
│   ├── scaledFontSize(size): number      // = size * 0.76
│   └── scaledStrokeWidth(size): number   // = size * 0.06 (clamped 1-5px)
├── Mode-specific render branches
│   ├── collapsed → render I disc only
│   ├── mode='none' → static serif "Intera" text
│   └── mode='idle'|'click' → full animation component
├── playIdle() — shimmer intro + wordmark reveal (no AI transition)
├── playAIReveal() — the full Ink Flow choreography (Phase 3 of prototype)
├── useEffect for mount/unmount cleanup
└── JSX: stage → lockup → discs + wordmark
```

### 2d. Key React patterns

**Replace global state with refs:**

```ts
// Prototype
let anims = []
let timers = []
function clearAnims() { anims.forEach(a => a.cancel()); timers.forEach(clearTimeout) }
function T(fn, ms) { const t = setTimeout(fn, ms); timers.push(t); return t }
function A(el, kf, opt) { const a = el.animate(kf, opt); anims.push(a); return a }

// React
const animsRef = useRef<Animation[]>([])
const timersRef = useRef<number[]>([])
const clearAll = useCallback(() => {
  animsRef.current.forEach(a => { try { a.cancel() } catch {} })
  animsRef.current = []
  timersRef.current.forEach(clearTimeout)
  timersRef.current = []
}, [])
```

**Replace `getElementById` with refs:**

```ts
const stageRef = useRef<HTMLDivElement>(null)
const lockupRef = useRef<HTMLDivElement>(null)
// Use: stageRef.current, lockupRef.current
```

**Replace `innerHTML = ''` with DOM cleanup:**

```ts
const clearLockup = useCallback(() => {
  const el = lockupRef.current
  if (!el) return
  while (el.firstChild) el.removeChild(el.firstChild)
}, [])
```

**Font-ready gate:**

```ts
useEffect(() => {
  const run = () => {
    clearAll()
    clearLockup()
    playAnimation()
  }
  if (document.fonts.status === 'loaded') {
    run()
  } else {
    document.fonts.ready.then(run)
  }
  return clearAll
}, [size, mode, theme])
```

### 2e. Scaling

All sizes scale linearly from the `size` prop:

```
disc size       = size
font size       = size * 0.76
SVG stroke w    = clamp(size * 0.06, 1, 5)
disc border-r   = size / 2
word margin     = size * 0.07
gap between AI  = size * 0.64  (matches prototype's GAP=-54 at size=84 → center ~30px apart)
```

**Test at each size**: 84 (hero), 26 (sidebar expanded), 22 (login), 15 (collapsed). SVG strokes must remain visible at 15px (stroke-width ~1px, acceptable).

### 2f. CSS for the new component

Add to `apps/console/app/globals.css` (replace old `.intera-logo` rules):

```css
/* ── Animated logo lockup (intera-logo.tsx) ── */
.intera-logo-stage {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  user-select: none;
}

/* Disc (glass circle frame) */
.intera-disc {
  position: relative; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.intera-disc-shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%);
  background-size: 250% 100%;
}

/* Wordmark */
.intera-wordmark {
  display: inline-flex; align-items: baseline;
  font-family: var(--font-serif);
  font-style: italic; font-weight: 500;
  letter-spacing: -0.02em;
}
.intera-wordmark-letter {
  display: inline-block; white-space: pre;
  opacity: 0;
}
.intera-wordmark-letter.visible {
  opacity: 1;
  transition: opacity 0.35s ease;
}

/* Motion reduction */
@media (prefers-reduced-motion: reduce) {
  .intera-logo-stage *,
  .intera-logo-stage *::before,
  .intera-logo-stage *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**REMOVE** the old CSS rules:
```css
/* DELETE THESE */
.intera-logo { ... }
.il-anchor { ... }
.il-letter { ... }
.intera-logo.is-revealed .il-letter { ... }
.intera-logo.is-collapsed .il-letter { ... }
```

### 2g. prefers-reduced-motion

```ts
const prefersReduced = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// In the animation logic:
if (prefersReduced) {
  // Skip all el.animate() calls
  // Render the final static state immediately
  renderStaticIntera() // or renderStaticAI() depending on collapsed/initial state
  return
}
```

When reduced motion is preferred, the component renders:
- **Collapsed**: static I disc
- **Idle mode**: static "Intera" in serif font
- **Click mode**: static "Intera" (click does nothing, or simply swaps text)

---

## Phase 3 — Update usage sites

### 3a. Console sidebar (expanded)

**File**: `apps/console/components/console-sidebar.tsx`

```diff
- <InteraLogo size={26} />
+ <InteraLogo size={26} mode="click" onClick={() => { /* optional: trigger AI reveal */ }} />
```

Sidebar logo: idle by default, click to trigger AI reveal. The click handler is optional — the component handles the animation internally. If you want clicking the logo to also navigate somewhere, pass an `onClick` that fires after the animation.

### 3b. Console sidebar (collapsed)

```diff
- <InteraLogo size={15} collapsed />
+ <InteraLogo size={15} collapsed mode="none" />
```

No animation needed at 15px — just the I disc mark.

### 3c. Login page

**File**: `apps/console/app/login/page.tsx`

```diff
- <InteraLogo size={22} />
+ <InteraLogo size={22} mode="idle" theme="dark" />
```

The login page has a dark brand panel. Pass `theme="dark"` so the disc background and text invert correctly.

The login page currently renders InteraLogo inside `.brandTop` (a flex container with `color: rgba(255,255,255,0.94)`). The new component uses inline styles for colors, so the CSS color inheritance won't matter — but verify the dark theme looks correct.

### 3d. Nothing else to change

`apps/chat` doesn't use the logo. Admin layout doesn't use it. The root `page.tsx` redirect doesn't use it. No other files reference `InteraLogo`.

---

## Phase 4 — CSS cleanup

**File**: `apps/console/app/globals.css`

1. ADD the new CSS rules from Phase 2f
2. REMOVE the old `.intera-logo`, `.il-anchor`, `.il-letter`, `.is-revealed`, `.is-collapsed` rules
3. Verify nothing else references those class names: `rg -r "il-anchor\|il-letter\|is-revealed\|is-collapsed" apps/console`

**File**: `apps/chat/app/globals.css` — if the chat app has a copy of the old logo CSS, remove it. (Check: `rg "intera-logo" apps/chat/app/globals.css`)

---

## Phase 5 — Testing checklist

Per surface:

| Surface | Size | Mode | What to verify |
|---------|------|------|----------------|
| Sidebar expanded | 26 | click | I disc + "Intera" text renders. Click triggers AI reveal. |
| Sidebar collapsed | 15 | none | I disc renders cleanly at 15px. SVG strokes visible. |
| Login brand | 22 | idle, dark | I disc + "Intera" renders on dark bg. Text is white. |
| (Future) Hero | 84 | full | Complete Ink Flow choreography plays. AI merge works. |

Cross-cutting:

- [ ] Fonts loaded before animation starts (no FOUT during measure)
- [ ] `prefers-reduced-motion` skips animation, shows static text
- [ ] SSR doesn't throw — static "Intera" text renders server-side
- [ ] Component unmounts cleanly (no lingering timers/animations in devtools)
- [ ] No console errors during animation cycle
- [ ] Dark theme (`theme="dark"`): disc bg, border, text all invert
- [ ] Sidebar collapse/expand doesn't break the logo (size prop changes trigger rebuild)
- [ ] Login page looks correct with dark theme
- [ ] Old CSS classes are fully removed — no orphaned styles

---

## Phase 6 — Future: Hero / splash page

When a hero/splash page is built (marketing site, `/` landing page, about page), add the full `mode="full"` variant:

```tsx
<InteraLogo size={84} mode="full" theme="light" />
```

This uses the complete Ink Flow choreography including:
- Disc scale-in + shimmer
- SVG stroke drawing (I then A)
- Letter-by-letter text reveal
- "nter" dissolve
- Disc slide + merge into unified capsule
- Auto-replay via `replayInterval` prop (optional, like `replayInterval={10000}`)

The `mode="full"` implementation is mostly already in the prototype (`playInk()` function). The component just needs to expose it behind a mode flag.

---

## File Manifest

| File | Action | Phase |
|------|--------|-------|
| `packages/shared/ui/intera-svg.ts` | CREATE | 1 |
| `packages/shared/ui/intera-logo.tsx` | REWRITE | 2 |
| `apps/console/app/globals.css` | MODIFY (add new, remove old) | 2f + 4 |
| `apps/console/components/console-sidebar.tsx` | MODIFY (2 lines) | 3a, 3b |
| `apps/console/app/login/page.tsx` | MODIFY (1 line) | 3c |

**Total files touched: 5**

**No new dependencies.** No npm install needed.

---

## Estimate

| Phase | Effort |
|-------|--------|
| 1 - SVG helpers | 1h |
| 2 - Component rewrite | 2.5h |
| 3 - Usage site updates | 0.5h |
| 4 - CSS cleanup | 0.5h |
| 5 - Testing | 1h |
| **Total** | **5.5h** |
