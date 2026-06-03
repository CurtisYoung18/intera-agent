'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, Database, Shield, Users, Wrench, Zap, ExternalLink } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { resolveBindings, hasMissing } from '@/lib/agent/resolve-bindings'
import type { CapabilityLibrary } from '@/lib/agent/resolve-bindings'
import type { CapabilityBindings } from '@intera/shared/types'

interface BlueprintProps {
  /** The currently selected agent ID (from localStorage) */
  agentId?: string | null
}

const CORE_RADIUS = 52
const NODE_OFFSET = 60

export default function AgentBlueprint({ agentId }: BlueprintProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 })
  const { t } = useConsoleLocale()
  const router = useRouter()
  const [subAgentCount, setSubAgentCount] = useState(0)
  const [caseTypeCount, setCaseTypeCount] = useState(0)
  const [bindings, setBindings] = useState<CapabilityBindings | null>(null)
  const [library, setLibrary] = useState<CapabilityLibrary | null>(null)
  const [bindingStats, setBindingStats] = useState<{
    brain: { bound: number; missing: number }
    memory: { bound: number; missing: number }
    guardrails: { bound: number; missing: number }
    tools: { bound: number; missing: number }
    caseTypes: { bound: number; missing: number }
    knowledge: { bound: number; missing: number }
  } | null>(null)

  // Fetch capability bindings for the selected version
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/admin/agent?agentId=${agentId}`)
      .then(r => r.json())
      .then(d => {
        if (d.config?.capabilityBindings) {
          try {
            const raw = d.config.capabilityBindings
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
            setBindings(parsed)
          } catch { setBindings(null) }
        } else {
          setBindings(null)
        }
      })
      .catch(() => {})
  }, [agentId])

  // Fetch library data for drift detection
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/policies').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/skills').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/case-types').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/knowledge/sources').then(r => r.ok ? r.json() : null),
    ])
      .then(([policiesData, skillsData, caseTypesData, knowledgeData]) => {
        const policyNames = new Set<string>((policiesData?.policies || []).map((p: { name: string }) => p.name))
        const skillNames = new Set<string>((skillsData?.skills || []).map((s: { name: string }) => s.name))
        const caseTypeSlugs = new Set<string>((caseTypesData?.types || []).map((ct: { type: string }) => ct.type))
        const knowledgeNames = new Set<string>((knowledgeData?.sources || []).map((ks: { name: string }) => ks.name))
        setLibrary({ policyNames, skillNames, caseTypeSlugs, knowledgeNames })
      })
      .catch(() => {})
  }, [])

  // Compute binding stats
  useEffect(() => {
    if (!bindings || !library) {
      setBindingStats(null)
      return
    }
    const resolved = resolveBindings(bindings, library)
    setBindingStats({
      brain: { bound: 0, missing: 0 },
      memory: { bound: 0, missing: 0 },
      guardrails: {
        bound: resolved.bound.guardrails.preTool.length + resolved.bound.guardrails.postTool.length + resolved.bound.guardrails.preFinalize.length,
        missing: resolved.missing.guardrails.length,
      },
      tools: {
        bound: resolved.bound.tools.length,
        missing: resolved.missing.tools.length,
      },
      caseTypes: {
        bound: resolved.bound.caseTypes.length,
        missing: resolved.missing.caseTypes.length,
      },
      knowledge: {
        bound: resolved.bound.knowledge.length,
        missing: resolved.missing.knowledge.length,
      },
    })
  }, [bindings, library])

  // Fetch case-type info for sub-agent preview
  useEffect(() => {
    fetch('/api/admin/case-types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => {
        const types = (d.types || []) as Array<{
          type: string; displayName: string; enabled: boolean; stageConfigs: string | null
        }>
        const enabled = types.filter((ct) => ct.enabled)
        let saCount = 0
        for (const ct of enabled) {
          if (ct.stageConfigs) {
            try {
              const configs = JSON.parse(ct.stageConfigs)
              for (const stageName of Object.keys(configs || {})) {
                const stage = configs[stageName]
                if (stage && Array.isArray(stage.subAgents)) {
                  saCount += stage.subAgents.length
                }
              }
            } catch { /* ignore */ }
          }
        }
        setSubAgentCount(saCount)
        setCaseTypeCount(enabled.length)
      })
      .catch(() => { /* ignore */ })
  }, [])

  const satellites = useMemo(
    () =>
      [
        {
          id: 'brain' as const,
          navigateTo: '/admin/model',
          icon: <Brain className="w-5 h-5" />,
          label: t('blueprint.nodeBrain'),
          color: '#8b6ff5',
          glow: 'rgba(139,111,245,0.15)',
          angle: -90,
          distance: 0.65,
        },
        {
          id: 'memory' as const,
          navigateTo: '/admin/memory',
          icon: <Database className="w-5 h-5" />,
          label: t('blueprint.nodeMemory'),
          color: '#d4912e',
          glow: 'rgba(212,145,46,0.15)',
          angle: -20,
          distance: 0.65,
        },
        {
          id: 'guardrails' as const,
          navigateTo: '/admin/guardrails',
          icon: <Shield className="w-5 h-5" />,
          label: t('blueprint.nodeGuardrails'),
          color: '#2ea04a',
          glow: 'rgba(46,160,74,0.15)',
          angle: 50,
          distance: 0.65,
        },
        {
          id: 'subAgents' as const,
          navigateTo: '/admin/case-types',
          icon: <Users className="w-5 h-5" />,
          label: t('blueprint.nodeSubAgents'),
          color: '#e75c8a',
          glow: 'rgba(231,92,138,0.15)',
          angle: 130,
          distance: 0.65,
        },
        {
          id: 'tools' as const,
          navigateTo: '/admin/tools',
          icon: <Wrench className="w-5 h-5" />,
          label: t('blueprint.nodeTools'),
          color: '#5b8af7',
          glow: 'rgba(91,138,247,0.15)',
          angle: 200,
          distance: 0.65,
        },
      ] as const,
    [t],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cx = dimensions.w / 2
  const cy = dimensions.h / 2
  const maxRadius = Math.min(cx, cy) * 0.85

  const getNodePos = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180
    const r = maxRadius * dist
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
  }

  const connectionLines = satellites.map(s => {
    const nodePos = getNodePos(s.angle, s.distance)
    const rad = (s.angle * Math.PI) / 180
    const fromX = cx + Math.cos(rad) * CORE_RADIUS
    const fromY = cy + Math.sin(rad) * CORE_RADIUS
    const toX = nodePos.x - Math.cos(rad) * NODE_OFFSET
    const toY = nodePos.y - Math.sin(rad) * NODE_OFFSET
    return { x1: fromX, y1: fromY, x2: toX, y2: toY, id: s.id, color: s.color }
  })

  // Map satellite node id → bindingStats key (subAgents → caseTypes)
  const NODE_TO_STAT_KEY: Record<string, string> = {
    brain: 'brain',
    memory: 'memory',
    guardrails: 'guardrails',
    subAgents: 'caseTypes',
    tools: 'tools',
  }

  function getNodePreview(nodeId: string): string {
    if (!bindingStats) return ''
    const statKey = NODE_TO_STAT_KEY[nodeId]
    if (!statKey) return ''
    const stats = bindingStats[statKey as keyof typeof bindingStats]
    if (!stats) return ''
    const parts: string[] = []
    if (stats.bound > 0) parts.push(t('blueprint.nodeCount', { n: stats.bound }))
    if (stats.missing > 0) parts.push(t('blueprint.nodeDrift', { n: stats.missing }))
    if (stats.bound === 0 && stats.missing === 0) parts.push(t('blueprint.clickToNavigate'))
    return parts.join(' · ')
  }

  function getSpecialPreview(nodeId: string): string {
    // Fallback previews when no bindings yet
    switch (nodeId) {
      case 'subAgents':
        return subAgentCount > 0
          ? t('blueprint.subAgentsPreview', { n: subAgentCount })
          : t('blueprint.noSubAgents')
      default:
        return ''
    }
  }

  function hasDrift(nodeId: string): boolean {
    if (!bindingStats) return false
    const statKey = NODE_TO_STAT_KEY[nodeId]
    if (!statKey) return false
    const stats = bindingStats[statKey as keyof typeof bindingStats]
    return stats ? stats.missing > 0 : false
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: '100%', minHeight: '500px' }}>
      {/* Connection lines — SVG */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1, overflow: 'visible' }}>
        <defs>
          {satellites.map(s => (
            <linearGradient key={s.id} id={`grad-${s.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        {connectionLines.map(line => (
          <g key={line.id}>
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeOpacity={0.1} strokeWidth={4} strokeLinecap="round" />
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={`url(#grad-${line.id})`} strokeWidth={1} strokeLinecap="round" />
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color}
              strokeOpacity={0.25}
              strokeWidth={1.5}
              strokeDasharray="4 12"
              strokeLinecap="round"
              className="animate-particle-flow" />
            <circle cx={line.x2} cy={line.y2} r={2}
              fill={line.color} opacity={0.3} />
          </g>
        ))}
      </svg>

      {/* Agent Core — center */}
      <div className="absolute left-1/2 top-1/2 z-10 flex flex-col items-center pointer-events-none"
        style={{ transform: 'translate(-50%, -50%)' }}>
        <div
          className="absolute w-[140px] h-[140px] rounded-full pointer-events-none opacity-[0.38]"
          style={{
            background: 'radial-gradient(circle, rgba(139,111,245,0.07) 0%, transparent 72%)',
            transform: 'translate(-50%, -50%)',
            left: '50%',
            top: '50%',
          }}
        />
        <div
          className="relative w-[72px] h-[72px] rounded-2xl flex flex-col items-center justify-center pointer-events-auto animate-core-box-breathe"
          style={{
            background: 'linear-gradient(135deg, rgba(139,111,245,0.15), rgba(91,138,247,0.06))',
            border: '1px solid rgba(139,111,245,0.25)',
            transformOrigin: 'center center',
          }}
        >
          <Zap className="w-[22px] h-[22px] text-lavender mb-0.5 animate-core-zap-soft" />
          <span className="text-[11px] font-bold text-lavender/70 tracking-[0.1em] uppercase">{t('blueprint.core')}</span>
        </div>
        <div className="mt-3 flex items-center gap-1.5 pointer-events-auto">
          <div className="w-1.5 h-1.5 rounded-full bg-lavender/40" />
          <span className="text-[11px] text-[var(--fog)] font-medium">
            {t('blueprint.clickToNavigate')}
          </span>
        </div>
      </div>

      {/* Satellite nodes */}
      {satellites.map(s => {
        const pos = getNodePos(s.angle, s.distance)
        const bindingPreview = getNodePreview(s.id)
        const specialPreview = getSpecialPreview(s.id)
        const preview = bindingPreview || specialPreview
        const drift = hasDrift(s.id)

        return (
          <button
            key={s.id}
            onClick={() => router.push(s.navigateTo)}
            className="absolute z-10 flex items-center gap-3 px-6 py-4 rounded-xl transition-all duration-300 ease-out
              bg-white/80 backdrop-blur-xl border cursor-pointer text-left group
              hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
            style={{
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, -50%)`,
              borderColor: drift ? 'rgba(212,145,46,0.4)' : 'rgba(0,0,0,0.05)',
              boxShadow: drift ? '0 0 16px rgba(212,145,46,0.12), 0 1px 3px rgba(0,0,0,0.04)' : '0 1px 3px rgba(0,0,0,0.04)',
            }}
            title={t('blueprint.clickToNavigate')}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200"
              style={{ background: `linear-gradient(135deg, ${s.glow}, transparent)`, color: s.color }}>
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--mist)] flex items-center gap-1.5">
                {s.label}
                {drift && (
                  <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber/[0.12] text-amber font-bold">
                    {bindingStats?.[s.id === 'subAgents' ? 'caseTypes' : s.id]?.missing ?? 0}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--fog)] truncate max-w-[320px] mt-0.5">{preview || '—'}</div>
            </div>
            {/* Navigate arrow */}
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: `${s.color}10` }}>
              <ExternalLink className="w-3 h-3" style={{ color: s.color }} />
            </div>
          </button>
        )
      })}
    </div>
  )
}
