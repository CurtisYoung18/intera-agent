'use client'

import { useState } from 'react'
import { Globe, MessageSquare, GitBranch, Monitor, UserCheck } from 'lucide-react'
import Link from 'next/link'
import { useConsoleLocale } from '@/components/locale-provider'

const TABS = [
  { id: 'connection', label: 'Connection', labelZh: '连接', icon: Globe },
  { id: 'humanOps', label: 'Human Ops', labelZh: '人工配置', icon: UserCheck },
] as const

const L = {
  back: { en: '← Channels', zh: '← 渠道' },
  subtitle: { en: 'Embedded chat widget · Human escalation', zh: '嵌入式聊天组件 · 人工升级' },
  connection: { en: 'Connection', zh: '连接' },
  embedScript: { en: 'Embed Script', zh: '嵌入代码' },
  embedHint: { en: 'Add this script to your website to enable the Intera chat widget.', zh: '将此代码添加到网站即可启用 Intera 聊天组件。' },
  humanOps: { en: 'Human Ops', zh: '人工配置' },
  consultationPrompt: { en: 'Consultation prompt', zh: '咨询提示词' },
  consultationPromptHint: { en: 'System prompt used when a human specialist is consulting on a case via web chat.', zh: '人工专员通过 Web Chat 咨询案例时使用的系统提示词。' },
  allowedSkills: { en: 'Skills during consultation', zh: '咨询期间可用工具' },
  allowedSkillsHint: { en: 'Comma-separated skill names. Empty = allow all.', zh: '逗号分隔的工具名称。留空 = 全部允许。' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

export default function WebChatDetailPage() {
  const { locale } = useConsoleLocale()
  const l = useL()
  const isZh = locale === 'zh'
  const [activeTab, setActiveTab] = useState<string>('connection')

  const inputCls = 'w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[12px] font-semibold text-[var(--mist)] mb-1'

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-2 mb-2">
        <a href="/admin/channels" className="text-[11px] text-indigo hover:text-indigo/80">{l('back')}</a>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center"><Globe className="w-4 h-4 text-sky-600" /></div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">Web Chat</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-black/[0.06]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-[1px] ${activeTab === tab.id ? 'border-indigo text-indigo' : 'border-transparent text-[var(--fog)] hover:text-[var(--mist)]'}`}>
            <tab.icon className="w-3.5 h-3.5" /> {isZh ? tab.labelZh : tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'connection' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('connection')}</p>
          <div>
            <label className={labelCls}>{l('embedScript')}</label>
            <div className="relative">
              <pre className="text-[11px] font-mono text-[var(--mist)] bg-black/[0.03] p-4 rounded-xl border border-black/[0.06] overflow-x-auto whitespace-pre-wrap">
{`<script>
  (function(w,d,s,o,f,js,fjs){
    w['InteraWidget']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s),fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','iw','https://intera-chat.up.railway.app/widget.js'));
  iw('init', { orgId: 'default' });
</script>`}
              </pre>
            </div>
            <p className="text-[10px] text-[var(--fog)] mt-1.5">{l('embedHint')}</p>
          </div>
        </div>
      )}

      {activeTab === 'humanOps' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('humanOps')}</p>
          <div>
            <label className={labelCls}>{l('consultationPrompt')}</label>
            <textarea className={inputCls} rows={5}
              placeholder="You are consulting on a case. Review the context and provide guidance..."
            />
            <p className="text-[10px] text-[var(--fog)] mt-1">{l('consultationPromptHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{l('allowedSkills')}</label>
            <input className={inputCls} placeholder="read_case_history, kb_search_General" defaultValue="read_case_history" />
            <p className="text-[10px] text-[var(--fog)] mt-1">{l('allowedSkillsHint')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
