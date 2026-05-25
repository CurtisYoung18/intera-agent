'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Brain, Cpu, Database, Shield, MessageSquareText, Search, Zap } from 'lucide-react'
import type { AgentConfigData } from '@/app/admin/agent/types'
import { useConsoleLocale } from '@/components/locale-provider'

type Section = 'prompt' | 'model' | 'memory' | 'policy' | 'templates' | 'knowledge'

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
  const { t } = useConsoleLocale()

  const ms = config.memoryStrategy

  const hookCount = useMemo(() => {
    try {
      return Object.keys(JSON.parse(config.policyHooks || '{}')).length
    } catch {
      return 0
    }
  }, [config.policyHooks])

  const satellites = useMemo(
    () =>
      [
        {
          id: 'prompt' as const,
          icon: <Brain className="w-5 h-5" />,
          label: t('blueprint.nodePrompt'),
          preview:
            (config.systemPrompt?.slice(0, 120).replace(/\n/g, ' ') + '…') || t('blueprint.notConfigured'),
          color: '#8b6ff5',
          glow: 'rgba(139,111,245,0.15)',
          angle: -90,
          distance: 0.65,
        },
        {
          id: 'model' as const,
          icon: <Cpu className="w-5 h-5" />,
          label: t('blueprint.nodeModel'),
          preview: `${config.model} ${t('common.or')} T=${config.temperature}`,
          color: '#5b8af7',
          glow: 'rgba(91,138,247,0.15)',
          angle: -30,
          distance: 0.65,
        },
        {
          id: 'memory' as const,
          icon: <Database className="w-5 h-5" />,
          label: t('blueprint.nodeMemory'),
          preview: t('blueprint.compactTokens', {
            n: ms.autocompactThresholdTokens.toLocaleString(),
          }),
          color: '#d4912e',
          glow: 'rgba(212,145,46,0.15)',
          angle: 30,
          distance: 0.65,
        },
        {
          id: 'policy' as const,
          icon: <Shield className="w-5 h-5" />,
          label: t('blueprint.nodePolicy'),
          preview: t('blueprint.hooksCount', { n: hookCount }),
          color: '#2ea04a',
          glow: 'rgba(46,160,74,0.15)',
          angle: 90,
          distance: 0.65,
        },
        {
          id: 'templates' as const,
          icon: <MessageSquareText className="w-5 h-5" />,
          label: t('blueprint.nodeHumanOps'),
          preview: config.consultationPrompt ? t('blueprint.humanOpsReady') : t('blueprint.notConfigured'),
          color: '#5bb8f7',
          glow: 'rgba(91,184,247,0.15)',
          angle: 150,
          distance: 0.65,
        },
        {
          id: 'knowledge' as const,
          icon: <Search className="w-5 h-5" />,
          label: t('blueprint.nodeKnowledge'),
          preview: (() => {
            const kb = config.knowledgeRetrieval
            if (!kb || kb.mode === 'disabled') return t('blueprint.knowledgeDisabled')
            if (kb.mode === 'external-api') return t('blueprint.knowledgeExternal', { k: kb.topK })
            return t('blueprint.knowledgeNative', { provider: kb.embeddingProvider, k: kb.topK })
          })(),
          color: '#14b8a6',
          glow: 'rgba(20,184,166,0.15)',
          angle: 210,
          distance: 0.65,
        },
      ] as const,
    [
      t,
      config.systemPrompt,
      config.model,
      config.temperature,
      config.resumePrompt,
      config.knowledgeRetrieval,
      ms.autocompactThresholdTokens,
      hookCount,
    ],
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

        {/* Soft halo — no stroke (avoids dark ring) */}
        <div
          className="absolute w-[140px] h-[140px] rounded-full pointer-events-none opacity-[0.38]"
          style={{
            background: 'radial-gradient(circle, rgba(139,111,245,0.07) 0%, transparent 72%)',
            transform: 'translate(-50%, -50%)',
            left: '50%',
            top: '50%',
          }}
        />

        {/* Core orb — scale + glow (shadow lives in keyframes, not inline) */}
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

        {/* Status label below core */}
        <div className="mt-3 flex items-center gap-1.5 pointer-events-auto">
          <div className={`w-1.5 h-1.5 rounded-full ${
            syncStatus === 'synced' ? 'bg-malachite' : syncStatus === 'syncing' ? 'bg-amber animate-breathe' : 'bg-lavender/40'
          }`} />
          <span className="text-[11px] text-[var(--fog)] font-medium">
            {syncStatus === 'synced'
              ? t('blueprint.synced')
              : syncStatus === 'syncing'
                ? t('blueprint.saving')
                : config.model.split('-')[0]}
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
