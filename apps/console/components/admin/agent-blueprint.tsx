'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, Database, Shield, Users, Wrench, Zap, ChevronRight } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { CapabilityBindings } from '@intera/shared/types'

interface BlueprintProps {
  agentId?: string | null
}

// ── Layout constants ────────────────────────────────────────────────
const CORE_SIZE = 68
const NODE_DISTANCE = 0.62

// ── Node color tokens ──────────────────────────────────────────────
const NODE_COLORS = {
  brain:      { main: '#8b6ff5', glow: 'rgba(139,111,245,0.12)', bg: 'rgba(139,111,245,0.06)' },
  memory:     { main: '#d4912e', glow: 'rgba(212,145,46,0.12)',  bg: 'rgba(212,145,46,0.06)' },
  guardrails: { main: '#2ea04a', glow: 'rgba(46,160,74,0.12)',   bg: 'rgba(46,160,74,0.06)' },
  subAgents:  { main: '#e75c8a', glow: 'rgba(231,92,138,0.12)',  bg: 'rgba(231,92,138,0.06)' },
  tools:      { main: '#5b8af7', glow: 'rgba(91,138,247,0.12)',  bg: 'rgba(91,138,247,0.06)' },
} as const

// ── Satellite definitions ──────────────────────────────────────────
const SATELLITES = [
  { id: 'brain' as const,      navigateTo: '/admin/model',      icon: Brain,      angle: -90,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeBrain' },
  { id: 'memory' as const,     navigateTo: '/admin/memory',     icon: Database,   angle: -20,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeMemory' },
  { id: 'guardrails' as const, navigateTo: '/admin/guardrails', icon: Shield,     angle: 50,   distance: NODE_DISTANCE, labelKey: 'blueprint.nodeGuardrails' },
  { id: 'subAgents' as const,  navigateTo: '/admin/case-types', icon: Users,      angle: 130,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeSubAgents' },
  { id: 'tools' as const,      navigateTo: '/admin/tools',      icon: Wrench,     angle: 200,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeTools' },
] as const

// ── Data types ─────────────────────────────────────────────────────
interface PolicyItem { name: string; enabled: boolean; guardrailConfig?: string | null }
interface SkillItem  { name: string; enabled: boolean; isSystem?: boolean; isChannel?: boolean; isSpecial?: boolean; mode?: string }
interface CaseType   { type: string; displayName: string; enabled: boolean; stageConfigs?: string | null }
interface KBSource   { id: string; name: string; enabled: boolean }

interface GuardrailStats {
  preTool: number
  postTool: number
  preFinalize: number
  total: number
}

interface ToolStats {
  system: number
  channel: number
  business: number
  kbSources: { name: string; enabled: boolean }[]
  totalBound: number
}

interface SubAgentGroup {
  caseType: string
  displayName: string
  count: number
}

// ── Component ──────────────────────────────────────────────────────
export default function AgentBlueprint({ agentId }: BlueprintProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 })
  const { t } = useConsoleLocale()
  const router = useRouter()

  // Agent config state
  const [agentModel, setAgentModel] = useState<string | null>(null)
  const [agentTemperature, setAgentTemperature] = useState<number | null>(null)
  const [agentThinkingBudget, setAgentThinkingBudget] = useState<number | null>(null)
  const [memoryTier, setMemoryTier] = useState<string | null>(null)
  const [memoryThreshold, setMemoryThreshold] = useState<number | null>(null)
  const [bindings, setBindings] = useState<CapabilityBindings | null>(null)

  // Library data
  const [policies, setPolicies] = useState<PolicyItem[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseType[]>([])
  const [kbSources, setKbSources] = useState<KBSource[]>([])

  // ── Fetch agent config ───────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/admin/agent?agentId=${agentId}`).then(r => r.json()).then(d => d.data || d)
      .then(d => {
        const cfg = d.config || {}
        if (cfg.model) setAgentModel(cfg.model)
        if (typeof cfg.temperature === 'number') setAgentTemperature(cfg.temperature)
        if (typeof cfg.thinkingBudget === 'number') setAgentThinkingBudget(cfg.thinkingBudget)
        try {
          const ms = typeof cfg.memoryStrategy === 'string' ? JSON.parse(cfg.memoryStrategy || '{}') : (cfg.memoryStrategy || {})
          const threshold = ms.autocompactThresholdTokens ?? 0
          setMemoryThreshold(threshold)
          if (threshold <= 20000) setMemoryTier('short')
          else if (threshold <= 40000) setMemoryTier('balanced')
          else setMemoryTier('long')
        } catch { setMemoryTier(null); setMemoryThreshold(null) }
        if (cfg.capabilityBindings) {
          try {
            const raw = cfg.capabilityBindings
            setBindings(typeof raw === 'string' ? JSON.parse(raw) : raw)
          } catch { setBindings(null) }
        } else {
          setBindings(null)
        }
      })
      .catch(() => {})
  }, [agentId])

  // ── Fetch library data (policies, skills, case types, KB sources) ─
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/policies').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/skills').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/case-types').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/knowledge/sources').then(r => r.ok ? r.json().then(d => d.data || d) : null),
    ])
      .then(([policiesData, skillsData, caseTypesData, knowledgeData]) => {
        const p = (policiesData?.policies || []) as PolicyItem[]
        const s = (skillsData?.skills || []) as SkillItem[]
        const ct = (caseTypesData?.types || []) as CaseType[]
        const kb = (knowledgeData?.sources || []) as KBSource[]

        setPolicies(p)
        setSkills(s)
        setCaseTypes(ct)
        setKbSources(kb)
      })
      .catch(() => {})
  }, [])

  // ── Compute derived stats ────────────────────────────────────────
  const guardrailStats = useMemo<GuardrailStats>(() => {
    if (!bindings || !policies.length) {
      // No bindings: show all enabled policies grouped by hook
      const enabled = policies.filter(p => p.enabled)
      let preTool = 0, postTool = 0, preFinalize = 0
      for (const pol of enabled) {
        try {
          const cfg = pol.guardrailConfig ? JSON.parse(pol.guardrailConfig) : null
          if (cfg?.when === 'preTool') preTool++
          else if (cfg?.when === 'postTool') postTool++
          else if (cfg?.when === 'preFinalize') preFinalize++
          else preTool++ // default
        } catch { preTool++ }
      }
      return { preTool, postTool, preFinalize, total: enabled.length }
    }

    // With bindings: only count bound + enabled policies
    const boundNames = new Set([
      ...(bindings.guardrails?.preTool || []),
      ...(bindings.guardrails?.postTool || []),
      ...(bindings.guardrails?.preFinalize || []),
    ])
    const boundPolicies = policies.filter(p => boundNames.has(p.name) && p.enabled)
    let preTool = 0, postTool = 0, preFinalize = 0
    for (const pol of boundPolicies) {
      try {
        const cfg = pol.guardrailConfig ? JSON.parse(pol.guardrailConfig) : null
        if (cfg?.when === 'preTool') preTool++
        else if (cfg?.when === 'postTool') postTool++
        else if (cfg?.when === 'preFinalize') preFinalize++
        else preTool++
      } catch { preTool++ }
    }
    return { preTool, postTool, preFinalize, total: boundPolicies.length }
  }, [bindings, policies])

  const toolStats = useMemo<ToolStats>(() => {
    // KB sources are always shown regardless of bindings
    const kb = kbSources.map(ks => ({ name: ks.name, enabled: ks.enabled }))

    if (!bindings) {
      // No bindings: show all skills by category
      const system = skills.filter(s => s.isSystem).length
      const channel = skills.filter(s => s.isChannel).length
      const business = skills.filter(s => !s.isSystem && !s.isChannel && !s.isSpecial).length
      return { system, channel, business, kbSources: kb, totalBound: system + channel + business }
    }

    // With bindings: count bound skills by category
    const boundSet = new Set(bindings.tools || [])
    // Empty tools array = bind all
    const allBound = !bindings.tools || bindings.tools.length === 0
    const relevant = allBound ? skills : skills.filter(s => boundSet.has(s.name))

    const system = relevant.filter(s => s.isSystem).length
    const channel = relevant.filter(s => s.isChannel).length
    const business = relevant.filter(s => !s.isSystem && !s.isChannel && !s.isSpecial).length
    return { system, channel, business, kbSources: kb, totalBound: system + channel + business }
  }, [bindings, skills, kbSources])

  const subAgentGroups = useMemo<SubAgentGroup[]>(() => {
    const enabled = caseTypes.filter(ct => ct.enabled)
    const groups: SubAgentGroup[] = []
    for (const ct of enabled) {
      if (!ct.stageConfigs) continue
      try {
        const configs = JSON.parse(ct.stageConfigs)
        let count = 0
        for (const stageName of Object.keys(configs || {})) {
          const stage = configs[stageName]
          if (stage && Array.isArray(stage.subAgents)) {
            count += stage.subAgents.length
          }
        }
        if (count > 0) {
          groups.push({ caseType: ct.type, displayName: ct.displayName, count })
        }
      } catch { /* ignore */ }
    }
    return groups
  }, [caseTypes])

  const totalSubAgents = subAgentGroups.reduce((sum, g) => sum + g.count, 0)

  // ── ResizeObserver ───────────────────────────────────────────────
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

  const connectionLines = SATELLITES.map(s => {
    const nodePos = getNodePos(s.angle, s.distance)
    const rad = (s.angle * Math.PI) / 180
    const fromX = cx + Math.cos(rad) * (CORE_SIZE / 2 + 4)
    const fromY = cy + Math.sin(rad) * (CORE_SIZE / 2 + 4)
    const toX = nodePos.x - Math.cos(rad) * 24
    const toY = nodePos.y - Math.sin(rad) * 24
    return { x1: fromX, y1: fromY, x2: toX, y2: toY, id: s.id, color: NODE_COLORS[s.id].main }
  })

  // ── Render: satellite card content ───────────────────────────────
  function renderBrainDetail() {
    if (!agentModel) return <span className="text-[11px] text-[var(--smoke)]">{t('blueprint.notConfigured')}</span>
    const parts: string[] = []
    if (agentTemperature != null) parts.push(`temp ${agentTemperature}`)
    if (agentThinkingBudget != null) parts.push(`budget ${(agentThinkingBudget / 1000).toFixed(0)}k`)
    return (
      <>
        <div className="text-[12px] font-semibold text-[var(--mist)] truncate">{agentModel}</div>
        {parts.length > 0 && <div className="text-[10px] text-[var(--smoke)] mt-0.5">{parts.join(' · ')}</div>}
      </>
    )
  }

  function renderMemoryDetail() {
    if (!memoryTier) return <span className="text-[11px] text-[var(--smoke)]">{t('blueprint.notConfigured')}</span>
    const tierLabel = t(`blueprint.memoryTier${memoryTier.charAt(0).toUpperCase() + memoryTier.slice(1)}` as any) || memoryTier
    return (
      <>
        <div className="text-[12px] font-semibold text-[var(--mist)]">{tierLabel}</div>
        {memoryThreshold != null && (
          <div className="text-[10px] text-[var(--smoke)] mt-0.5">autocompact: {(memoryThreshold / 1000).toFixed(0)}k tokens</div>
        )}
      </>
    )
  }

  function renderGuardrailsDetail() {
    const { preTool, postTool, preFinalize, total } = guardrailStats
    if (total === 0) return <span className="text-[11px] text-[var(--smoke)]">{t('blueprint.noPolicies')}</span>
    return (
      <>
        <div className="flex items-center gap-2 text-[11px] text-[var(--mist)]">
          <span>preTool: <strong>{preTool}</strong></span>
          <span className="text-[var(--smoke)]">·</span>
          <span>postTool: <strong>{postTool}</strong></span>
          <span className="text-[var(--smoke)]">·</span>
          <span>finalize: <strong>{preFinalize}</strong></span>
        </div>
      </>
    )
  }

  function renderSubAgentsDetail() {
    if (totalSubAgents === 0) return <span className="text-[11px] text-[var(--smoke)]">{t('blueprint.noSubAgents')}</span>
    return (
      <div className="flex flex-col gap-0.5">
        {subAgentGroups.map(g => (
          <div key={g.caseType} className="text-[11px] text-[var(--mist)]">
            {g.displayName}: <strong>{g.count}</strong> {g.count === 1 ? 'agent' : 'agents'}
          </div>
        ))}
      </div>
    )
  }

  function renderToolsDetail() {
    const { system, channel, business, kbSources: kb, totalBound } = toolStats
    const total = totalBound + kb.length
    if (total === 0) return <span className="text-[11px] text-[var(--smoke)]">{t('blueprint.noTools')}</span>
    return (
      <>
        <div className="flex items-center gap-2 text-[11px] text-[var(--mist)] flex-wrap">
          {system > 0 && <span>Sys <strong>{system}</strong></span>}
          {channel > 0 && <>
            {system > 0 && <span className="text-[var(--smoke)]">·</span>}
            <span>Ch <strong>{channel}</strong></span>
          </>}
          {business > 0 && <>
            {(system > 0 || channel > 0) && <span className="text-[var(--smoke)]">·</span>}
            <span>Biz <strong>{business}</strong></span>
          </>}
        </div>
        {kb.length > 0 && (
          <div className="text-[10px] text-[var(--smoke)] mt-0.5">
            KB: {kb.map(k => k.name).join(', ')} ({kb.length})
          </div>
        )}
      </>
    )
  }

  const detailRenderers: Record<string, () => React.ReactNode> = {
    brain: renderBrainDetail,
    memory: renderMemoryDetail,
    guardrails: renderGuardrailsDetail,
    subAgents: renderSubAgentsDetail,
    tools: renderToolsDetail,
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: '100%', minHeight: '500px' }}>
      {/* ── Connection lines (SVG) ──────────────────────────────── */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1, overflow: 'visible' }}>
        <defs>
          {SATELLITES.map(s => (
            <linearGradient key={s.id} id={`grad-${s.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={NODE_COLORS[s.id].main} stopOpacity={0.25} />
              <stop offset="100%" stopColor={NODE_COLORS[s.id].main} stopOpacity={0.03} />
            </linearGradient>
          ))}
        </defs>
        {connectionLines.map(line => (
          <g key={line.id}>
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeOpacity={0.06} strokeWidth={6} strokeLinecap="round" />
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={`url(#grad-${line.id})`} strokeWidth={1.5} strokeLinecap="round" />
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeOpacity={0.2} strokeWidth={1.2}
              strokeDasharray="3 10" strokeLinecap="round"
              className="animate-particle-flow" />
          </g>
        ))}
      </svg>

      {/* ── Core node ──────────────────────────────────────────── */}
      <div className="absolute left-1/2 top-1/2 z-10 flex flex-col items-center pointer-events-none"
        style={{ transform: 'translate(-50%, -50%)' }}>
        <div
          className="absolute rounded-full pointer-events-none opacity-30"
          style={{
            width: CORE_SIZE * 2.2, height: CORE_SIZE * 2.2,
            background: 'radial-gradient(circle, rgba(139,111,245,0.08) 0%, transparent 72%)',
            transform: 'translate(-50%, -50%)', left: '50%', top: '50%',
          }}
        />
        <div
          className="relative rounded-2xl flex flex-col items-center justify-center pointer-events-auto animate-core-box-breathe"
          style={{
            width: CORE_SIZE, height: CORE_SIZE,
            background: 'linear-gradient(135deg, rgba(139,111,245,0.12), rgba(91,138,247,0.05))',
            border: '1px solid rgba(139,111,245,0.2)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Zap className="text-lavender mb-0.5 animate-core-zap-soft" style={{ width: 20, height: 20 }} />
          <span className="text-[10px] font-bold text-lavender/60 tracking-[0.12em] uppercase">{t('blueprint.core')}</span>
        </div>
      </div>

      {/* ── Satellite cards ────────────────────────────────────── */}
      {SATELLITES.map(s => {
        const pos = getNodePos(s.angle, s.distance)
        const colors = NODE_COLORS[s.id]
        const Icon = s.icon
        const detail = detailRenderers[s.id]?.()

        return (
          <button
            key={s.id}
            onClick={() => router.push(s.navigateTo)}
            className="absolute z-10 text-left group"
            style={{
              left: pos.x, top: pos.y,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="rounded-2xl transition-all duration-300 ease-out cursor-pointer
                hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
              style={{
                width: 200,
                padding: '12px 14px',
                background: 'rgba(255,252,249,0.82)',
                backdropFilter: 'blur(20px) saturate(160%)',
                border: `1px solid rgba(0,0,0,0.04)`,
                borderLeft: `3px solid ${colors.main}`,
                boxShadow: `0 2px 8px rgba(0,0,0,0.03), 0 0 0 0 ${colors.glow}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 4px 20px ${colors.glow}, 0 0 0 1px ${colors.main}20`
                e.currentTarget.style.borderColor = `rgba(0,0,0,0.06)`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = `0 2px 8px rgba(0,0,0,0.03), 0 0 0 0 ${colors.glow}`
                e.currentTarget.style.borderColor = `rgba(0,0,0,0.04)`
              }}
            >
              {/* Header: icon + label + arrow */}
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: colors.bg }}
                >
                  <Icon style={{ width: 14, height: 14, color: colors.main }} />
                </div>
                <span className="text-[12px] font-semibold text-[var(--mist)] flex-1">
                  {t(s.labelKey as any) || s.id}
                </span>
                <ChevronRight
                  className="w-3.5 h-3.5 text-[var(--smoke)] opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>

              {/* Detail content */}
              <div className="pl-9">
                {detail}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
