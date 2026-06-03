'use client'

import { useState, useEffect } from 'react'
import { Globe, Copy, CheckCircle2 } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

export default function WebChatDetailPage() {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const [orgId, setOrgId] = useState('default')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then((d: { orgId?: string }) => {
      if (d.orgId) setOrgId(d.orgId)
    }).catch(() => {})
  }, [])

  const embedScript = `<script>
  (function(w,d,s,o,f,js,fjs){
    w['InteraWidget']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s),fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','iw','https://demo.anytrans.ai/widget.js'));
  iw('init', { orgId: '${orgId}' });
</script>`

  const l = (key: string) => {
    const map: Record<string, Record<string, string>> = {
      back: { en: '← Channels', zh: '← 渠道' },
      subtitle: { en: 'Embedded chat widget · Coming soon', zh: '嵌入式聊天组件 · 即将上线' },
      embedScript: { en: 'Embed Script', zh: '嵌入代码' },
      embedHint: { en: 'Add this script to your website. The widget will connect to your org\'s agent.', zh: '将此代码添加到网站，组件将连接到你组织的 Agent。' },
      comingSoon: { en: 'The Web Chat widget frontend is under development. The embed script and API endpoints are ready. Messages will flow through /api/messages like LiveChat.', zh: 'Web Chat 组件前端开发中。嵌入代码和后端 API 已就绪，消息将通过 /api/messages 流转（与 LiveChat 相同）。' },
    }
    return map[key]?.[locale as 'en' | 'zh'] ?? map[key]?.en ?? key
  }

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

      <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 leading-relaxed">
          {l('comingSoon')}
        </div>

        <div>
          <label className={labelCls}>{l('embedScript')}</label>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-[11px] font-mono text-[var(--mist)] bg-black/[0.03] p-4 rounded-xl border border-black/[0.06] overflow-x-auto whitespace-pre-wrap">
              {embedScript}
            </pre>
            <button
              onClick={() => { navigator.clipboard.writeText(embedScript); setCopied(true); setTimeout(() => setCopied(false), 3000) }}
              className="flex-shrink-0 p-2 rounded-lg hover:bg-indigo/[0.06] text-[var(--fog)] hover:text-indigo transition-colors"
              title="Copy"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-malachite" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-[var(--fog)] mt-1.5">{l('embedHint')}</p>
        </div>
      </div>
    </div>
  )
}
