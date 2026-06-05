'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Briefcase, Clock, Shield, ArrowRight, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import RingProgress from '@/components/ui/ring-progress'
import DotMatrixNumber from '@/components/ui/dot-matrix-number'
import AnimatedCounter from '@/components/ui/animated-counter'

interface DashboardData {
  overview: {
    messages24h: number
    activeCases: number
    avgResolutionMin: number | null
  }
  guardrailHits: Array<{ name: string; hits: number }>
  channelHealth: Array<{ channel: string; status: string; lastChecked: string; lastError: string | null }>
  recentCases: Array<{ id: string; type: string; status: string; createdAt: string }>
}

const L = {
  title: { en: 'Dashboard', zh: '运营仪表盘' },
  subtitle: { en: 'System overview and health monitoring', zh: '系统概览与健康监控' },
  messages24h: { en: 'Messages 24h', zh: '24H 消息' },
  activeCases: { en: 'Active Cases', zh: '活跃案例' },
  avgResolution: { en: 'Avg Resolution', zh: '平均响应' },
  guardrailHits: { en: 'Guardrail Hits', zh: '护栏命中' },
  guardrailHits24h: { en: 'Guardrail Hits (24h)', zh: '护栏命中 (24h)' },
  channelHealth: { en: 'Channel Health', zh: '渠道健康' },
  recentCases: { en: 'Recent Cases', zh: '最近案例' },
  noData: { en: 'No data yet', zh: '暂无数据' },
  min: { en: 'min', zh: '分钟' },
  healthy: { en: 'Healthy', zh: '正常' },
  token_expired: { en: 'Token expired', zh: '令牌过期' },
  unreachable: { en: 'Unreachable', zh: '不可达' },
  rate_limited: { en: 'Rate limited', zh: '限流中' },
  loading: { en: 'Loading…', zh: '加载中…' },
  noGuardrails: { en: 'No guardrail activity yet.', zh: '暂无护栏活动' },
  viewAll: { en: 'View all', zh: '查看全部' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

const statusColors: Record<string, string> = {
  healthy: 'bg-emerald-400', token_expired: 'bg-red-400', unreachable: 'bg-red-400', rate_limited: 'bg-amber-400',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const l = useL()

  useEffect(() => {
    apiClient<DashboardData>('/api/ops/dashboard')
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('loading')}</div>
  if (!data) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('noData')}</div>

  const { overview, guardrailHits, channelHealth, recentCases } = data
  const totalGuardrail = guardrailHits.reduce((s, g) => s + g.hits, 0)

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{l('title')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      {/* ── Top metrics: 4-column ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 24H Messages */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#6366f1]/10 icon-pulse">
              <MessageSquare className="w-4 h-4 text-[#6366f1]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('messages24h')}</span>
          </div>
          <AnimatedCounter target={overview.messages24h} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
        </div>

        {/* Active Cases */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#f59e0b]/10 icon-pulse">
              <Briefcase className="w-4 h-4 text-[#f59e0b]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('activeCases')}</span>
          </div>
          <AnimatedCounter target={overview.activeCases} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
        </div>

        {/* Avg Resolution — Ring */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#14b8a6]/10 icon-pulse">
              <Clock className="w-4 h-4 text-[#14b8a6]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('avgResolution')}</span>
          </div>
          <div className="flex justify-center">
            <RingProgress
              value={overview.avgResolutionMin != null ? Math.min(100, Math.max(0, 100 - overview.avgResolutionMin)) : 0}
              size={110}
              strokeWidth={6}
              color="var(--malachite)"
              label={`${overview.avgResolutionMin ?? '—'} ${l('min')}`}
            />
          </div>
        </div>

        {/* Guardrail Hits */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#8b6ff5]/10 icon-pulse">
              <Shield className="w-4 h-4 text-[#8b6ff5]" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--fog)] uppercase tracking-[0.04em]">{l('guardrailHits')}</span>
          </div>
          <AnimatedCounter target={totalGuardrail} duration={1400}>
            {(v) => (
              <div className="dot-enter">
                <DotMatrixNumber value={v} dotSize={1.8} gap={4} color="var(--mist)" />
              </div>
            )}
          </AnimatedCounter>
          {guardrailHits.length > 0 && (
            <div className="mt-3 space-y-1">
              {guardrailHits.slice(0, 3).map((g) => (
                <div key={g.name} className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--fog)] truncate max-w-[120px]">{g.name}</span>
                  <span className="text-[10px] font-mono text-[var(--fog)]/60">{g.hits}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Cases */}
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-bold text-[var(--mist)]">{l('recentCases')}</h2>
            <Link href="/ops/chats" className="flex items-center gap-1 text-[11px] text-indigo/60 hover:text-indigo transition-colors">
              {l('viewAll')} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentCases.length === 0 ? (
            <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noData')}</p>
          ) : (
            <div className="space-y-2">
              {recentCases.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-black/[0.03] last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === 'resolved' ? 'bg-emerald-400' : c.status === 'escalated' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="text-[12px] text-[var(--mist)] flex-1 min-w-0 truncate">{c.type.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-[var(--fog)]/50 flex-shrink-0">{timeAgo(c.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channel Health + Guardrail Hits */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
            <h2 className="text-[13px] font-bold text-[var(--mist)] mb-4">{l('channelHealth')}</h2>
            {channelHealth.length === 0 ? (
              <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noData')}</p>
            ) : (
              <div className="space-y-2">
                {channelHealth.map((ch) => (
                  <div key={ch.channel} className="flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[ch.status] || 'bg-black/10'}`} />
                    <span className="text-[12px] text-[var(--mist)] flex-1 capitalize">{ch.channel}</span>
                    <span className="text-[11px] text-[var(--fog)]">{l(ch.status as keyof typeof L)}</span>
                    <span className="text-[10px] text-[var(--fog)]/40">{timeAgo(ch.lastChecked)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 transition-all duration-250 hover:-translate-y-0.5">
            <h2 className="text-[13px] font-bold text-[var(--mist)] mb-4">{l('guardrailHits24h')}</h2>
            {guardrailHits.length === 0 ? (
              <p className="text-[12px] text-[var(--fog)]/40 italic">{l('noGuardrails')}</p>
            ) : (
              <div className="space-y-2">
                {guardrailHits.map((g) => (
                  <div key={g.name} className="flex items-center justify-between">
                    <span className="text-[12px] text-[var(--mist)]">{g.name}</span>
                    <span className="text-[11px] font-mono text-[var(--fog)]">{g.hits.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
