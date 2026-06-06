'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useConsoleLocale } from '@/components/locale-provider'
import type { CapabilityBindings } from '@intera/shared/types'

// ─── Types ─────────────────────────────────────────────────────────
interface PolicyItem { name: string; enabled: boolean; guardrailConfig?: string | null }
interface SkillItem  { name: string; enabled: boolean; isSystem?: boolean; isChannel?: boolean; isSpecial?: boolean }
interface CaseType   { type: string; displayName: string; enabled: boolean; stageConfigs?: string | null }
interface KBSource   { id: string; name: string; enabled: boolean }

interface Particle {
  x: number; y: number
  vx: number; vy: number
  r: number; alpha: number
  orbitRadius: number; orbitSpeed: number; orbitAngle: number
  driftX: number; driftY: number
}

interface Cluster {
  id: string
  x: number; y: number
  baseX: number; baseY: number
  vx: number; vy: number
  radius: number
  color: string
  particles: Particle[]
  hoverScale: number; alpha: number
  label: string; value: string; icon: string
  navigateTo: string
}

interface CoreNode {
  id: 'core'
  x: number; y: number
  vx: number; vy: number
  radius: number
  color: string
  particles: Particle[]
  hoverScale: number; alpha: number
}

interface Connection {
  from: string | number
  to: number
  type: 'radial' | 'pair'
}

interface DetailPanelData {
  id: string
  label: string
  subtitle: string
  icon: string
  color: string
  navigateTo: string
  body: React.ReactNode
}

// ─── Constants ─────────────────────────────────────────────────────
const COLORS: Record<string, string> = {
  brain: '#8b6ff5', memory: '#d4912e', guardrails: '#2ea04a',
  subAgents: '#e75c8a', tools: '#5b8af7',
}

const ANGLES: Record<string, number> = {
  brain: -90, memory: -20, guardrails: 50, subAgents: 130, tools: 200,
}

const METADATA: Record<string, { label: string; icon: string; navigateTo: string }> = {
  brain:      { label: 'Brain',      icon: '🧠', navigateTo: '/admin/model' },
  memory:     { label: 'Memory',     icon: '💾', navigateTo: '/admin/memory' },
  guardrails: { label: 'Guardrails', icon: '🛡️', navigateTo: '/admin/guardrails' },
  subAgents:  { label: 'Sub-Agents', icon: '👥', navigateTo: '/admin/case-types' },
  tools:      { label: 'Tools',      icon: '🔧', navigateTo: '/admin/tools' },
}

function glowRGBA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

// ─── Component ─────────────────────────────────────────────────────
interface AgentGraphProps {
  agentId?: string | null
}

