# Dashboard Halix-Style Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the `/ops/dashboards` page with Halix-inspired visual elements — animated ring progress, wave trend chart, and dot-matrix number display — adapted to Intera's light-mode iOS Liquid Glass design system.

**Architecture:** Three new reusable UI components (`RingProgress`, `WaveChart`, `DotMatrixNumber`) added to `components/ui/`. The existing dashboard page is updated to use these components. All animations use CSS keyframes (no new dependencies). Light-mode color palette uses existing CSS variables.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, CSS keyframe animations, existing `glass-card` design system

---

## File Structure

- Create: `apps/console/components/ui/ring-progress.tsx` — circular SVG ring with animated fill
- Create: `apps/console/components/ui/wave-chart.tsx` — animated SVG wave/line chart
- Create: `apps/console/components/ui/dot-matrix-number.tsx` — LED-style dot-matrix number renderer
- Modify: `apps/console/app/ops/dashboards/page.tsx` — integrate new components
- Modify: `apps/console/app/globals.css` — add animation keyframes and dot-matrix styles

---

### Task 1: DotMatrixNumber Component

**Files:**
- Create: `apps/console/components/ui/dot-matrix-number.tsx`

- [ ] **Step 1: Create the DotMatrixNumber component**

```tsx
// LED dot-matrix number display — renders digits as a grid of small circles
// Used for large metric displays with a retro-digital aesthetic

'use client'

import { useMemo } from 'react'

// 5×7 grid definitions for digits 0-9, comma, dot, colon, percent
const GLYPHS: Record<string, number[]> = {
  '0': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,1,1, 1,0,1,0,1, 1,1,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '1': [0,0,1,0,0, 0,1,1,0,0, 1,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1],
  '2': [0,1,1,1,0, 1,0,0,0,1, 0,0,0,0,1, 0,0,1,1,0, 0,1,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  '3': [1,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 0,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,0],
  '4': [1,0,0,1,0, 1,0,0,1,0, 1,0,0,1,0, 1,1,1,1,1, 0,0,0,1,0, 0,0,0,1,0, 0,0,0,1,0],
  '5': [1,1,1,1,1, 1,0,0,0,0, 1,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '6': [0,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '7': [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  '8': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '9': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,1,1,1,0],
  ',': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,1,0,0,0, 0,0,0,0,0],
  '.': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0],
  '%': [1,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,1, 0,0,0,0,0, 0,0,0,0,0],
  ':': [0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0, 0,0,0,0,0, 0,1,1,0,0, 0,1,1,0,0, 0,0,0,0,0],
}

interface DotMatrixNumberProps {
  value: string
  dotSize?: number    // radius of each dot in px
  gap?: number        // spacing between dots in px
  color?: string      // dot color
  className?: string
}

export default function DotMatrixNumber({
  value,
  dotSize = 2,
  gap = 4.5,
  color = 'var(--mist)',
  className = '',
}: DotMatrixNumberProps) {
  const { svg, width, height } = useMemo(() => {
    const chars = value.split('')
    const cols = 5
    const rows = 7
    const totalW = chars.length * (cols * gap) - gap
    const totalH = rows * gap
    const circles: string[] = []

    chars.forEach((ch, ci) => {
      const grid = GLYPHS[ch]
      if (!grid) return
      const ox = ci * (cols * gap)
      grid.forEach((v, i) => {
        if (v) {
          const cx = ox + (i % cols) * gap + gap / 2
          const cy = Math.floor(i / cols) * gap + gap / 2
          circles.push(`<circle cx="${cx}" cy="${cy}" r="${dotSize}" fill="${color}"/>`)
        }
      })
    })

    return {
      svg: circles.join(''),
      width: totalW,
      height: totalH,
    }
  }, [value, dotSize, gap, color])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`block ${className}`}
      aria-label={value}
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
```

- [ ] **Step 2: Verify component renders**

Add a temporary test in the dashboard page or run dev server. The component should render "1,234" as a grid of dots.

- [ ] **Step 3: Commit**

```bash
git add apps/console/components/ui/dot-matrix-number.tsx
git commit -m "feat(ui): add DotMatrixNumber component for LED-style digit display"
```

---

### Task 2: RingProgress Component

**Files:**
- Create: `apps/console/components/ui/ring-progress.tsx`

