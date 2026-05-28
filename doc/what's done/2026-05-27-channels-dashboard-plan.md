# Channels 重组 + Dashboard 计划

> 2026-05-27。三个改动：Human Tasks → Web Chat channel / Telegram+LiveDesk 占位卡 / Dashboard。

---

## 1. Telegram + LiveDesk 占位卡（10 min）

### 改动文件

**`apps/console/app/admin/channels/page.tsx`**

CHANNELS 数组改为：

```tsx
const CHANNELS: ChannelInfo[] = [
  {
    id: 'livechat', label: 'LiveChat',
    description: 'Connection · Routing · Rendering · Human Ops',
    icon: MessageCircle, href: '/admin/channels/livechat',
    active: true, comingSoon: false,
  },
  {
    id: 'web-chat', label: 'Web Chat',
    description: 'Embedded widget + Human Tasks queue',
    icon: Globe, href: '/admin/channels/web-chat',
    active: true, comingSoon: false,  // 有了 Human Tasks tab 后不再是 coming soon
  },
  {
    id: 'telegram', label: 'Telegram',
    description: 'Connect Intera to Telegram chats',
    icon: Send, href: '/admin/channels/telegram',
    active: false, comingSoon: true,
  },
  {
    id: 'livedesk', label: 'LiveDesk',
    description: 'Customer service platform integration',
    icon: Headset, href: '/admin/channels/livedesk',
    active: false, comingSoon: true,
  },
]
```

**新增 import**：`Send, Headset, Globe` from lucide-react。

---

## 2. Human Tasks → Web Chat Channel（1.5 天）

### 现状

- `/ops/human-tasks` 页面：显示 pending/in_progress 任务列表
- `create_human_task` 只在 web-chat 路径被触发（[loop.ts](apps/chat/lib/agent/loop.ts) ConversationLoop）
- LiveChat 走 `transfer_chat`，不创建 HumanTask 记录
- 侧栏 `ADMIN_ITEMS` 中没有 Human Tasks，它在 `OPS_ITEMS` 里

### 目标

```
Ops 侧栏：
├ Chats
├ Dashboard（新增 — 见 §3）
└ Guide

Channels → Web Chat 详情页：
├ Connection    — web chat credentials / embed config
├ Routing       — 哪些 case type 在 web chat 启用
├ Rendering     — web chat UI 偏好
├ Human Ops     — 升级策略（consultationPrompt / humanSkills）
└ Human Tasks   — 🆕 任务队列（从 /ops/human-tasks 搬过来）
```

### 改动文件

#### 2.1 隐藏 Ops 侧栏 Human Tasks 入口

**`apps/console/components/console-sidebar.tsx`**

```tsx
// 注释掉 OPS_ITEMS 中的 humanTasks
// { href: '/ops/human-tasks', slug: 'humanTasks', icon: ClipboardList, color: '#f0b050' },
```

#### 2.2 新建 Web Chat 详情页

**`apps/console/app/admin/channels/web-chat/page.tsx`**（新文件，~250 行）

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Globe, MessageSquare, GitBranch, Monitor, UserCheck, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'

// ── Labels (EN/ZH) ──
const L = {
  back: { en: '← Channels', zh: '← 渠道' },
  subtitle: { en: 'Web Chat — Embedded widget · Human escalation', zh: 'Web Chat — 嵌入式组件 · 人工升级' },
  connection: { en: 'Connection', zh: '连接' },
  routing: { en: 'Routing', zh: '路由' },
  rendering: { en: 'Rendering', zh: '渲染' },
  humanOps: { en: 'Human Ops', zh: '人工配置' },
  humanTasks: { en: 'Human Tasks', zh: '人工任务' },
  consultationPrompt: { en: 'Consultation prompt', zh: '咨询提示词' },
  allowedSkills: { en: 'Skills during consultation', zh: '咨询期间可用工具' },
  // ... etc
} as const

const TABS = [
  { id: 'connection', label: 'Connection', labelZh: '连接', icon: Globe },
  { id: 'routing', label: 'Routing', labelZh: '路由', icon: GitBranch },
  { id: 'rendering', label: 'Rendering', labelZh: '渲染', icon: Monitor },
  { id: 'humanOps', label: 'Human Ops', labelZh: '人工配置', icon: UserCheck },
  { id: 'humanTasks', label: 'Human Tasks', labelZh: '人工任务', icon: ClipboardList },
] as const