export default function AgentGraph({ agentId }: AgentGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { t } = useConsoleLocale()
  const router = useRouter()

  // Data state
  const [agentModel, setAgentModel] = useState<string | null>(null)
  const [memoryTier, setMemoryTier] = useState<string | null>(null)
  const [bindings, setBindings] = useState<CapabilityBindings | null>(null)
  const [policies, setPolicies] = useState<PolicyItem[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseType[]>([])
  const [kbSources, setKbSources] = useState<KBSource[]>([])

  // Canvas state refs (mutable, no re-render)
  const stateRef = useRef({
    W: 800, H: 600, dpr: 1,
    clusters: [] as Cluster[],
    coreNode: null as CoreNode | null,
    connections: [] as Connection[],
    selectedCluster: null as Cluster | null,
    hoveredCluster: null as Cluster | CoreNode | null,
    mouseX: 0, mouseY: 0,
    cameraX: 0, cameraY: 0,
    cameraTargetX: 0, cameraTargetY: 0,
    frame: 0,
    reducedMotion: false,
    animId: 0,
  })

  const [selectedPanel, setSelectedPanel] = useState<DetailPanelData | null>(null)

  // ── Data fetching ──────────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/admin/agent?agentId=${agentId}`).then(r => r.json()).then(d => d.data || d)
      .then(d => {
        const cfg = d.config || {}
        if (cfg.model) setAgentModel(cfg.model)
        try {
          const ms = typeof cfg.memoryStrategy === 'string' ? JSON.parse(cfg.memoryStrategy || '{}') : (cfg.memoryStrategy || {})
          const tok = ms.autocompactThresholdTokens ?? 0
          if (tok <= 20000) setMemoryTier('short')
          else if (tok <= 40000) setMemoryTier('balanced')
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

  // ── Derived stats ──────────────────────────────────────────────
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
    return {
      sys: relevant.filter(s => s.isSystem).length,
      ch: relevant.filter(s => s.isChannel).length,
      biz: relevant.filter(s => !s.isSystem && !s.isChannel && !s.isSpecial).length,
      kb: kbSources.length,
    }
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

  const guardrailBreakdown = useMemo(() => {
    const result = { preTool: 0, postTool: 0, preFinalize: 0, blocked: 0, escalated: 0 }
    for (const p of policies.filter(p => p.enabled)) {
      if (!p.guardrailConfig) { result.preTool++; continue }
      try {
        const cfg = JSON.parse(p.guardrailConfig)
        const when = cfg.when || 'preTool'
        if (when === 'preTool') result.preTool++
        else if (when === 'postTool') result.postTool++
        else if (when === 'preFinalize') result.preFinalize++
        else result.preTool++
      } catch { result.preTool++ }
    }
    return result
  }, [policies])

  const memoryLabel = useMemo(() => {
    if (!memoryTier) return t('blueprint.notConfigured')
    return t(`blueprint.memoryTier${memoryTier.charAt(0).toUpperCase() + memoryTier.slice(1)}` as any) || memoryTier
  }, [memoryTier, t])

  const clusterValues: Record<string, string> = useMemo(() => ({
    brain: agentModel || t('blueprint.notConfigured'),
    memory: memoryLabel,
    guardrails: guardrailTotal > 0 ? `${guardrailTotal} active rules` : t('blueprint.noPolicies'),
    subAgents: subAgentTotal > 0 ? `${subAgentTotal} agents` : t('blueprint.noSubAgents'),
    tools: (() => {
      const { sys, ch, biz, kb } = toolSummary
      const total = sys + ch + biz + kb
      if (total === 0) return t('blueprint.noTools')
      const parts: string[] = []
      if (sys) parts.push(`${sys} sys`)
      if (ch) parts.push(`${ch} ch`)
      if (biz) parts.push(`${biz} biz`)
      if (kb) parts.push(`${kb} kb`)
      return parts.join(' · ')
    })(),
  }), [agentModel, memoryLabel, guardrailTotal, subAgentTotal, toolSummary, t])

  // ── Canvas helpers ─────────────────────────────────────────────
  const makeParticle = useCallback((orbitR: number): Particle => ({
    x: 0, y: 0, vx: 0, vy: 0,
    r: 0.7 + Math.random() * 2,
    alpha: 0.12 + Math.random() * 0.45,
    orbitRadius: orbitR,
    orbitSpeed: 0.0015 + Math.random() * 0.007,
    orbitAngle: Math.random() * Math.PI * 2,
    driftX: (Math.random() - 0.5) * 0.08,
    driftY: (Math.random() - 0.5) * 0.08,
  }), [])

  const makeCluster = useCallback((id: string, x: number, y: number): Cluster => {
    const count = 16 + Math.floor(Math.random() * 10)
    const particles: Particle[] = []
    for (let i = 0; i < count; i++) particles.push(makeParticle(24 + Math.random() * 36))
    return {
      id, x, y, baseX: x, baseY: y,
      vx: (Math.random() - 0.5) * 0.06,
      vy: (Math.random() - 0.5) * 0.06,
      radius: 38,
      color: COLORS[id],
      particles,
      hoverScale: 1, alpha: 1,
      label: METADATA[id].label,
      value: clusterValues[id] || '',
      icon: METADATA[id].icon,
      navigateTo: METADATA[id].navigateTo,
    }
  }, [makeParticle, clusterValues])

  const makeCore = useCallback((x: number, y: number): CoreNode => {
    const particles: Particle[] = []
    for (let i = 0; i < 12; i++) particles.push(makeParticle(18 + Math.random() * 22))
    return {
      id: 'core', x, y, vx: 0, vy: 0, radius: 32,
      color: '#8b6ff5', particles,
      hoverScale: 1, alpha: 1,
    }
  }, [makeParticle])

  const initLayout = useCallback(() => {
    const s = stateRef.current
    const canvas = canvasRef.current
    if (!canvas) return

    s.dpr = window.devicePixelRatio || 1
    s.W = containerRef.current?.clientWidth || 800
    s.H = containerRef.current?.clientHeight || 600
    canvas.width = s.W * s.dpr
    canvas.height = s.H * s.dpr
    canvas.style.width = s.W + 'px'
    canvas.style.height = s.H + 'px'
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)

    const cx = s.W / 2, cy = s.H / 2
    const maxR = Math.min(cx, cy) * 0.68
    s.clusters = []
    for (const [id, deg] of Object.entries(ANGLES)) {
      const rad = (deg * Math.PI) / 180
      s.clusters.push(makeCluster(id, cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR))
    }
    s.coreNode = makeCore(cx, cy)
    s.connections = []
    for (let i = 0; i < s.clusters.length; i++) {
      s.connections.push({ from: 'core', to: i, type: 'radial' })
    }
    for (let i = 0; i < s.clusters.length; i++) {
      for (let j = i + 1; j < s.clusters.length; j++) {
        s.connections.push({ from: i, to: j, type: 'pair' })
      }
    }
    s.cameraX = 0; s.cameraY = 0
    s.cameraTargetX = 0; s.cameraTargetY = 0
  }, [makeCluster, makeCore])

  // ── Hit test ───────────────────────────────────────────────────
  const hitTest = useCallback((mx: number, my: number): Cluster | CoreNode | null => {
    const s = stateRef.current
    const wx = mx - s.cameraX, wy = my - s.cameraY
    if (s.coreNode) {
      const dx = wx - s.coreNode.x, dy = wy - s.coreNode.y
      if (Math.sqrt(dx * dx + dy * dy) < s.coreNode.radius * 2) return s.coreNode
    }
    let best: Cluster | null = null, bestDist = Infinity
    for (const c of s.clusters) {
      const dx = wx - c.x, dy = wy - c.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < c.radius * 1.8 && dist < bestDist) { best = c; bestDist = dist }
    }
    return best
  }, [])

  // ── Select/deselect ────────────────────────────────────────────
  const selectCluster = useCallback((c: Cluster) => {
    const s = stateRef.current
    s.selectedCluster = c
    s.cameraTargetX = s.W / 2 - c.x
    s.cameraTargetY = s.H / 2 - c.y

    const panel = buildPanel(c)
    setSelectedPanel(panel)
  }, [guardrailTotal, guardrailBreakdown, toolSummary, subAgentTotal, kbSources, agentModel, memoryLabel, t])

  const deselectCluster = useCallback(() => {
    const s = stateRef.current
    s.selectedCluster = null
    s.cameraTargetX = 0; s.cameraTargetY = 0
    setSelectedPanel(null)
  }, [])

  // ── Build panel content ────────────────────────────────────────
  const buildPanel = useCallback((c: Cluster): DetailPanelData => {
    const color = c.color
    const meta = METADATA[c.id]

    let body: React.ReactNode = null

    if (c.id === 'brain') {
      body = (
        <>
          <DetailRow label="Model" value={agentModel || '—'} />
          <DetailRow label="Memory" value={memoryLabel} />
        </>
      )
    } else if (c.id === 'memory') {
      body = (
        <>
          <DetailRow label="Tier" value={memoryLabel} />
        </>
      )
    } else if (c.id === 'guardrails') {
      body = (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
            <StatCard num={guardrailBreakdown.preTool} label="Pre-Tool" color={color} />
            <StatCard num={guardrailBreakdown.postTool} label="Post-Tool" color={color} />
            <StatCard num={guardrailBreakdown.preFinalize} label="Finalize" color={color} />
          </div>
          <div style={{ marginTop: 14 }}>
            <DetailRow label="Escalated" value="—" dotColor="#e75c8a" />
            <DetailRow label="Blocked" value="—" dotColor="#c43" />
          </div>
        </>
      )
    } else if (c.id === 'subAgents') {
      body = (
        <DetailRow label="Total Agents" value={String(subAgentTotal)} />
      )
    } else if (c.id === 'tools') {
      const { sys, ch, biz, kb } = toolSummary
      body = (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
            <StatCard num={sys} label="System" color="#8b6ff5" />
            <StatCard num={ch} label="Channel" color="#5b8af7" />
            <StatCard num={biz} label="Business" color="#d4912e" />
            <StatCard num={kb} label="KB" color="#2ea04a" />
          </div>
          {kbSources.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {kbSources.map(ks => (
                <div key={ks.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginTop: 4, background: 'rgba(0,0,0,0.015)', borderRadius: 8, fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#2ea04a', flexShrink: 0 }} />
                  {ks.name}
                </div>
              ))}
            </div>
          )}
        </>
      )
    }

    return {
      id: c.id,
      label: meta.label,
      subtitle: c.value,
      icon: meta.icon,
      color,
      navigateTo: c.navigateTo,
      body,
    }
  }, [agentModel, memoryLabel, guardrailBreakdown, subAgentTotal, toolSummary, kbSources, t])

  // ── Mouse handlers ─────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const s = stateRef.current
    s.mouseX = e.clientX; s.mouseY = e.clientY
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const hit = hitTest(mx, my)
    s.hoveredCluster = hit
    canvas.style.cursor = hit ? 'pointer' : 'default'
  }, [hitTest])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const hit = hitTest(mx, my)
    if (hit && hit.id !== 'core') selectCluster(hit as Cluster)
    else deselectCluster()
  }, [hitTest, selectCluster, deselectCluster])

  // ── Animation loop ─────────────────────────────────────────────
  useEffect(() => {
    stateRef.current.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    initLayout()

    const s = stateRef.current
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function animate() {
      s.frame++
      ctx!.clearRect(0, 0, s.W, s.H)

      // Camera lerp
      if (!s.reducedMotion) {
        s.cameraX += (s.cameraTargetX - s.cameraX) * 0.055
        s.cameraY += (s.cameraTargetY - s.cameraY) * 0.055
      } else {
        s.cameraX = s.cameraTargetX; s.cameraY = s.cameraTargetY
      }

      ctx!.save()
      ctx!.translate(s.cameraX, s.cameraY)

      drawConnections(ctx!, s)
      for (const c of s.clusters) { updateNode(c, s); drawSatellite(ctx!, c, s) }
      if (s.coreNode) { updateNode(s.coreNode, s); drawCore(ctx!, s.coreNode, s) }

      ctx!.restore()
      s.animId = requestAnimationFrame(animate)
    }

    s.animId = requestAnimationFrame(animate)

    const onResize = () => initLayout()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(s.animId)
      window.removeEventListener('resize', onResize)
    }
  }, [initLayout])

  // ── Update cluster values when data changes ────────────────────
  useEffect(() => {
    const s = stateRef.current
    for (const c of s.clusters) {
      c.value = clusterValues[c.id] || ''
    }
  }, [clusterValues])

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: '100%', minHeight: '500px' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* Detail Panel */}
      {selectedPanel && (
        <div style={panelStyle}>
          <div style={{ height: 3, width: '100%', background: `linear-gradient(90deg, ${selectedPanel.color}, ${glowRGBA(selectedPanel.color, 0.4)})` }} />
          <div style={{ padding: '20px 24px 22px' }}>
            <button onClick={deselectCluster} style={backBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
              {t('blueprint.back') || 'Back'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ ...iconWrapStyle, background: glowRGBA(selectedPanel.color, 0.1), border: `1px solid ${glowRGBA(selectedPanel.color, 0.15)}` }}>
                <span style={{ fontSize: 20 }}>{selectedPanel.icon}</span>
              </div>
              <div>
                <div style={titleStyle}>{selectedPanel.label}</div>
                <div style={subtitleStyle}>{selectedPanel.subtitle}</div>
              </div>
            </div>
            <div style={dividerStyle} />
            {selectedPanel.body}
            <a href={selectedPanel.navigateTo} style={navLinkStyle}>
              <span>{t('blueprint.openSettings') || 'Open Settings'}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────
function DetailRow({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid rgba(0,0,0,0.03)' }}>
      <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', gap: 6 }}>
        {dotColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1714', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function StatCard({ num, label, color }: { num: number; label: string; color: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)', borderRadius: 10, padding: '10px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{num}</div>
      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)', marginTop: 4, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

// ─── Inline styles ─────────────────────────────────────────────────
const panelStyle: React.CSSProperties = {
  position: 'absolute', left: '50%', top: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 20,
  background: 'rgba(255,252,249,0.72)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: 20, minWidth: 320, maxWidth: 380, overflow: 'hidden',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.03), 0 2px 4px rgba(0,0,0,0.02), 0 8px 16px rgba(0,0,0,0.03), 0 24px 48px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 11.5, fontWeight: 500, color: 'rgba(0,0,0,0.35)',
  cursor: 'pointer', border: 'none', background: 'none', padding: 0,
  marginBottom: 14, letterSpacing: '0.01em',
}

const iconWrapStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const titleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: '#1a1714', letterSpacing: '-0.02em', lineHeight: 1.2,
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 3, fontWeight: 400, letterSpacing: '0.01em',
}

const dividerStyle: React.CSSProperties = {
  height: 1, margin: '0 -24px 16px',
  background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.06) 20%, rgba(0,0,0,0.06) 80%, transparent)',
}

const navLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  marginTop: 18, padding: '10px 16px', borderRadius: 12,
  fontSize: 12.5, fontWeight: 600, textDecoration: 'none', textAlign: 'center',
  border: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.6)',
  color: '#1a1714', letterSpacing: '-0.01em',
}

