'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, Database, Shield, Users, Wrench, Zap } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { CapabilityBindings } from '@intera/shared/types'

interface BlueprintProps {
  agentId?: string | null
}

const CORE_SIZE = 68
const NODE_DISTANCE = 0.72

const NODE_COLORS = {
  brain:      { main: '#8b6ff5', glow: 'rgba(139,111,245,0.12)', bg: 'rgba(139,111,245,0.06)' },
  memory:     { main: '#d4912e', glow: 'rgba(212,145,46,0.12)',  bg: 'rgba(212,145,46,0.06)' },
  guardrails: { main: '#2ea04a', glow: 'rgba(46,160,74,0.12)',   bg: 'rgba(46,160,74,0.06)' },
  subAgents:  { main: '#e75c8a', glow: 'rgba(231,92,138,0.12)',  bg: 'rgba(231,92,138,0.06)' },
  tools:      { main: '#5b8af7', glow: 'rgba(91,138,247,0.12)',  bg: 'rgba(91,138,247,0.06)' },
} as const

const SATELLITES = [
  { id: 'brain' as const,      navigateTo: '/admin/model',      icon: Brain,    angle: -90,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeBrain' },
  { id: 'memory' as const,     navigateTo: '/admin/memory',     icon: Database, angle: -20,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeMemory' },
  { id: 'guardrails' as const, navigateTo: '/admin/guardrails', icon: Shield,   angle: 50,   distance: NODE_DISTANCE, labelKey: 'blueprint.nodeGuardrails' },
  { id: 'subAgents' as const,  navigateTo: '/admin/case-types', icon: Users,    angle: 130,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeSubAgents' },
  { id: 'tools' as const,      navigateTo: '/admin/tools',      icon: Wrench,   angle: 200,  distance: NODE_DISTANCE, labelKey: 'blueprint.nodeTools' },
] as const

interface PolicyItem { name: string; enabled: boolean; guardrailConfig?: string | null }
interface SkillItem  { name: string; enabled: boolean; isSystem?: boolean; isChannel?: boolean; isSpecial?: boolean }
interface CaseType   { type: string; displayName: string; enabled: boolean; stageConfigs?: string | null }
interface KBSource   { id: string; name: string; enabled: boolean }

export default function AgentBlueprint({ agentId }: BlueprintProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 })
  const { t } = useConsoleLocale()
  const router = useRouter()

  const [agentModel, setAgentModel] = useState<string | null>(null)
  const [memoryTier, setMemoryTier] = useState<string | null>(null)
  const [bindings, setBindings] = useState<CapabilityBindings | null>(null)
  const [policies, setPolicies] = useState<PolicyItem[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseType[]>([])
  const [kbSources, setKbSources] = useState<KBSource[]>([])

  useEffect(() => {
    if (!agentId) return
    fetch(`/api/admin/agent?agentId=${agentId}`).then(r => r.json()).then(d => d.data || d)
      .then(d => {
        const cfg = d.config || {}
        if (cfg.model) setAgentModel(cfg.model)
        try {
          const ms = typeof cfg.memoryStrategy === 'string' ? JSON.parse(cfg.memoryStrategy || '{}') : (cfg.memoryStrategy || {})
          const t = ms.autocompactThresholdTokens ?? 0
          if (t <= 20000) setMemoryTier('short')
          else if (t <= 40000) setMemoryTier('balanced')
          else setMemoryTier('long')
        } catch { setMemoryTier(null) }
        if (cfg.capabilityBindings) {
          try { setBindings(typeof cfg.capabilityBindings === 'string' ? JSON.parse(cfg.capabilityBindings) : cfg.capabilityBindings) }
          catch { setBindings(null) }
        } else { setBindings(null) }
      })
      .catch(() => {})
  }, [agentId])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/policies').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/skills').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/case-types').then(r => r.ok ? r.json().then(d => d.data || d) : null),
      fetch('/api/admin/knowledge/sources').then(r => r.ok ? r.json().then(d => d.data || d) : null),
    ])
      .then(([policiesData, skillsData, caseTypesData, knowledgeData]) => {
        setPolicies((policiesData?.policies || []) as PolicyItem[])
        setSkills((skillsData?.skills || []) as SkillItem[])
        setCaseTypes((caseTypesData?.types || []) as CaseType[])
        setKbSources((knowledgeData?.sources || []) as KBSource[])
      })
      .catch(() => {})
  }, [])

  // ── Derived stats (one-liners) ──────────────────────────────────
  const guardrailTotal = useMemo(() => {
    const enabled = policies.filter(p => p.enabled)
    if (!bindings) return enabled.length
    const boundNames = new Set([
      ...(bindings.guardrails?.preTool || []),
      ...(bindings.guardrails?.postTool || []),
      ...(bindings.guardrails?.preFinalize || []),
    ])
    return enabled.filter(p => boundNames.has(p.name)).length
  }, [bindings, policies])

  const toolSummary = useMemo(() => {
    const allBound = !bindings?.tools || bindings.tools.length === 0
    const relevant = allBound ? skills : skills.filter(s => bindings!.tools.includes(s.name))
    const sys = relevant.filter(s => s.isSystem).length
    const ch = relevant.filter(s => s.isChannel).length
    const biz = relevant.filter(s => !s.isSystem && !s.isChannel && !s.isSpecial).length
    const kb = kbSources.length
    return { sys, ch, biz, kb }
  }, [bindings, skills, kbSources])

  const subAgentTotal = useMemo(() => {
    let count = 0
    for (const ct of caseTypes.filter(c => c.enabled)) {
      if (!ct.stageConfigs) continue
      try {
        const cfg = JSON.parse(ct.stageConfigs)
        for (const s of Object.values(cfg || {})) {
          const stage = s as Record<string, unknown>
          if (Array.isArray(stage?.subAgents)) count += stage.subAgents.length
        }
      } catch {}
    }
    return count
  }, [caseTypes])

  // ── Layout ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(e => { for (const x of e) setDimensions({ w: x.contentRect.width, h: x.contentRect.height }) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cx = dimensions.w / 2
  const cy = dimensions.h / 2
  const maxR = Math.min(cx, cy) * 0.85

  const pos = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180
    const r = maxR * dist
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
  }

  const lines = SATELLITES.map(s => {
    const p = pos(s.angle, s.distance)
    const rad = (s.angle * Math.PI) / 180
    return {
      x1: cx + Math.cos(rad) * (CORE_SIZE / 2 + 4),
      y1: cy + Math.sin(rad) * (CORE_SIZE / 2 + 4),
      x2: p.x - Math.cos(rad) * 20,
      y2: p.y - Math.sin(rad) * 20,
      id: s.id, color: NODE_COLORS[s.id].main,
    }
  })

  // ── Tag content (one line each) ─────────────────────────────────
  function tagContent(id: string): string {
    switch (id) {
      case 'brain':
        return agentModel || t('blueprint.notConfigured')
      case 'memory': {
        if (!memoryTier) return t('blueprint.notConfigured')
        return t(`blueprint.memoryTier${memoryTier.charAt(0).toUpperCase() + memoryTier.slice(1)}` as any) || memoryTier
      }
      case 'guardrails':
        return guardrailTotal > 0 ? `${guardrailTotal} rules` : t('blueprint.noPolicies')
      case 'subAgents':
        return subAgentTotal > 0 ? `${subAgentTotal} agents` : t('blueprint.noSubAgents')
      case 'tools': {
        const { sys, ch, biz, kb } = toolSummary
        const total = sys + ch + biz + kb
        if (total === 0) return t('blueprint.noTools')
        const parts: string[] = []
        if (sys) parts.push(`${sys} sys`)
        if (ch) parts.push(`${ch} ch`)
        if (biz) parts.push(`${biz} biz`)
        if (kb) parts.push(`${kb} kb`)
        return parts.join(' · ')
      }
      default: return ''
    }
  }

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: '100%', minHeight: '500px' }}>
      {/* Connection lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1, overflow: 'visible' }}>
        {lines.map(l => (
          <g key={l.id}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.color} strokeOpacity={0.08} strokeWidth={5} strokeLinecap="round" />
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.color} strokeOpacity={0.22} strokeWidth={1.2}
              strokeDasharray="3 10" strokeLinecap="round"
              className="animate-particle-flow" />
          </g>
        ))}
      </svg>

      {/* Core */}
      <div className="absolute left-1/2 top-1/2 z-10 flex flex-col items-center pointer-events-none"
        style={{ transform: 'translate(-50%, -50%)' }}>
        <div className="absolute rounded-full pointer-events-none opacity-30"
          style={{
            width: CORE_SIZE * 2.2, height: CORE_SIZE * 2.2,
            background: 'radial-gradient(circle, rgba(139,111,245,0.08) 0%, transparent 72%)',
            transform: 'translate(-50%, -50%)', left: '50%', top: '50%',
          }} />
        <div className="relative rounded-2xl flex flex-col items-center justify-center pointer-events-auto animate-core-box-breathe"
          style={{
            width: CORE_SIZE, height: CORE_SIZE,
            background: 'linear-gradient(135deg, rgba(139,111,245,0.12), rgba(91,138,247,0.05))',
            border: '1px solid rgba(139,111,245,0.2)',
            backdropFilter: 'blur(12px)',
          }}>
          <Zap className="text-lavender mb-0.5 animate-core-zap-soft" style={{ width: 20, height: 20 }} />
          <span className="text-[10px] font-bold text-lavender/60 tracking-[0.12em] uppercase">{t('blueprint.core')}</span>
        </div>
      </div>

      {/* Satellite tags */}
      {SATELLITES.map(s => {
        const p = pos(s.angle, s.distance)
        const c = NODE_COLORS[s.id]
        const Icon = s.icon
        const label = t(s.labelKey as any) || s.id
        const value = tagContent(s.id)

        return (
          <button
            key={s.id}
            onClick={() => router.push(s.navigateTo)}
            className="absolute z-10 text-left group"
            style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)' }}
          >
            <div
              className="rounded-xl transition-all duration-200 ease-out cursor-pointer
                hover:-translate-y-0.5 active:scale-[0.97]"
              style={{
                padding: '10px 14px',
                background: 'rgba(255,252,249,0.82)',
                backdropFilter: 'blur(16px) saturate(150%)',
                border: `1px solid rgba(0,0,0,0.04)`,
                borderLeft: `2.5px solid ${c.main}`,
                boxShadow: `0 1px 4px rgba(0,0,0,0.03)`,
                minWidth: 120,
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 16px ${c.glow}` }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 1px 4px rgba(0,0,0,0.03)` }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon style={{ width: 13, height: 13, color: c.main }} />
                <span className="text-[12px] font-semibold text-[var(--mist)]">{label}</span>
              </div>
              <div className="text-[11.5px] text-[var(--fog)] pl-[18px] truncate max-w-[180px]" title={value}>
                {value}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