export default function WebChatDetailPage() {
  // state + effects same pattern as livechat/page.tsx
  // ...

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      {/* Tabs */}
      {/* Connection tab: embed script, widget config */}
      {/* Routing tab: case type enablement for web chat */}
      {/* Rendering tab: chat UI preferences */}
      {/* Human Ops tab: consultationPrompt, humanSkills */}
      {/* Human Tasks tab: embedded task queue (see §2.3) */}
    </div>
  )
}
```

#### 2.3 Human Tasks tab —— 内嵌任务队列

**方案 A（轻量）**：Human Tasks tab 内 `<iframe>` 加载 `/ops/human-tasks?embed=1`

```tsx
{activeTab === 'humanTasks' && (
  <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
    <iframe src="/ops/human-tasks?embed=1" className="w-full border-0" style={{ height: 600 }} />
  </div>
)}
```

**方案 B（完整）**：直接在 tab 内复用 Human Tasks 页面的逻辑。
- 抽 `useHumanTasks()` hook → 共享数据加载逻辑
- tab 内渲染任务列表 + operator 处理入口

**建议先用方案 A**（30min），后续按需升级到方案 B。

#### 2.4 `/ops/human-tasks` 页面加 `?embed=1` 支持

**`apps/console/app/ops/human-tasks/page.tsx`**

```tsx
// 检测 embed 模式：隐藏 sidebar layout，纯内容渲染
const isEmbed = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('embed')

if (isEmbed) {
  return <HumanTaskList />  // 只渲染任务列表，无外层 layout
}
```

---

## 3. Dashboard（1 周）

### 目标

给运营一个全局视图，能回答：
- 系统今天处理了多少消息？
- 有多少活跃 case？
- 哪些 guardrail 被触发了多少次？
- 各 channel 健康吗？
- 最近 case 列表是什么？

### 数据来源（全部已有表，零 migration）

| 卡片 | SQL 思路 | 表 |
|------|----------|-----|
| 24h 消息量 | `COUNT(*) FROM messages WHERE createdAt > now() - 1d` | `Message` |
| 活跃 case | `COUNT(*) FROM cases WHERE status != 'resolved'` | `Case` |
| 平均解决时间 | `AVG(resolvedAt - createdAt) FROM cases WHERE resolvedAt IS NOT NULL` | `Case` |
| 今日 Token | `SUM(payload->>'tokens') FROM action_traces WHERE createdAt > today` | `ActionTrace` |
| Guardrail 命中 | `COUNT(*) FROM action_traces WHERE actionType = 'policy_hit' GROUP BY name` | `ActionTrace` |
| Channel 健康度 | `SELECT * FROM channel_health` | `ChannelHealth` |
| 最近 case | `SELECT * FROM cases ORDER BY createdAt DESC LIMIT 10` | `Case` |

### 改动文件

#### 3.1 API —— Dashboard 数据聚合

**`apps/console/app/api/ops/dashboard/route.ts`**（新文件）

```ts
// GET /api/ops/dashboard
// Returns:
{
  overview: {
    messages24h: number,
    activeCases: number,
    avgResolutionMin: number | null,
    tokensToday: number,
  },
  guardrailHits: Array<{ name: string, hits: number }>,
  channelHealth: Array<{ channel: string, status: string, lastChecked: string }>,
  recentCases: Array<{ id: string, type: string, status: string, createdAt: string }>,
}
```

**实现**：6 个 Prisma 查询，并行执行（`Promise.all`）。

```ts
export async function GET() {
  const CUSTOMER_ID = await getActiveCustomerId()
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [msgCount, activeCases, avgResTime, guardrailHits, channelHealth, recentCases] = await Promise.all([
    prisma.message.count({ where: { case: { customerId: CUSTOMER_ID }, createdAt: { gte: yesterday } } }),
    prisma.case.count({ where: { customerId: CUSTOMER_ID, status: { not: 'resolved' } } }),
    prisma.case.aggregate({ where: { customerId: CUSTOMER_ID, resolvedAt: { not: null } }, _avg: { /* raw SQL for interval */ } }),
    // guardrail hits: raw query on action_traces
    prisma.$queryRaw`SELECT title, COUNT(*) as hits FROM action_traces WHERE "customerId" = ${CUSTOMER_ID} AND "actionType" = 'policy_hit' AND "createdAt" >= ${yesterday} GROUP BY title ORDER BY hits DESC LIMIT 10`,
    prisma.channelHealth.findMany({ where: { customerId: CUSTOMER_ID } }),
    prisma.case.findMany({ where: { customerId: CUSTOMER_ID }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, type: true, status: true, createdAt: true } }),
  ])

  return NextResponse.json({ overview: { messages24h: msgCount, activeCases, avgResolutionMin: null, tokensToday: 0 }, guardrailHits, channelHealth, recentCases })
}
```

#### 3.2 Dashboard 页面

**`apps/console/app/ops/dashboards/page.tsx`**（新文件，~200 行）

```
/ops/dashboards
├ 概览卡行（4 卡，grid-cols-4）
│   ├ Messages（24h）
│   ├ Active Cases
│   ├ Avg Resolution
│   └ Tokens Today
│
├ 两栏布局
│   ├ 左：Guardrail Hits（bar list）
│   └ 右：Channel Health（status cards）
│
└ 最近 Cases 表（name · type · status · time）
```

**概览卡组件**：
```tsx
function StatCard({ icon, label, value, hint, color }: { icon: ReactNode, label: string, value: string, hint?: string, color: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>{icon}</div>
        <span className="text-[11px] font-semibold text-[var(--fog)]">{label}</span>
      </div>
      <p className="text-[28px] font-bold text-[var(--mist)] tracking-[-0.02em]">{value}</p>
      {hint && <p className="text-[11px] text-[var(--fog)] mt-1">{hint}</p>}
    </div>
  )
}
```

#### 3.3 侧栏加 Dashboard 入口

**`apps/console/components/console-sidebar.tsx`**

```tsx
const OPS_ITEMS: NavItem[] = [
  { href: '/ops/chats', slug: 'chats', icon: MessageSquare, color: '#6366f1', matchPattern: '/ops/chats' },
  { href: '/ops/dashboards', slug: 'dashboards', icon: BarChart3, color: '#14b8a6', matchPattern: '/ops/dashboards' },
  { href: '/ops/guide', slug: 'guide', icon: BookOpen, color: '#8b6ff5', matchPattern: '/ops/guide' },
]
```

#### 3.4 i18n

**`apps/console/lib/i18n/dictionaries.ts`**

```ts
// EN
'sidebar.dashboards': 'Dashboards',
'dashboard.title': 'Dashboard',
'dashboard.messages24h': 'Messages (24h)',
'dashboard.activeCases': 'Active Cases',
'dashboard.avgResolution': 'Avg Resolution',
'dashboard.tokensToday': 'Tokens (Today)',
'dashboard.guardrailHits': 'Guardrail Hits',
'dashboard.channelHealth': 'Channel Health',
'dashboard.recentCases': 'Recent Cases',
'dashboard.noData': 'No data yet',