// ─── Canvas drawing functions (pure, no React) ─────────────────────
interface CanvasState {
  W: number; H: number; dpr: number
  clusters: Cluster[]; coreNode: CoreNode | null
  connections: Connection[]
  selectedCluster: Cluster | null
  hoveredCluster: Cluster | CoreNode | null
  mouseX: number; mouseY: number
  cameraX: number; cameraY: number
  cameraTargetX: number; cameraTargetY: number
  frame: number; reducedMotion: boolean; animId: number
}

function updateNode(n: Cluster | CoreNode, s: CanvasState) {
  if (!s.reducedMotion && n.id !== 'core' && !s.selectedCluster) {
    n.x += n.vx; n.y += n.vy
    const dx = n.x - (s.W / 2 - s.cameraX), dy = n.y - (s.H / 2 - s.cameraY)
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > Math.min(s.W, s.H) * 0.38) { n.vx -= dx * 0.00002; n.vy -= dy * 0.00002 }
    n.vx *= 0.9995; n.vy *= 0.9995
  }
  const isHov = s.hoveredCluster === n
  n.hoverScale += ((isHov ? 1.08 : 1) - n.hoverScale) * 0.1
  const tgt = s.selectedCluster && s.selectedCluster !== n ? 0.25 : 1
  n.alpha += (tgt - n.alpha) * 0.07
  if (!s.reducedMotion) {
    for (const p of n.particles) {
      p.orbitAngle += p.orbitSpeed
      const tx = n.x + Math.cos(p.orbitAngle) * p.orbitRadius + p.driftX
      const ty = n.y + Math.sin(p.orbitAngle) * p.orbitRadius + p.driftY
      p.x += (tx - p.x) * 0.035
      p.y += (ty - p.y) * 0.035
    }
  }
}

