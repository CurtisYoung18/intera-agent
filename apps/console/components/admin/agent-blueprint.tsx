'use client'

import { useState, useEffect, useRef } from 'react'
import { Brain, Cpu, Database, Shield, FileText, Settings, Zap } from 'lucide-react'
import type { AgentConfigData, MemoryStrategy } from '@/app/admin/agent/types'

type Section = 'prompt' | 'model' | 'memory' | 'policy' | 'templates' | 'advanced'

interface BlueprintProps {
  config: AgentConfigData
  activeSection: Section | null
  onSelectSection: (s: Section | null) => void
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error'
}

const CORE_RADIUS = 52 // px, edge of core orb for line endpoints — clears rings
const NODE_OFFSET = 60  // px, offset from node center for line target

export default function AgentBlueprint({ config, activeSection, onSelectSection, syncStatus }: BlueprintProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 })

  // ResizeObserver — catches both window resize AND flex-layout changes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ms = config.memoryStrategy

  const satellites: { id: Section; icon: React.ReactNode; label: string; preview: string; color: string; glow: string; angle: number; distance: number }[] = [
    { id: 'prompt', icon: <Brain className="w-5 h-5" />, label: 'System Prompt', preview: (config.systemPrompt?.slice(0, 120).replace(/\n/g, ' ') + '…') || 'Not configured', color: '#8b6ff5', glow: 'rgba(139,111,245,0.15)', angle: -90, distance: 0.65 },
    { id: 'model', icon: <Cpu className="w-5 h-5" />, label: 'Model', preview: `${config.model} · T=${config.temperature}`, color: '#5b8af7', glow: 'rgba(91,138,247,0.15)', angle: -30, distance: 0.65 },
    { id: 'memory', icon: <Database className="w-5 h-5" />, label: 'Memory', preview: `Compact: ${ms.autocompactThresholdTokens.toLocaleString()} tokens`, color: '#d4912e', glow: 'rgba(212,145,46,0.15)', angle: 30, distance: 0.65 },
    { id: 'policy', icon: <Shield className="w-5 h-5" />, label: 'Policy Hooks', preview: `${(() => { try { return Object.keys(JSON.parse(config.policyHooks || '{}')).length } catch { return 0 } })()} hooks`, color: '#2ea04a', glow: 'rgba(46,160,74,0.15)', angle: 90, distance: 0.65 },
    { id: 'templates', icon: <FileText className="w-5 h-5" />, label: 'Templates', preview: config.resumePrompt ? 'Resume + Form ready' : 'Not configured', color: '#5bb8f7', glow: 'rgba(91,184,247,0.15)', angle: 150, distance: 0.65 },
    { id: 'advanced', icon: <Settings className="w-5 h-5" />, label: 'Advanced', preview: `Fact extraction · Token est. · CB: ${ms.compactCircuitBreakerMaxFailures} failures`, color: '#b8944c', glow: 'rgba(184,148,76,0.15)', angle: 210, distance: 0.65 },
  ]

  const cx = dimensions.w / 2
  const cy = dimensions.h / 2
  const maxRadius = Math.min(cx, cy) * 0.85

  const getNodePos = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180
    const r = maxRadius * dist
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
  }

  // Calculate line endpoints (stop at core/nodes edges, not centers)
  const connectionLines = satellites.map(s => {
    const nodePos = getNodePos(s.angle, s.distance)
    const rad = (s.angle * Math.PI) / 180
    // Start from edge of core
    const fromX = cx + Math.cos(rad) * CORE_RADIUS
    const fromY = cy + Math.sin(rad) * CORE_RADIUS
    // End at edge of node (approximate)
    const toX = nodePos.x - Math.cos(rad) * NODE_OFFSET
    const toY = nodePos.y - Math.sin(rad) * NODE_OFFSET
    return { x1: fromX, y1: fromY, x2: toX, y2: toY, id: s.id, color: s.color }
  })

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
            {/* Background glow line */}
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeOpacity={0.1} strokeWidth={4} strokeLinecap="round" />
            {/* Main line */}
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={`url(#grad-${line.id})`} strokeWidth={activeSection === line.id ? 2 : 1} strokeLinecap="round" />
            {/* Animated dash — particle trail effect */}
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color}
              strokeOpacity={activeSection === line.id ? 0.6 : 0.25}
              strokeWidth={activeSection === line.id ? 2 : 1.5}
              strokeDasharray="4 12"
              strokeLinecap="round"
              style={{ animationDuration: activeSection === line.id ? '1.2s' : '2.5s' }}
              className="animate-particle-flow" />
            {/* Endpoint dot at node side */}
            <circle cx={line.x2} cy={line.y2} r={activeSection === line.id ? 3 : 2}
              fill={line.color} opacity={activeSection === line.id ? 0.8 : 0.3}
              className={activeSection === line.id ? 'animate-breathe' : ''} />
          </g>
        ))}
      </svg>

      {/* Agent Core — center */}
      <div className="absolute left-1/2 top-1/2 z-10 flex flex-col items-center pointer-events-none"
        style={{ transform: 'translate(-50%, -50%)' }}>

        {/* Outer atmosphere — subtle breathing circle */}
        <div className="absolute w-[140px] h-[140px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(139,111,245,0.06) 0%, transparent 70%)',
            transform: 'translate(-50%, -50%)',
            left: '50%', top: '50%',
            animation: 'breathe 4s ease-in-out infinite',
          }} />

        {/* Fine ring — well outside the core */}
        <div className="absolute w-[115px] h-[115px] rounded-full pointer-events-none"
          style={{
            border: '1px solid rgba(139,111,245,0.1)',
            transform: 'translate(-50%, -50%)',
            left: '50%', top: '50%',
            animation: 'pingRing 4s ease-out infinite',
          }} />

        {/* Core orb — the clickable/visual center */}
        <div className="relative w-[72px] h-[72px] rounded-2xl flex flex-col items-center justify-center pointer-events-auto"
          style={{
            background: 'linear-gradient(135deg, rgba(139,111,245,0.15), rgba(91,138,247,0.06))',
            border: '1px solid rgba(139,111,245,0.25)',
            boxShadow: '0 0 48px rgba(139,111,245,0.08), 0 2px 8px rgba(0,0,0,0.04)',
          }}>
          <Zap className="w-[22px] h-[22px] text-lavender mb-0.5" />
          <span className="text-[11px] font-bold text-lavender/70 tracking-[0.1em] uppercase">Core</span>
        </div>

        {/* Status label below core */}
        <div className="mt-3 flex items-center gap-1.5 pointer-events-auto">
          <div className={`w-1.5 h-1.5 rounded-full ${
            syncStatus === 'synced' ? 'bg-malachite' : syncStatus === 'syncing' ? 'bg-amber animate-breathe' : 'bg-lavender/40'
          }`} />
          <span className="text-[11px] text-[var(--fog)] font-medium">
            {syncStatus === 'synced' ? 'Synced' : syncStatus === 'syncing' ? 'Saving…' : config.model.split('-')[0]}
          </span>
        </div>
      </div>

      {/* Satellite nodes */}
      {satellites.map(s => {
        const pos = getNodePos(s.angle, s.distance)
        const isActive = activeSection === s.id

        return (
          <button
            key={s.id}
            onClick={() => onSelectSection(isActive ? null : s.id)}
            className="absolute z-10 flex items-center gap-3 px-6 py-4 rounded-xl transition-all duration-300 ease-out
              bg-white/80 backdrop-blur-xl border cursor-pointer text-left
              hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
            style={{
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, -50%)${isActive ? ' scale(1.04)' : ''}`,
              borderColor: isActive ? s.color : 'rgba(0,0,0,0.05)',
              boxShadow: isActive ? `0 0 28px ${s.glow}, 0 4px 20px rgba(0,0,0,0.06)` : '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200"
              style={{ background: `linear-gradient(135deg, ${s.glow}, transparent)`, color: s.color }}>
              {s.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--mist)]">{s.label}</div>
              <div className="text-[11px] text-[var(--fog)] truncate max-w-[320px] mt-0.5">{s.preview}</div>
            </div>
            {/* Active indicator dot */}
            <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all duration-300"
              style={{ background: s.color, opacity: isActive ? 1 : 0.2, transform: isActive ? 'scale(1.3)' : 'scale(1)' }} />
          </button>
        )
      })}
    </div>
  )
}