- [ ] **Step 1: Create the RingProgress component**

```tsx
// Animated circular ring progress — SVG-based with CSS animation
// Shows a percentage as a filling arc with a center label

'use client'

import { useEffect, useRef, useState } from 'react'

interface RingProgressProps {
  value: number          // 0-100
  size?: number          // px diameter
  strokeWidth?: number
  color?: string         // stroke color
  trackColor?: string    // background ring color
  label?: string         // center text below value
  showValue?: boolean    // show number in center
  className?: string
}

export default function RingProgress({
  value,
  size = 180,
  strokeWidth = 8,
  color = 'var(--indigo)',
  trackColor = 'rgba(0,0,0,0.04)',
  label,
  showValue = true,
  className = '',
}: RingProgressProps) {
  const [animated, setAnimated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setAnimated(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (animated ? (value / 100) * circ : 0)

  return (
    <div ref={ref} className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        {/* Progress arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showValue && (
          <span className="text-[28px] font-bold tracking-[-0.02em] text-[var(--mist)]">
            {animated ? value : 0}%
          </span>
        )}
        {label && (
          <span className="text-[11px] text-[var(--fog)] mt-0.5">{label}</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify component renders**

Render a `<RingProgress value={75} label="Resolution Rate" />` — ring should animate from 0% to 75% when scrolled into view.

- [ ] **Step 3: Commit**

```bash
git add apps/console/components/ui/ring-progress.tsx
git commit -m "feat(ui): add RingProgress component with animated SVG ring"
```

---

### Task 3: WaveChart Component

**Files:**
- Create: `apps/console/components/ui/wave-chart.tsx`

- [ ] **Step 1: Create the WaveChart component**

```tsx
// Animated wave/line chart — SVG-based with CSS stroke-dashoffset animation
// Displays a smooth curve with gradient stroke and optional data points

'use client'

import { useEffect, useRef, useState, useMemo } from 'react'

interface WaveChartProps {
  data: number[]         // array of values to plot
  width?: number
  height?: number
  color?: string         // primary stroke color
  gradientFrom?: string  // gradient start
  gradientTo?: string    // gradient end
  className?: string
}

export default function WaveChart({
  data,
  width = 300,
  height = 100,
  color,
  gradientFrom = 'var(--malachite)',
  gradientTo = 'var(--sky)',
  className = '',
}: WaveChartProps) {
  const [animated, setAnimated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setAnimated(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const pathD = useMemo(() => {
    if (data.length < 2) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const padY = 8
    const padX = 4
    const usableW = width - padX * 2
    const usableH = height - padY * 2

    const points = data.map((v, i) => ({
      x: padX + (i / (data.length - 1)) * usableW,
      y: padY + usableH - ((v - min) / range) * usableH,
    }))

    // Smooth cubic bezier curve through points
    let d = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const curr = points[i]
      const cpx = (prev.x + curr.x) / 2
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
    }
    return d
  }, [data, width, height])

  const gradId = useMemo(() => `wave-grad-${Math.random().toString(36).slice(2, 8)}`, [])

  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gradientFrom} />
            <stop offset="100%" stopColor={gradientTo} />
          </linearGradient>
        </defs>
        {/* Glow layer */}
        <path
          d={pathD}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={0.2}
          style={{
            filter: 'blur(4px)',
            strokeDasharray: 1000,
            strokeDashoffset: animated ? 0 : 1000,
            transition: 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        {/* Main line */}
        <path
          d={pathD}
          fill="none"
          stroke={color || `url(#${gradId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{
            strokeDasharray: 1000,
            strokeDashoffset: animated ? 0 : 1000,
            transition: 'stroke-dashoffset 2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Verify component renders**

Render with sample data `[10, 25, 18, 40, 35, 55, 48, 72, 65, 80]` — a smooth wave line should draw itself when scrolled into view.

- [ ] **Step 3: Commit**

```bash
git add apps/console/components/ui/wave-chart.tsx
git commit -m "feat(ui): add WaveChart component with animated SVG line"
```

---

### Task 4: AnimatedCounter Utility

**Files:**
- Create: `apps/console/components/ui/animated-counter.tsx`

- [ ] **Step 1: Create the AnimatedCounter component**

```tsx
// Animated number counter — counts from 0 to target value with easing
// Used with DotMatrixNumber for visual impact

'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedCounterProps {
  target: number
  duration?: number      // ms
  decimals?: number
  className?: string
  children: (value: string) => React.ReactNode
}

export default function AnimatedCounter({
  target,
  duration = 1200,
  decimals = 0,
  className = '',
  children,
}: AnimatedCounterProps) {
  const [current, setCurrent] = useState(0)
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect() } },
      { threshold: 0.3 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(eased * target)
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [started, target, duration])

  const display = decimals > 0
    ? current.toFixed(decimals)
    : Math.round(current).toLocaleString()

  return (
    <div ref={ref} className={className}>
      {children(display)}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/ui/animated-counter.tsx
git commit -m "feat(ui): add AnimatedCounter component with IntersectionObserver trigger"
```

---

### Task 5: CSS Keyframes for Dashboard Widgets

**Files:**
- Modify: `apps/console/app/globals.css`

- [ ] **Step 1: Add animation keyframes at the end of globals.css**

Append to the end of `globals.css`:

```css
/* ────────────────────────────────────────────
   Dashboard Widget Animations (Halix-inspired)
   ──────────────────────────────────────────── */

/* Subtle breathing glow for ring progress */
@keyframes ring-glow {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(91, 138, 247, 0.15)); }
  50% { filter: drop-shadow(0 0 8px rgba(91, 138, 247, 0.25)); }
}

.ring-animate {
  animation: ring-glow 3s ease-in-out infinite;
}

/* Subtle pulse for metric card icons */
@keyframes icon-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.85; }
}

