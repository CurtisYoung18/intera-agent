'use client'

import { useState } from 'react'
import { CheckCircle2, Copy, Globe } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { useSession } from '@/lib/hooks/use-session'

export default function WebChatChannelWorkspace({ onBack }: { onBack: () => void }) {
  const { locale } = useConsoleLocale()
  const { orgId } = useSession()
  const [copied, setCopied] = useState(false)

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
      embedHint: { en: 'Add this script to your website. The widget will connect to your organization entry point.', zh: '将此代码添加到网站，组件会连接到当前组织的会话入口。' },
      comingSoon: { en: 'The Web Chat widget frontend is still a staged P0 surface. The embed script and backend endpoints are ready, but the polished customer widget UI is not yet part of this delivery lane.', zh: 'Web Chat 组件前端仍是分阶段交付的 P0 面。嵌入代码和后端端点已准备好，但面向客户的精修 widget UI 还不在本轮交付范围。' },
    }
    return map[key]?.[locale as 'en' | 'zh'] ?? map[key]?.en ?? key
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-[11px] text-indigo hover:text-indigo/80">
          {l('back')}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100">
          <Globe className="h-4 w-4 text-sky-600" />
        </div>
        <div>
          <h2 className="text-[18px] font-bold text-[var(--mist)]">Web Chat</h2>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
      </div>

      <div className="max-w-2xl space-y-4 rounded-2xl border border-black/[0.06] bg-white/60 p-5 backdrop-blur-xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800">
          {l('comingSoon')}
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--mist)]">{l('embedScript')}</label>
          <div className="flex items-start gap-2">
            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap rounded-xl border border-black/[0.06] bg-black/[0.03] p-4 font-mono text-[11px] text-[var(--mist)]">
              {embedScript}
            </pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(embedScript)
                setCopied(true)
                setTimeout(() => setCopied(false), 3000)
              }}
              className="shrink-0 rounded-lg p-2 text-[var(--fog)] transition-colors hover:bg-indigo/[0.06] hover:text-indigo"
              title="Copy"
            >
              {copied ? <CheckCircle2 className="h-4 w-4 text-malachite" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--fog)]">{l('embedHint')}</p>
        </div>
      </div>
    </div>
  )
}
