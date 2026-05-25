'use client'

import { useState } from 'react'
import {
  Search, Upload, FileText, Globe, RefreshCw, ChevronRight,
  CheckCircle2, Clock, AlertCircle, Lock, Database, Zap, Layers,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

// ── Planned feature cards ────────────────────────────────────────────────────

interface FeatureCard {
  icon: React.ReactNode
  title: string
  descKey: string
  status: 'pending' | 'partial'
  color: string
}

const FEATURES: FeatureCard[] = [
  {
    icon: <Upload className="w-5 h-5" />,
    title: 'kb.feat.uploadTitle',
    descKey: 'kb.feat.uploadDesc',
    status: 'pending',
    color: '#14b8a6',
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: 'kb.feat.urlTitle',
    descKey: 'kb.feat.urlDesc',
    status: 'pending',
    color: '#5b8af7',
  },
  {
    icon: <Layers className="w-5 h-5" />,
    title: 'kb.feat.contextualTitle',
    descKey: 'kb.feat.contextualDesc',
    status: 'pending',
    color: '#8b6ff5',
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: 'kb.feat.rerankTitle',
    descKey: 'kb.feat.rerankDesc',
    status: 'pending',
    color: '#d4912e',
  },
  {
    icon: <Search className="w-5 h-5" />,
    title: 'kb.feat.testTitle',
    descKey: 'kb.feat.testDesc',
    status: 'pending',
    color: '#2ea04a',
  },
  {
    icon: <Database className="w-5 h-5" />,
    title: 'kb.feat.vectorTitle',
    descKey: 'kb.feat.vectorDesc',
    status: 'partial',
    color: '#e64539',
  },
]

// ── Page ────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { t } = useConsoleLocale()
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto bg-transparent">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-8 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.15), rgba(20,184,166,0.05))', color: '#14b8a6' }}>
                <Search className="w-4 h-4" />
              </div>
              <h1 className="text-[22px] font-bold tracking-[-0.025em] text-[var(--mist)]">
                {t('kb.pageTitle')}
              </h1>
            </div>
            <p className="text-[13px] text-[var(--fog)] max-w-2xl leading-relaxed">
              {t('kb.pageDesc')}
            </p>
          </div>

          {/* Coming soon badge */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full border border-teal-500/20 bg-teal-500/[0.06]">
            <Clock className="w-3.5 h-3.5 text-teal-500" />
            <span className="text-[11px] font-medium text-teal-600">{t('kb.comingSoon')}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 pb-8 space-y-6">

        {/* Config shortcut banner */}
        <div className="flex items-center gap-4 rounded-2xl border border-teal-500/15 bg-gradient-to-r from-teal-500/[0.06] to-transparent px-5 py-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.15), rgba(20,184,166,0.05))', color: '#14b8a6' }}>
            <Lock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[var(--mist)]">{t('kb.configBannerTitle')}</p>
            <p className="text-[11px] text-[var(--fog)] mt-0.5">{t('kb.configBannerDesc')}</p>
          </div>
          <a
            href="/admin/agent"
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl border border-teal-500/25 bg-teal-500/[0.08] text-[12px] font-semibold text-teal-600 hover:bg-teal-500/[0.14] transition-colors"
          >
            {t('kb.configBannerCta')} <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Search placeholder */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--fog)]/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('kb.searchPlaceholder')}
            disabled
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-black/[0.06] bg-white/60 text-[13px] text-[var(--fog)] placeholder:text-[var(--fog)]/40 cursor-not-allowed opacity-60 backdrop-blur-sm"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--fog)]/40 font-medium">
            {t('kb.comingSoon')}
          </div>
        </div>

        {/* Upload drop-zone placeholder */}
        <div className="rounded-2xl border-2 border-dashed border-teal-500/20 bg-teal-500/[0.02] px-8 py-12 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.12), rgba(20,184,166,0.04))', color: '#14b8a6' }}>
            <Upload className="w-6 h-6" />
          </div>
          <p className="text-[14px] font-semibold text-[var(--mist)] mb-1">{t('kb.uploadTitle')}</p>
          <p className="text-[12px] text-[var(--fog)] mb-3 max-w-md mx-auto">{t('kb.uploadDesc')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {['Markdown', 'PDF', 'DOCX', 'URL'].map((fmt) => (
              <span key={fmt} className="px-2.5 py-1 rounded-lg border border-black/[0.06] bg-white/60 text-[11px] font-mono text-[var(--fog)]">
                {fmt}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-[var(--fog)]/50">{t('kb.uploadNotReady')}</p>
        </div>

        {/* Feature grid */}
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--fog)] mb-3 px-1">{t('kb.featuresTitle')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="relative rounded-xl border border-black/[0.05] bg-white/60 backdrop-blur-sm px-4 py-4 flex gap-3"
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: `${f.color}14`, color: f.color }}
                >
                  {f.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-semibold text-[var(--mist)] leading-tight">{t(f.title)}</p>
                    {f.status === 'partial' ? (
                      <span className="flex-shrink-0 flex items-center gap-1 text-[9px] font-medium text-amber px-1.5 py-0.5 rounded-full border border-amber/20 bg-amber/[0.08]">
                        <RefreshCw className="w-2.5 h-2.5" /> {t('kb.partial')}
                      </span>
                    ) : (
                      <span className="flex-shrink-0 flex items-center gap-1 text-[9px] font-medium text-[var(--fog)] px-1.5 py-0.5 rounded-full border border-black/[0.06] bg-black/[0.02]">
                        <Clock className="w-2.5 h-2.5" /> {t('kb.planned')}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--fog)] mt-1 leading-relaxed">{t(f.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Implementation path info */}
        <div className="rounded-2xl border border-black/[0.05] bg-white/40 backdrop-blur-sm px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-[var(--fog)]" />
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('kb.implPathTitle')}</h3>
          </div>
          <div className="space-y-3">
            {[
              { step: 'A', titleKey: 'kb.path.aTitle', descKey: 'kb.path.aDesc', ready: true },
              { step: 'B', titleKey: 'kb.path.bTitle', descKey: 'kb.path.bDesc', ready: false },
              { step: 'C', titleKey: 'kb.path.cTitle', descKey: 'kb.path.cDesc', ready: false },
            ].map((p) => (
              <div key={p.step} className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5 ${
                  p.ready
                    ? 'bg-teal-500/15 text-teal-600 ring-1 ring-teal-500/25'
                    : 'bg-black/[0.04] text-[var(--fog)]'
                }`}>
                  {p.ready ? <CheckCircle2 className="w-3.5 h-3.5" /> : p.step}
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[var(--mist)]">{t(p.titleKey)}</p>
                  <p className="text-[11px] text-[var(--fog)] mt-0.5 leading-relaxed">{t(p.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Requirements notice */}
        <div className="flex gap-3 rounded-xl border border-amber/20 bg-amber/[0.04] px-4 py-3.5">
          <AlertCircle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-[var(--mist)]">{t('kb.requiresTitle')}</p>
            <ul className="text-[11px] text-[var(--fog)] space-y-0.5 list-disc list-inside">
              <li>{t('kb.req.embedding')}</li>
              <li>{t('kb.req.pgvector')}</li>
              <li>{t('kb.req.rerankOptional')}</li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  )
}