.icon-pulse {
  animation: icon-pulse 2.5s ease-in-out infinite;
}

/* Dot-matrix number entrance */
@keyframes dot-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.dot-enter {
  animation: dot-fade-in 0.6s ease-out both;
}

/* Wave chart shimmer overlay */
@keyframes wave-shimmer {
  0% { opacity: 0.15; }
  50% { opacity: 0.3; }
  100% { opacity: 0.15; }
}

.wave-shimmer {
  animation: wave-shimmer 3s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/app/globals.css
git commit -m "feat(ui): add CSS keyframe animations for dashboard widgets"
```

---

### Task 6: Integrate into Dashboard Page

**Files:**
- Modify: `apps/console/app/ops/dashboards/page.tsx`

- [ ] **Step 1: Update imports and add new widget section**

Replace the full file with:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { BarChart3, MessageSquare, Briefcase, Clock, Shield, Activity, ArrowRight, ArrowUp, ArrowDown, Zap, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import RingProgress from '@/components/ui/ring-progress'
import WaveChart from '@/components/ui/wave-chart'
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
  messages24h: { en: 'Messages 24h', zh: '24h 消息' },
  activeCases: { en: 'Active Cases', zh: '活跃案例' },
  avgResolution: { en: 'Avg Resolution', zh: '平均解决' },
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
  systemHealth: { en: 'System Health', zh: '系统健康' },
  resolutionRate: { en: 'Resolution Rate', zh: '解决率' },
  compliance: { en: 'Compliance', zh: '合规率' },
  messageTrend: { en: 'Message Trend (24h)', zh: '消息趋势 (24h)' },
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

// Sample trend data — in production this would come from the API
const sampleTrend = [12, 28, 15, 42, 35, 58, 45, 72, 68, 85, 78, 92, 88, 95, 90, 82, 75, 68, 55, 48, 42, 38, 30, 22]

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
  const resolvedCases = recentCases.filter((c) => c.status === 'resolved').length
  const resolutionRate = recentCases.length > 0 ? Math.round((resolvedCases / recentCases.length) * 100) : 0

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{l('title')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      {/* ── Halix-style ring progress row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Resolution Rate Ring */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 flex flex-col items-center transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <RingProgress
            value={resolutionRate}
            size={160}
            strokeWidth={8}
            color="var(--malachite)"
            label={l('resolutionRate')}
          />
        </div>

        {/* Compliance Ring */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 flex flex-col items-center transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <RingProgress
            value={totalGuardrail > 0 ? Math.max(0, 100 - Math.min(totalGuardrail, 100)) : 100}
            size={160}
            strokeWidth={8}
            color="var(--lavender)"
            label={l('compliance')}
          />
        </div>

        {/* Message Trend Wave */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--sky)]/10">
              <TrendingUp className="w-4 h-4 text-[var(--sky)]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('messageTrend')}</span>
          </div>
          <WaveChart
            data={sampleTrend}
            height={90}
            gradientFrom="var(--malachite)"
            gradientTo="var(--sky)"
          />
        </div>
      </div>

      {/* ── Enhanced 4-metric grid with dot-matrix ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: l('messages24h'), value: overview.messages24h, icon: MessageSquare, color: '#6366f1', format: 'number' as const },
          { label: l('activeCases'), value: overview.activeCases, icon: Briefcase, color: '#f59e0b', format: 'number' as const },
          { label: l('avgResolution'), value: overview.avgResolutionMin, icon: Clock, color: '#14b8a6', format: 'min' as const },
          { label: l('guardrailHits'), value: totalGuardrail, icon: Shield, color: '#8b6ff5', format: 'number' as const },
        ]).map(({ label, value, icon: Icon, color, format }) => (
          <div
            key={label}
            className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center icon-pulse" style={{ background: `${color}10` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{label}</span>
            </div>
            <AnimatedCounter
              target={value ?? 0}
              duration={1400}
              decimals={format === 'min' && value != null ? 0 : 0}
            >
              {(v) => (
                <div className="dot-enter">
                  <DotMatrixNumber
                    value={format === 'min' ? (value != null ? `${v}` : '—') : v}
                    dotSize={1.8}
                    gap={4}
                    color="var(--mist)"
                  />
                </div>
              )}
            </AnimatedCounter>
            {format === 'min' && (
              <span className="text-[11px] text-[var(--fog)] mt-1 block">{l('min')}</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Two-column row (unchanged) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Cases */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
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
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-black/[0.03] last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'resolved' ? 'bg-emerald-400' : c.status === 'escalated' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="text-[12px] text-[var(--mist)] flex-1 min-w-0 truncate">{c.type.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-[var(--fog)]/50 flex-shrink-0">{timeAgo(c.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channel Health + Guardrail Hits */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
            <h2 className="text-[13px] font-bold text-[var(--mist)] mb-4">{l('channelHealth')}</h2>
            {channelHealth.length === 0 ? (
              <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noData')}</p>
            ) : (
              <div className="space-y-2">
                {channelHealth.map((ch) => (
                  <div key={ch.channel} className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[ch.status] || 'bg-black/10'}`} />
                    <span className="text-[12px] text-[var(--mist)] flex-1 capitalize">{ch.channel}</span>
                    <span className="text-[11px] text-[var(--fog)]">{l(ch.status as keyof typeof L)}</span>
                    <span className="text-[10px] text-[var(--fog)]/40">{timeAgo(ch.lastChecked)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
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

- [ ] **Step 2: Open dashboard in browser and verify**

Expected:
- Top row: 2 ring progress widgets (resolution rate in green, compliance in lavender) + 1 wave chart (message trend)
- Second row: 4 enhanced metric cards with dot-matrix animated numbers
- Bottom row: unchanged Recent Cases + Channel Health + Guardrail lists
- All animations trigger on scroll via IntersectionObserver
- Numbers count up from 0 to target value
- Rings animate from 0% to target percentage
- Wave chart draws itself with gradient stroke

- [ ] **Step 3: Fix any visual issues**

Check: dot-matrix readability, ring colors, wave chart proportions, spacing.

- [ ] **Step 4: Commit**

```bash
git add apps/console/app/ops/dashboards/page.tsx
git commit -m "feat(dashboard): enhance with Halix-style ring progress, wave chart, dot-matrix numbers"
```

---

### Task 7: Verify and Polish

- [ ] **Step 1: Run the dev server and verify all widgets**

```bash
cd apps/console && npm run dev
```

Open `http://localhost:3000/ops/dashboards` — verify:
- Ring progress animates on scroll
- Wave chart draws on scroll
- Dot-matrix numbers count up
- Icon pulse animation works
- All glassmorphism cards render correctly
- No console errors

- [ ] **Step 2: Check responsive layout**

Resize browser to mobile width — verify grid collapses correctly (1 col on mobile, 2 on tablet, 4 on desktop).

- [ **Step 3: Final commit**

```bash
git add -A
git commit -m "fix(dashboard): polish Halix-style widget spacing and responsive layout"
```
