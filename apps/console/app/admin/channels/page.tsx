'use client'

import { Plug, MessageCircle, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'

interface ChannelInfo {
  id: string
  label: string
  description: string
  icon: typeof Plug
  href: string
  active: boolean
  comingSoon: boolean
}

const CHANNELS: ChannelInfo[] = [
  {
    id: 'livechat', label: 'LiveChat',
    description: 'Connection · Routing · Rendering · Human Ops',
    icon: MessageCircle, href: '/admin/channels/livechat',
    active: true, comingSoon: false,
  },
  {
    id: 'web-chat', label: 'Web Chat',
    description: 'Embedded chat widget for your website',
    icon: MessageCircle, href: '/admin/channels/web-chat',
    active: false, comingSoon: true,
  },
  {
    id: 'slack', label: 'Slack',
    description: 'Connect Intera to your Slack workspace',
    icon: Plug, href: '/admin/channels/slack',
    active: false, comingSoon: true,
  },
  {
    id: 'discord', label: 'Discord',
    description: 'Connect Intera to your Discord server',
    icon: Plug, href: '/admin/channels/discord',
    active: false, comingSoon: true,
  },
]

export default function ChannelsPage() {
  const { t } = useConsoleLocale()

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
          <Plug className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">Channels</h1>
          <p className="text-[12px] text-[var(--fog)]">Manage customer entry points. Click a channel to configure connection, routing, rendering, and human escalation.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHANNELS.map((ch) => {
          const Icon = ch.icon
          return (
            <Link
              key={ch.id}
              href={ch.href}
              className={`relative text-left rounded-2xl p-6 transition-all duration-200 group ${
                ch.comingSoon
                  ? 'bg-white/30 border border-black/[0.03] opacity-50 cursor-not-allowed pointer-events-none'
                  : ch.active
                    ? 'bg-white/80 backdrop-blur-xl border border-black/[0.06] hover:border-indigo/20 hover:shadow-sm hover:-translate-y-0.5'
                    : 'bg-white/60 backdrop-blur-xl border border-black/[0.05] hover:border-black/[0.1]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    ch.active ? 'bg-indigo/[0.08]' : 'bg-black/[0.03]'
                  }`}>
                    <Icon className={`w-5 h-5 ${ch.active ? 'text-indigo' : 'text-[var(--fog)]'}`} />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[var(--mist)]">{ch.label}</p>
                    <p className="text-[11px] text-[var(--fog)] mt-0.5">{ch.description}</p>
                  </div>
                </div>
                {ch.active && (
                  <ArrowRight className="w-4 h-4 text-[var(--fog)]/30 group-hover:text-indigo group-hover:translate-x-0.5 transition-all" />
                )}
              </div>

              <div className="mt-3">
                {ch.active ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-malachite/10 text-malachite border border-malachite/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-malachite" />Active
                  </span>
                ) : ch.comingSoon ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/[0.04] text-[var(--fog)] border border-black/[0.06]">
                    Coming soon
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber/10 text-amber border border-amber/20">
                    Inactive
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
