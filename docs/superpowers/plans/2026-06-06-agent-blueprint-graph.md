# Agent Blueprint Hub & Spoke Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-card stats grid on `/admin/agent` with an interactive hub-and-spoke network diagram showing 5 agent modules around a central CORE node, with click-to-explore detail panels.

**Architecture:** React Flow canvas with custom node types (CoreNode, ModuleNode). Each module node has a tinted glassmorphism background matching its theme color. Clicking a node opens a slide-in detail panel. Data fetched from existing API endpoints.

**Tech Stack:** React 19, Next.js 15, @xyflow/react (React Flow v12), lucide-react, Tailwind CSS

---

### Task 1: Install @xyflow/react

**Files:**
- Modify: `apps/console/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd /Users/curtis/Desktop/intera-agent && pnpm add -F @intera/console @xyflow/react
```

- [ ] **Step 2: Verify installation**

```bash
grep xyflow /Users/curtis/Desktop/intera-agent/apps/console/package.json
```

Expected: `"@xyflow/react": "^..."` in dependencies

- [ ] **Step 3: Commit**

```bash
git add apps/console/package.json apps/console/pnpm-lock.yaml
git commit -m "chore: add @xyflow/react dependency for agent blueprint graph"
```

---

### Task 2: Create CoreNode component

**Files:**
- Create: `apps/console/components/admin/nodes/core-node.tsx`

- [ ] **Step 1: Create the CoreNode**

```tsx
// apps/console/components/admin/nodes/core-node.tsx
'use client'

import { Zap } from 'lucide-react'

export default function CoreNode() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1.5px dashed rgba(99,102,241,0.25)',
          boxShadow: '0 2px 12px rgba(99,102,241,0.06)',
        }}
      >
        <Zap size={20} className="text-indigo-400/60" strokeWidth={1.8} />
      </div>
      <span
        className="text-[9px] font-semibold uppercase tracking-[1.2px]"
        style={{ color: '#a5a8b4' }}
      >
        Core
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/admin/nodes/core-node.tsx
git commit -m "feat: add CoreNode component for agent blueprint graph"
```

---

### Task 3: Create ModuleNode component

**Files:**
- Create: `apps/console/components/admin/nodes/module-node.tsx`

- [ ] **Step 1: Create the ModuleNode with all 5 theme variants**

