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

  const buildNodes = useCallback((sel: ModuleId | null, tc: number, pc: number, ctCount: number): Node[] => [
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
        ['tools', 'Tools', `${tc} tools`],
        ['memory', 'Memory', 'Balanced tier'],
        ['caseAgents', 'Case Agents', `${ctCount} types`],
        ['guardrails', 'Guardrails', `${pc} rules`],
      ] as const
    ).map(([id, , subtitle]) => ({
      id,
      type: 'moduleNode' as const,
      position: { x: POSITIONS[id][0] - 36, y: POSITIONS[id][1] - 36 },
      data: {
        moduleId: id,
        subtitle,
        dimmed: sel !== null && sel !== id,
        onClick: (mid: ModuleId) => setSelectedModule(mid === sel ? null : mid),
      },
      draggable: false,
      selectable: false,
    })),
  ], [])

  const buildEdges = useCallback((sel: ModuleId | null): Edge[] => (
    Object.keys(POSITIONS) as ModuleId[]
  ).map((id) => ({
    id: `core-${id}`,
    source: 'core',
    target: id,
    style: {
      stroke: '#d4d7e0',
      strokeWidth: 1.2,
      opacity: sel ? 0.25 : 0.5,
      transition: 'opacity 0.3s',
    },
  })), [])

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(null, 0, 0, 0))
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(null))

  useEffect(() => {
    setNodes(buildNodes(selectedModule, toolsCount, policiesCount, caseTypesCount))
  }, [selectedModule, toolsCount, policiesCount, caseTypesCount, buildNodes, setNodes])

  useEffect(() => {
    setEdges(buildEdges(selectedModule))
  }, [selectedModule, buildEdges, setEdges])

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

      {!selectedModule && (
        <div
          className="absolute bottom-4 left-0 right-0 text-center text-[11px] pointer-events-none"
          style={{ color: '#c0c4cc', letterSpacing: '0.3px', zIndex: 2 }}
        >
          Click a cluster to explore
        </div>
      )}

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