function drawConnections(ctx: CanvasRenderingContext2D, s: CanvasState) {
  for (const conn of s.connections) {
    const a = conn.from === 'core' ? s.coreNode : s.clusters[conn.from as number]
    const b = s.clusters[conn.to]
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) continue
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const nx = -dy / dist, ny = dx / dist
    const curve = conn.type === 'radial' ? dist * 0.08 : dist * 0.12
    const cpx = mx + nx * curve, cpy = my + ny * curve
    const isActive = s.selectedCluster && (a === s.selectedCluster || b === s.selectedCluster)
    const isCoreConn = conn.type === 'radial'
    const baseAlpha = isActive ? 0.12 : (isCoreConn ? 0.018 : 0.025)
    const pulse = Math.sin(s.frame * 0.012 + (conn.from as number) * 2 + conn.to) * 0.005
    const alpha = (baseAlpha + pulse) * Math.min(a.alpha, b.alpha)
    const color = isCoreConn ? '#b8b0a8' : (a.color || '#8b6ff5')

    ctx.beginPath()
    ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cpx, cpy, b.x, b.y)
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha * 0.2
    ctx.lineWidth = isCoreConn ? 2 : 3
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cpx, cpy, b.x, b.y)
    ctx.strokeStyle = color
    ctx.globalAlpha = alpha
    ctx.lineWidth = isCoreConn ? 0.4 : 0.5
    if (!s.reducedMotion) {
      ctx.setLineDash(isCoreConn ? [3, 6] : [2, 10])
      ctx.lineDashOffset = -s.frame * 0.4
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
}