```tsx
// apps/console/components/admin/nodes/module-node.tsx
'use client'

import {
  BrainCircuit,
  Database,
  Wrench,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type ModuleId = 'brain' | 'memory' | 'tools' | 'guardrails' | 'caseAgents'

interface ModuleTheme {
  icon: LucideIcon
  label: string
  color: string
  bgFrom: string
  bgTo: string
  border: string
}

const THEMES: Record<ModuleId, ModuleTheme> = {
  brain: {
    icon: BrainCircuit,
    label: 'Brain',
    color: '#dc2626',
    bgFrom: 'rgba(254,226,226,0.8)',
    bgTo: 'rgba(252,165,165,0.45)',
    border: 'rgba(239,68,68,0.2)',
  },
  memory: {
    icon: Database,
    label: 'Memory',
    color: '#d97706',
    bgFrom: 'rgba(254,243,199,0.8)',
    bgTo: 'rgba(252,211,77,0.4)',
    border: 'rgba(245,158,11,0.2)',
  },
  tools: {
    icon: Wrench,
    label: 'Tools',
    color: '#2563eb',
    bgFrom: 'rgba(219,234,254,0.8)',
    bgTo: 'rgba(147,197,253,0.45)',
    border: 'rgba(59,130,246,0.2)',
  },
  guardrails: {
    icon: Shield,
    label: 'Guardrails',
    color: '#16a34a',
    bgFrom: 'rgba(220,252,231,0.8)',
    bgTo: 'rgba(134,239,172,0.4)',
    border: 'rgba(34,197,94,0.2)',
  },
  caseAgents: {
    icon: Users,
    label: 'Case Agents',
    color: '#db2777',
    bgFrom: 'rgba(251,207,232,0.8)',
    bgTo: 'rgba(244,114,182,0.4)',
    border: 'rgba(236,72,153,0.2)',
  },
}

interface ModuleNodeProps {
  data: {
    moduleId: ModuleId
    subtitle?: string
    dimmed?: boolean
    onClick?: (moduleId: ModuleId) => void
  }
}

export default function ModuleNode({ data }: ModuleNodeProps) {
  const { moduleId, subtitle, dimmed, onClick } = data
  const theme = THEMES[moduleId]
  const Icon = theme.icon

  return (
    <div
      className="flex flex-col items-center gap-2 cursor-pointer select-none"
      style={{ opacity: dimmed ? 0.4 : 1, transition: 'opacity 0.3s' }}
      onClick={() => onClick?.(moduleId)}
    >
      <div
        className="relative flex items-center justify-center rounded-[20px] overflow-hidden"
        style={{
          width: 72,
          height: 72,
          background: `linear-gradient(145deg, ${theme.bgFrom}, ${theme.bgTo})`,
          border: `1px solid ${theme.border}`,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.06)'
          e.currentTarget.style.boxShadow = `0 8px 32px ${theme.color}18`
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* Inner white gradient overlay for frosted glass */}
        <div
          className="absolute inset-0 rounded-[20px] pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 60%)',
          }}
        />
        <Icon size={24} strokeWidth={1.8} style={{ color: theme.color, position: 'relative', zIndex: 1 }} />
      </div>
      <span className="text-xs font-semibold" style={{ color: theme.color }}>
        {theme.label}
      </span>
      {subtitle && (
        <span className="text-[10px]" style={{ color: '#9ca3af' }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}

export { THEMES }
export type { ModuleTheme }
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/admin/nodes/module-node.tsx
git commit -m "feat: add ModuleNode component with 5 tinted glassmorphism themes"
```

---

### Task 4: Create AgentDetailPanel component

**Files:**
- Create: `apps/console/components/admin/agent-detail-panel.tsx`

- [ ] **Step 1: Create the detail panel**

