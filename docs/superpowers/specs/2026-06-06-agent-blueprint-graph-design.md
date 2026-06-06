# Agent Blueprint — Hub & Spoke Graph

**Date:** 2026-06-06
**Status:** Approved
**Replaces:** AgentBlueprint stats card grid

## Goal

Replace the 3-card stats grid on `/admin/agent` with an interactive hub-and-spoke network diagram showing the agent's 5 modules (Brain, Memory, Tools, Guardrails, Case Agents) radiating from a central CORE node. Clicking a module opens a slide-in detail panel.

## Architecture

### Component: `AgentBlueprintGraph`

- **Location:** `apps/console/components/admin/agent-blueprint-graph.tsx`
- **Replaces:** `AgentBlueprint` in `apps/console/app/admin/agent/page.tsx`
- **Dependencies:** `@xyflow/react` (React Flow v12)

### Data Flow

```
AgentBlueprintGraph
├── Fetches agent config via apiClient (existing endpoints)
├── Renders React Flow canvas with:
│   ├── 1 CoreNode (center, non-draggable)
│   └── 5 ModuleNode instances (positioned in pentagon)
├── Click handler → sets selectedModule state
└── SlidePanel (conditional) → renders module detail
```

### API Endpoints (already exist)

| Module | Endpoint | Fields |
|--------|----------|--------|
| Brain | `/api/admin/agent-configs/[id]` | model, temperature, thinkingBudget, fallbackModel |
| Memory | `/api/admin/agent-configs/[id]` | memory config |
| Tools | `/api/admin/tools?agentConfigId=[id]` | tools[], categories |
| Guardrails | `/api/admin/policies?agentConfigId=[id]` | policies[], count |
| Case Agents | `/api/admin/case-types?agentConfigId=[id]` | types[], count |

### Node Design

Each module node uses a **tinted glassmorphism card** (rounded square, 20px radius):

| Module | Background | Border | Icon | Color |
|--------|-----------|--------|------|-------|
| Brain | rose→salmon gradient | rgba(239,68,68,0.2) | `BrainCircuit` (lucide) | #dc2626 |
| Memory | yellow→gold gradient | rgba(245,158,11,0.2) | `Database` (lucide) | #d97706 |
| Tools | sky→blue gradient | rgba(59,130,246,0.2) | `Wrench` (lucide) | #2563eb |
| Guardrails | emerald→mint gradient | rgba(34,197,94,0.2) | `Shield` (lucide) | #16a34a |
| Case Agents | pink→rose gradient | rgba(236,72,153,0.2) | `Users` (lucide) | #db2777 |

- Inner white gradient overlay for frosted glass effect
- `backdrop-filter: blur(24px)`
- Hover: scale(1.06) + colored box-shadow glow
- Dimmed state for non-selected modules when panel is open (opacity 0.4)

### CORE Node

- Center of diagram, circular, dashed border
- `Zap` icon from lucide-react
- Non-interactive, non-draggable

### Connection Lines

- SVG `<line>` elements from center to each module node
- Color: `#d4d7e0`, width 1.2, opacity 0.5
- Dim to 0.25 opacity when detail panel is open

### Layout

- Pentagon arrangement around center
- React Flow with `nodesDraggable={false}`, `nodesConnectable={false}`
- `fitView` for responsive centering
- Minimap and controls hidden

### Detail Panel

- Slides in from right, width 280px
- `backdrop-filter: blur(24px)`, white 88% opacity background
- Header: icon (matching module color gradient) + name + subtitle
- Rows: key-value pairs for module config
- Footer: "Open Settings →" button navigates to module settings page
- Back button closes panel, restores full diagram opacity

### Animation

- Entrance: nodes fade in (CSS opacity transition 0.4s)
- Hover: scale + glow (CSS transition 0.25s cubic-bezier)
- Panel: slide-in from right (transform translateX, 0.3s)

## File Changes

1. **New:** `apps/console/components/admin/agent-blueprint-graph.tsx` — main component
2. **New:** `apps/console/components/admin/nodes/core-node.tsx` — CORE node component
3. **New:** `apps/console/components/admin/nodes/module-node.tsx` — module node component
4. **New:** `apps/console/components/admin/agent-detail-panel.tsx` — slide-in panel
5. **Modified:** `apps/console/app/admin/agent/page.tsx` — import AgentBlueprintGraph instead of AgentBlueprint
6. **Modified:** `apps/console/package.json` — add `@xyflow/react` dependency

## Out of Scope

- Dragging nodes
- Adding/removing nodes
- Animated particle effects
- Real-time data updates
- Mobile responsive layout (desktop-first)
