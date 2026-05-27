'use client'

import { useState, useEffect } from 'react'
import { BarChart3, MessageSquare, Briefcase, Clock, Shield, Activity, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'

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
  messages24h: { en: 'Messages (24h)', zh: '24h 消息量' },
  activeCases: { en: 'Active Cases', zh: '活跃案例' },
  avgResolution: { en: 'Avg Resolution', zh: '平均解决时间' },
  guardrailHits: { en: 'Guardrail Hits (24h)', zh: '护栏命中 (24h)' },
  channelHealth: { en: 'Channel Health', zh: '渠道健康度' },
  recentCases: { en: 'Recent Cases', zh: '最近案例' },
  noData: { en: 'No data yet', zh: '暂无数据' },
  min: { en: 'min', zh: '分钟' },
  healthy: { en: 'Healthy', zh: '正常' },
  token_expired: { en: 'Token expired', zh: '令牌过期' },
  unreachable: { en: 'Unreachable', zh: '不可达' },
  rate_limited: { en: 'Rate limited', zh: '限流中' },
  loading: { en: 'Loading...', zh: '加载中...' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

const statusColors: Record<string, string> = {
  healthy: 'bg-malachite',
  token_expired: 'bg-vermillion',
  unreachable: 'bg-vermillion',
  rate_limited: 'bg-amber',
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
    fetch('/api/ops/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('loading')}</div>
  if (!data) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('noData')}</div>

  const { overview, guardrailHits, channelHealth, recentCases } = data

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.1)' }}>
          <BarChart3 className="w-4 h-4" style={{ color: '#14b8a6' }} />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{l('title')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo/[0.08]"><MessageSquare className="w-4 h-4 text-indigo" /></div>
            <span className="text-[11px] font-semibold text-[var(--fog)]">{l('messages24h')}</span>
          </div>
          <p className="text-[28px] font-bold text-[var(--mist)] tracking-[-0.02em]">{overview.messages24h.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber/[0.08]"><Briefcase className="w-4 h-4 text-amber" /></div>
            <span className="text-[11px] font-semibold text-[var(--fog)]">{l('activeCases')}</span>
          </div>
          <p className="text-[28px] font-bold text-[var(--mist)] tracking-[-0.02em]">{overview.activeCases}</p>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-malachite/[0.08]"><Clock className="w-4 h-4 text-malachite" /></div>
            <span className="text-[11px] font-semibold text-[var(--fog)]">{l('avgResolution')}</span>
          </div>
          <p className="text-[28px] font-bold text-[var(--mist)] tracking-[-0.02em]">
            {overview.avgResolutionMin != null ? `${overview.avgResolutionMin} ${l('min')}` : '—'}
          </p>
        </div>
      </div>

      {/* Guardrail hits + Channel health */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-[var(--fog)]" />
            <h2 className="text-[13px] font-semibold text-[var(--mist)]">{l('guardrailHits')}</h2>
          </div>
          {guardrailHits.length === 0 ? (
            <p className="text-[12px] text-[var(--fog)] py-4 text-center">{l('noData')}</p>
          ) : (
            <div className="space-y-2">
              {guardrailHits.map(h => (
                <div key={h.name} className="flex items-center justify-between p-2.5 rounded-lg border border-black/[0.04] bg-white">
                  <span className="text-[12px] text-[var(--mist)] truncate">{h.name}</span>
                  <span className="text-[11px] font-semibold text-[var(--fog)] flex-shrink-0 ml-3">{h.hits} hits</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/admin/guardrails" className="flex items-center gap-1 text-[11px] text-indigo hover:text-indigo/80 mt-3">
            Guardrails <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[var(--fog)]" />
            <h2 className="text-[13px] font-semibold text-[var(--mist)]">{l('channelHealth')}</h2>
          </div>
          {channelHealth.length === 0 ? (
            <p className="text-[12px] text-[var(--fog)] py-4 text-center">{l('noData')}</p>
          ) : (
            <div className="space-y-2">
              {channelHealth.map(ch => (
                <div key={ch.channel} className="flex items-center justify-between p-2.5 rounded-lg border border-black/[0.04] bg-white">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColors[ch.status] ?? 'bg-[var(--fog)]/30'}`} />
                    <span className="text-[12px] text-[var(--mist)]">{ch.channel}</span>
                  </div>
                  <span className="text-[10px] text-[var(--fog)]">{l(ch.status as keyof typeof L)}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/admin/channels" className="flex items-center gap-1 text-[11px] text-indigo hover:text-indigo/80 mt-3">
            Channels <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Recent cases */}
      <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Briefcase className="w-4 h-4 text-[var(--fog)]" />
          <h2 className="text-[13px] font-semibold text-[var(--mist)]">{l('recentCases')}</h2>
        </div>
        {recentCases.length === 0 ? (
          <p className="text-[12px] text-[var(--fog)] py-4 text-center">{l('noData')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--fog)] border-b border-black/[0.05]">
                  <th className="pb-2 font-medium">Case ID</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentCases.map(c => (
                  <tr key={c.id} className="border-b border-black/[0.02] hover:bg-black/[0.01]">
                    <td className="py-2 font-mono text-[11px] text-[var(--mist)]">{c.id.slice(-12)}</td>
                    <td className="py-2 text-[var(--fog)]">{c.type || '—'}</td>
                    <td className="py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.status === 'resolved' ? 'bg-malachite/[0.08] text-malachite' : 'bg-amber/[0.08] text-amber'}`}>{c.status}</span>
                    </td>
                    <td className="py-2 text-[var(--fog)]">{timeAgo(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