```tsx
// apps/console/components/admin/agent-detail-panel.tsx
'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { type ModuleId, THEMES } from './nodes/module-node'

interface DetailRow {
  label: string
  value: string
}

interface AgentDetailPanelProps {
  moduleId: ModuleId
  subtitle?: string
  rows: DetailRow[]
  categories?: { label: string; count: number; color: string }[]
  tools?: string[]
  settingsPath: string
  onClose: () => void
}

export default function AgentDetailPanel({
  moduleId,
  subtitle,
  rows,
  categories,
  tools,
  settingsPath,
  onClose,
}: AgentDetailPanelProps) {
  const theme = THEMES[moduleId]
  const Icon = theme.icon

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col"
      style={{
        width: 280,
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(0,0,0,0.06)',
        borderRadius: '0 20px 20px 0',
        padding: 24,
        zIndex: 10,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.04)',
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Back button */}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1 text-xs transition-colors hover:text-gray-600 mb-4"
        style={{ color: '#9ca3af' }}
      >
        <ArrowLeft size={14} />
        Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 40,
            height: 40,
            background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgTo})`,
          }}
        >
          <Icon size={20} strokeWidth={1.8} style={{ color: theme.color }} />
        </div>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: '#1f2937' }}>
            {theme.label}
          </div>
          {subtitle && (
            <div className="text-[11px]" style={{ color: '#9ca3af' }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Category badges */}
      {categories && categories.length > 0 && (
        <div className="flex gap-1.5 mb-3.5">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="flex-1 text-center py-2 px-1 rounded-[10px]"
              style={{
                border: '1px solid rgba(0,0,0,0.06)',
                background: 'rgba(255,255,255,0.6)',
              }}
            >
              <div className="text-lg font-bold leading-tight" style={{ color: cat.color }}>
                {cat.count}
              </div>
              <div className="text-[8px] uppercase tracking-wider" style={{ color: '#9ca3af' }}>
                {cat.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rows */}
      <div className="flex-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-center py-2 text-xs"
            style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
          >
            <span style={{ color: '#6b7280' }}>{row.label}</span>
            <span className="font-semibold" style={{ color: '#1f2937' }}>{row.value}</span>
          </div>
        ))}

        {/* Tool list */}
        {tools && tools.length > 0 && (
          <div className="mt-2">
            {tools.map((tool) => (
              <div key={tool} className="flex items-center gap-1.5 py-1.5 text-xs" style={{ color: '#374151' }}>
                <span
                  className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                  style={{ background: '#22c55e' }}
                />
                {tool}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open Settings button */}
      <a
        href={settingsPath}
        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-all mt-auto"
        style={{
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(8px)',
          color: '#374151',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(99,102,241,0.06)'
          e.currentTarget.style.borderColor = 'rgba(99,102,241,0.2)'
          e.currentTarget.style.color = '#6366f1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.8)'
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'
          e.currentTarget.style.color = '#374151'
        }}
      >
        Open Settings
        <ArrowRight size={14} />
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/admin/agent-detail-panel.tsx
git commit -m "feat: add AgentDetailPanel slide-in component"
```

---

### Task 5: Create AgentBlueprintGraph main component

**Files:**
- Create: `apps/console/components/admin/agent-blueprint-graph.tsx`

- [ ] **Step 1: Create the main graph component**

```tsx
// apps/console/components/admin/agent-blueprint-graph.tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import CoreNode from './nodes/core-node'
import ModuleNode, { type ModuleId } from './nodes/module-node'
import AgentDetailPanel from './agent-detail-panel'
import { apiClient } from '@/lib/api/client'

interface Props {
  agentId: string | null
}

interface AgentData {
  model?: string
  temperature?: number
  thinkingBudget?: string
  fallbackModel?: string
  tools?: { name: string; toolCategory?: string; enabled: boolean }[]
  policies?: { name: string; enabled: boolean }[]
  caseTypes?: { name: string }[]
}

const NODE_TYPES = { coreNode: CoreNode, moduleNode: ModuleNode }

// Pentagon positions around center (x, y) — canvas is ~900x500
const POSITIONS: Record<ModuleId, [number, number]> = {
  brain: [450, 60],
  tools: [130, 170],
  memory: [770, 170],
  caseAgents: [210, 390],
  guardrails: [690, 390],
}

const MODULE_SETTINGS: Record<ModuleId, string> = {
  brain: '/admin/model',
  memory: '/admin/memory',
  tools: '/admin/tools',
  guardrails: '/admin/guardrails',
  caseAgents: '/admin/case-types',
}

export default function AgentBlueprintGraph({ agentId }: Props) {
  const [selectedModule, setSelectedModule] = useState<ModuleId | null>(null)
  const [agentData, setAgentData] = useState<AgentData | null>(null)

  useEffect(() => {
    if (!agentId) { setAgentData(null); return }
    Promise.all([
      apiClient<{ tools?: unknown[] }>(`/api/admin/tools?agentConfigId=${agentId}`),
      apiClient<{ policies?: unknown[] }>(`/api/admin/policies?agentConfigId=${agentId}`),
      apiClient<{ types?: unknown[] }>(`/api/admin/case-types?agentConfigId=${agentId}`),
    ]).then(([toolsRes, policiesRes, caseTypesRes]) => {
      setAgentData({
        tools: (toolsRes.data.tools || []) as AgentData['tools'],
        policies: (policiesRes.data.policies || []) as AgentData['policies'],
        caseTypes: (caseTypesRes.data.types || []) as AgentData['caseTypes'],
      })
    }).catch(() => setAgentData(null))
  }, [agentId])

  const toolsCount = agentData?.tools?.length ?? 0
  const policiesCount = agentData?.policies?.length ?? 0
  const caseTypesCount = agentData?.caseTypes?.length ?? 0

  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'core',
      type: 'coreNode',
      position: { x: 410, y: 210 },
      data: {},
      draggable: false,
      selectable: false,
    },
    ...(
      [
        ['brain', 'Brain', 'deepseek-v4-flash'],
        ['tools', 'Tools', `${toolsCount} tools`],
        ['memory', 'Memory', 'Balanced tier'],
        ['caseAgents', 'Case Agents', `${caseTypesCount} types`],
        ['guardrails', 'Guardrails', `${policiesCount} rules`],
      ] as const
    ).map(([id, _label, subtitle]) => ({
      id,
      type: 'moduleNode' as const,
      position: { x: POSITIONS[id][0] - 36, y: POSITIONS[id][1] - 36 },
      data: {
        moduleId: id,
        subtitle,
        dimmed: selectedModule !== null && selectedModule !== id,
        onClick: (mid: ModuleId) => setSelectedModule(mid === selectedModule ? null : mid),
      },
      draggable: false,
      selectable: false,
    })),
  ], [toolsCount, policiesCount, caseTypesCount, selectedModule])

  const initialEdges: Edge[] = useMemo(() => (
    Object.keys(POSITIONS) as ModuleId[]
  ).map((id) => ({
    id: `core-${id}`,
    source: 'core',
    target: id,
    style: {
      stroke: '#d4d7e0',
      strokeWidth: 1.2,
      opacity: selectedModule ? 0.25 : 0.5,
      transition: 'opacity 0.3s',
    },
  })), [selectedModule])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  // Sync nodes/edges when data or selection changes
  useEffect(() => {
    onNodesChange(
      initialNodes.map((n) => ({ type: 'reset' as const, item: n })).flat() as any
    )
  }, [initialNodes])

  useEffect(() => {
    onEdgesChange(
      initialEdges.map((e) => ({ type: 'reset' as const, item: e })).flat() as any
    )
  }, [initialEdges])

  const getDetailProps = useCallback((moduleId: ModuleId) => {
    switch (moduleId) {
      case 'brain':
        return {
          subtitle: agentData?.model || 'deepseek-v4-flash',
          rows: [
            { label: 'Model', value: agentData?.model || 'deepseek-v4-flash' },
            { label: 'Temperature', value: String(agentData?.temperature ?? 0.5) },
            { label: 'Thinking Budget', value: agentData?.thinkingBudget || '4k' },
            { label: 'Fallback', value: agentData?.fallbackModel || 'gpt-4o-mini' },
          ],
        }
      case 'tools':
        return {
          subtitle: `${toolsCount} tools`,
          categories: [
            { label: 'System', count: agentData?.tools?.filter((t) => t.toolCategory === 'system').length ?? 0, color: '#6366f1' },
            { label: 'Channel', count: agentData?.tools?.filter((t) => t.toolCategory === 'channel').length ?? 0, color: '#3b82f6' },
            { label: 'Business', count: agentData?.tools?.filter((t) => !t.toolCategory || t.toolCategory === 'business').length ?? 0, color: '#f59e0b' },
          ],
          tools: agentData?.tools?.filter((t) => t.enabled).slice(0, 5).map((t) => t.name) ?? [],
        }
      case 'guardrails':
        return {
          subtitle: `${policiesCount} active rules`,
          rows: [
            { label: 'Active', value: String(policiesCount) },
            { label: 'Total', value: String(agentData?.policies?.length ?? 0) },
          ],
          tools: agentData?.policies?.filter((p) => p.enabled).map((p) => p.name) ?? [],
        }
      case 'caseAgents':
        return {
          subtitle: `${caseTypesCount} types`,
          rows: [
            { label: 'Total', value: String(caseTypesCount) },
          ],
          tools: agentData?.caseTypes?.map((t) => t.name) ?? [],
        }
      case 'memory':
        return {
          subtitle: 'Balanced tier',
          rows: [
            { label: 'Tier', value: 'Balanced' },
          ],
        }
    }
  }, [agentData, toolsCount, policiesCount, caseTypesCount])

  if (!agentId) return null

  const detailProps = selectedModule ? getDetailProps(selectedModule) : null

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden" style={{
      background: 'linear-gradient(135deg, #f8f9fc 0%, #f0f2f7 50%, #eef0f5 100%)',
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background gap={0} />
      </ReactFlow>

      {/* "Click a cluster" hint */}
      {!selectedModule && (
        <div
          className="absolute bottom-4 left-0 right-0 text-center text-[11px] pointer-events-none"
          style={{ color: '#c0c4cc', letterSpacing: '0.3px', zIndex: 2 }}
        >
          Click a cluster to explore
        </div>
      )}

      {/* Detail panel */}
      {selectedModule && detailProps && (
        <AgentDetailPanel
          moduleId={selectedModule}
          subtitle={detailProps.subtitle}
          rows={detailProps.rows ?? []}
          categories={detailProps.categories}
          tools={detailProps.tools}
          settingsPath={MODULE_SETTINGS[selectedModule]}
          onClose={() => setSelectedModule(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/components/admin/agent-blueprint-graph.tsx
git commit -m "feat: add AgentBlueprintGraph hub-and-spoke visualization"
```

---

### Task 6: Wire into admin agent page

**Files:**
- Modify: `apps/console/app/admin/agent/page.tsx:7` — change import
- Modify: `apps/console/app/admin/agent/page.tsx:143-145` — change component usage

- [ ] **Step 1: Update import**

Change line 7 from:
```tsx
import AgentBlueprint from '@/components/admin/agent-blueprint'
```
to:
```tsx
import AgentBlueprintGraph from '@/components/admin/agent-blueprint-graph'
```

- [ ] **Step 2: Update component usage**

Change line 143-145 from:
```tsx
<AgentBlueprint
  agentId={currentAgentId}
/>
```
to:
```tsx
<AgentBlueprintGraph
  agentId={currentAgentId}
/>
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/curtis/Desktop/intera-agent/apps/console && npx next build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/console/app/admin/agent/page.tsx
git commit -m "feat: replace AgentBlueprint cards with AgentBlueprintGraph visualization"
```

---

### Task 7: Polish — remove old AgentBlueprint

**Files:**
- Delete: `apps/console/components/admin/agent-blueprint.tsx`

- [ ] **Step 1: Verify no other imports reference AgentBlueprint**

```bash
grep -r "AgentBlueprint" /Users/curtis/Desktop/intera-agent/apps/console --include="*.tsx" --include="*.ts" | grep -v "BlueprintGraph" | grep -v "node_modules"
```

Expected: Only the new `AgentBlueprintGraph` references. No imports of the old `AgentBlueprint`.

- [ ] **Step 2: Delete the old file**

```bash
rm /Users/curtis/Desktop/intera-agent/apps/console/components/admin/agent-blueprint.tsx
```

- [ ] **Step 3: Verify build still passes**

```bash
cd /Users/curtis/Desktop/intera-agent/apps/console && npx next build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A apps/console/components/admin/agent-blueprint.tsx
git commit -m "chore: remove old AgentBlueprint stats card component"
```

---

### Task 8: Visual QA — verify in browser

- [ ] **Step 1: Start dev server**

```bash
cd /Users/curtis/Desktop/intera-agent/apps/console && pnpm dev
```

- [ ] **Step 2: Open browser and navigate to `/admin/agent`**

Verify:
- Pentagon layout with 5 tinted nodes around CORE
- Each node has correct icon and color
- Hover effects (scale + glow) work
- Clicking a node opens the detail panel with slide-in animation
- Detail panel shows correct data for each module
- "Open Settings" button links to correct page
- Back button closes panel and restores full opacity
- No console errors

- [ ] **Step 3: Take screenshot for reference**

```bash
# Manual step — take screenshot and save to docs/ or similar
```