function drawSatellite(ctx: CanvasRenderingContext2D, c: Cluster, s: CanvasState) {
  const r = c.radius * c.hoverScale
  // Glow
  const grad = ctx.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, r * 2.2)
  grad.addColorStop(0, glowRGBA(c.color, 0.1))
  grad.addColorStop(1, 'transparent')
  ctx.globalAlpha = 0.7 * c.alpha; ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(c.x, c.y, r * 2.2, 0, Math.PI * 2); ctx.fill()
  // Particles
  for (const p of c.particles) {
    ctx.globalAlpha = p.alpha * c.alpha * 0.9; ctx.fillStyle = c.color
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
  }
  // Core disc
  ctx.globalAlpha = 0.08 * c.alpha; ctx.fillStyle = c.color
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 0.2 * c.alpha; ctx.strokeStyle = c.color; ctx.lineWidth = 1.2; ctx.stroke()
  ctx.globalAlpha = 0.06 * c.alpha; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(c.x, c.y, r - 2, 0, Math.PI * 2); ctx.stroke()
  // Icon
  ctx.globalAlpha = c.alpha; ctx.font = `${18 * c.hoverScale}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(c.icon, c.x, c.y - 5)
  // Label
  ctx.font = `600 ${10.5 * c.hoverScale}px -apple-system, sans-serif`
  ctx.fillStyle = c.color; ctx.globalAlpha = 0.75 * c.alpha
  ctx.fillText(c.label, c.x, c.y + 13)
  // Value
  ctx.font = `400 ${9.5 * c.hoverScale}px -apple-system, sans-serif`
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.globalAlpha = 0.6 * c.alpha
  ctx.fillText(c.value, c.x, c.y + 26)
  ctx.globalAlpha = 1
}

function drawCore(ctx: CanvasRenderingContext2D, c: CoreNode, s: CanvasState) {
  const r = c.radius * c.hoverScale
  const pulse = 1 + Math.sin(s.frame * 0.02) * 0.08
  const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 2.5 * pulse)
  grad.addColorStop(0, glowRGBA('#8b6ff5', 0.08))
  grad.addColorStop(0.5, glowRGBA('#5b8af7', 0.03))
  grad.addColorStop(1, 'transparent')
  ctx.globalAlpha = 0.8; ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(c.x, c.y, r * 2.5 * pulse, 0, Math.PI * 2); ctx.fill()
  // Particles
  for (const p of c.particles) {
    ctx.globalAlpha = p.alpha * 0.7; ctx.fillStyle = '#8b6ff5'
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2); ctx.fill()
  }
  // Core disc
  const coreGrad = ctx.createRadialGradient(c.x - 4, c.y - 4, 0, c.x, c.y, r)
  coreGrad.addColorStop(0, glowRGBA('#8b6ff5', 0.18))
  coreGrad.addColorStop(1, glowRGBA('#5b8af7', 0.06))
  ctx.globalAlpha = 1; ctx.fillStyle = coreGrad
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 0.3; ctx.strokeStyle = '#8b6ff5'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.globalAlpha = 0.12; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(c.x, c.y, r - 2, 0, Math.PI * 2); ctx.stroke()
  // Lightning icon
  ctx.globalAlpha = 0.85; ctx.font = `bold ${20 * c.hoverScale}px -apple-system, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#8b6ff5'
  ctx.fillText('⚡', c.x, c.y - 2)
  // Label
  ctx.font = `700 ${9 * c.hoverScale}px -apple-system, sans-serif`
  ctx.fillStyle = '#8b6ff5'; ctx.globalAlpha = 0.6
  ctx.fillText('CORE', c.x, c.y + 16)
  ctx.globalAlpha = 1
}