// ZH
'sidebar.dashboards': '仪表盘',
'dashboard.title': '运营仪表盘',
'dashboard.messages24h': '24h 消息量',
'dashboard.activeCases': '活跃案例',
'dashboard.avgResolution': '平均解决时间',
'dashboard.tokensToday': '今日 Token',
'dashboard.guardrailHits': '护栏命中',
'dashboard.channelHealth': '渠道健康度',
'dashboard.recentCases': '最近案例',
'dashboard.noData': '暂无数据',
```

---

## 执行顺序

| 顺序 | 项 | 文件 | 工作量 |
|------|-----|------|--------|
| **1** | Telegram + LiveDesk 卡 | `channels/page.tsx` | 10 min |
| **2** | Human Tasks → Web Chat | `console-sidebar.tsx`, `channels/web-chat/page.tsx`（新）, `ops/human-tasks/page.tsx` | 1.5 天 |
| **3** | Dashboard API | `api/ops/dashboard/route.ts`（新） | 0.5 天 |
| **4** | Dashboard 页面 | `ops/dashboards/page.tsx`（新）, `console-sidebar.tsx` | 1 天 |
| **5** | i18n 补齐 | `dictionaries.ts` | 0.5 天 |
| **6** | 测试 + 部署 | vitest + Railway | 0.5 天 |

**总计：~3.5 天**

---

## 最终侧栏结构

```
Ops                          Configure
├ Chats                      ├ Agent
├ Dashboards （🆕）          ├ Tools
└ Guide                      ├ Guardrails
                             ├ Case Types
                             ├ Channels
                             │   ├ LiveChat（4 tab）
                             │   └ Web Chat（5 tab，含 Human Tasks 🆕）
                             └ Knowledge
```

## 最终 Channels 列表卡

| 卡 | 状态 |
|----|------|
| LiveChat | ✅ Active — 点击进入 4-tab 详情 |
| Web Chat | ✅ Active — 点击进入 5-tab 详情（含 Human Tasks） |
| Telegram | 🚧 Coming soon — 灰色不可点 |
| LiveDesk | 🚧 Coming soon — 灰色不可点 |
