'use client'

import { BookOpen, Sparkles } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import {
  AgentTurnPipelineDiagram,
  CaseLifecycleDiagram,
  FactsEvidenceDiagram,
  IntentRoutingFlowDiagram,
  StageNudgeFlowDiagram,
  SubAgentDispatchDiagram,
} from '@/components/ops/runtime-guide-diagrams'
import {
  DocCallout,
  DocList,
  DocParagraph,
  DocSection,
  GuideTableOfContents,
  StickyDocAside,
} from '@/components/ops/runtime-guide-doc-layout'

const CONCEPT_KEYS = [
  'case', 'stage', 'skill', 'policy', 'memory',
] as const

const ADMIN_KEYS = [
  'agent', 'skills', 'policies', 'caseTypes', 'routing', 'models',
] as const

export default function OpsGuidePage() {
  const { t } = useConsoleLocale()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {/* Header */}
      <header className="animate-fade-up relative mb-10 border-b border-black/[0.06] pb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
          <Sparkles className="h-4 w-4 text-indigo/70" aria-hidden />
          {t('guide.hero.eyebrow')}
        </div>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo/[0.12] to-lavender/[0.08] shadow-[var(--shadow-card)] ring-1 ring-white/60">
            <BookOpen className="h-7 w-7 text-indigo/90" strokeWidth={2} aria-hidden />
          </div>
          <h1 className="text-[clamp(1.25rem,3vw,1.85rem)] font-bold tracking-tight text-[var(--mist)]">{t('guide.hero.title')}</h1>
          <DocParagraph className="text-[14px] leading-relaxed text-[var(--fog)]" text={t('guide.hero.lead')} />
        </div>
      </header>

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
        <StickyDocAside>
          <GuideTableOfContents t={t} />
        </StickyDocAside>

        <main className="min-w-0 flex-1 space-y-2 pt-1">
          {/* 1. Intro */}
          <DocSection id="guide-intro" eyebrow={t('guide.doc.intro.eyebrow')} title={t('guide.doc.intro.title')}>
            <DocParagraph text={t('guide.doc.intro.p1')} />
            <DocParagraph text={t('guide.doc.intro.p2')} />
            <DocList items={[t('guide.doc.intro.li1'), t('guide.doc.intro.li2'), t('guide.doc.intro.li3'), t('guide.doc.intro.li4')]} />
            <DocCallout>{t('guide.doc.intro.callout')}</DocCallout>
          </DocSection>

          {/* 2. Routes */}
          <DocSection id="guide-routes" eyebrow={t('guide.doc.routes.eyebrow')} title={t('guide.doc.routes.title')}>
            <DocParagraph text={t('guide.doc.routes.lead')} />
            <DocList items={[t('guide.doc.routes.li1'), t('guide.doc.routes.li2'), t('guide.doc.routes.li3'), t('guide.doc.routes.li4')]} />
            <DocCallout variant="note">{t('guide.doc.routes.note')}</DocCallout>
          </DocSection>

          {/* 3. Five Concepts */}
          <DocSection id="guide-concepts" eyebrow={t('guide.doc.concepts.eyebrow')} title={t('guide.doc.concepts.title')}>
            <DocParagraph text={t('guide.doc.concepts.lead')} />
            <div className="!mt-6 grid gap-4 md:grid-cols-2">
              {CONCEPT_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white/55 to-[var(--void)]/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-md">
                  <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t(`guide.doc.concepts.${key}Title`)}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fog)]">{t(`guide.doc.concepts.${key}Body`)}</p>
                  <p className="mt-2 text-[10px] font-medium text-indigo/70">{t(`guide.doc.concepts.${key}Cta`)}</p>
                </div>
              ))}
            </div>
          </DocSection>

          {/* 4. Case Lifecycle */}
          <DocSection id="guide-case-lifecycle" eyebrow={t('guide.doc.lifecycle.eyebrow')} title={t('guide.doc.lifecycle.title')}>
            <DocParagraph text={t('guide.doc.lifecycle.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <CaseLifecycleDiagram t={t} />
            </div>
            <DocList items={[t('guide.doc.lifecycle.p1'), t('guide.doc.lifecycle.p2'), t('guide.doc.lifecycle.p3'), t('guide.doc.lifecycle.p4'), t('guide.doc.lifecycle.p5')]} />
            <DocCallout>{t('guide.doc.lifecycle.callout')}</DocCallout>
          </DocSection>

          {/* 5. Intent Routing */}
          <DocSection id="guide-intent-routing" eyebrow={t('guide.doc.intent.eyebrow')} title={t('guide.doc.intent.title')}>
            <DocParagraph text={t('guide.doc.intent.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.intentDiag.figureTitle')}</p>
              <IntentRoutingFlowDiagram t={t} />
            </div>
            <DocList className="!mt-8" items={[t('guide.doc.intent.li1'), t('guide.doc.intent.li2'), t('guide.doc.intent.li3'), t('guide.doc.intent.li4'), t('guide.doc.intent.li5')]} />
            <DocCallout variant="note">{t('guide.doc.intent.callout')}</DocCallout>
          </DocSection>

          {/* 6. Stage Runtime */}
          <DocSection id="guide-stage-runtime" eyebrow={t('guide.doc.stage.eyebrow')} title={t('guide.doc.stage.title')}>
            <DocParagraph text={t('guide.doc.stage.lead')} />
            <DocList items={[t('guide.doc.stage.li1'), t('guide.doc.stage.li2'), t('guide.doc.stage.li3'), t('guide.doc.stage.li4')]} />
            <DocCallout>{t('guide.doc.stage.callout')}</DocCallout>
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section1.title')}</p>
              <StageNudgeFlowDiagram t={t} />
            </div>
          </DocSection>

          {/* 7. Facts & Memory */}
          <DocSection id="guide-facts-memory" eyebrow={t('guide.doc.facts.eyebrow')} title={t('guide.doc.facts.title')}>
            <DocParagraph text={t('guide.doc.facts.lead')} />
            <DocList items={[t('guide.doc.facts.li1'), t('guide.doc.facts.li2'), t('guide.doc.facts.li3'), t('guide.doc.facts.li4')]} />
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section2.title')}</p>
              <FactsEvidenceDiagram t={t} />
            </div>
          </DocSection>

          {/* 8. Agent Loop */}
          <DocSection id="guide-loop-engine" eyebrow={t('guide.doc.loop.eyebrow')} title={t('guide.doc.loop.title')}>
            <DocParagraph text={t('guide.doc.loop.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.turnDiag.figureTitle')}</p>
              <AgentTurnPipelineDiagram t={t} />
            </div>
            <DocList className="!mt-8" items={[t('guide.doc.loop.li1'), t('guide.doc.loop.li2'), t('guide.doc.loop.li3'), t('guide.doc.loop.li4'), t('guide.doc.loop.li5')]} />
            <DocCallout variant="note">{t('guide.doc.loop.note')}</DocCallout>
          </DocSection>

          {/* 9. Sub-Agents */}
          <DocSection id="guide-sub-agents" eyebrow={t('guide.doc.sub.eyebrow')} title={t('guide.doc.sub.title')}>
            <DocParagraph text={t('guide.doc.sub.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">Sub-Agent Dispatch</p>
              <SubAgentDispatchDiagram t={t} />
            </div>
            <DocList items={[t('guide.doc.sub.p1'), t('guide.doc.sub.p2'), t('guide.doc.sub.p3')]} />
            <DocCallout>{t('guide.doc.sub.callout')}</DocCallout>
          </DocSection>

          {/* 10. Tools & Policy */}
          <DocSection id="guide-tools-policy" eyebrow={t('guide.doc.tools.eyebrow')} title={t('guide.doc.tools.title')}>
            <DocParagraph text={t('guide.doc.tools.lead')} />
            <DocList items={[t('guide.doc.tools.li1'), t('guide.doc.tools.li2'), t('guide.doc.tools.li3'), t('guide.doc.tools.li4'), t('guide.doc.tools.li5'), t('guide.doc.tools.li6')]} />
          </DocSection>

          {/* 11. Config Lifecycle */}
          <DocSection id="guide-config-lifecycle" eyebrow={t('guide.doc.config.eyebrow')} title={t('guide.doc.config.title')}>
            <DocParagraph text={t('guide.doc.config.lead')} />
            <DocList items={[t('guide.doc.config.li1'), t('guide.doc.config.li2'), t('guide.doc.config.li3'), t('guide.doc.config.li4')]} />
            <DocCallout variant="note">{t('guide.doc.config.callout')}</DocCallout>
          </DocSection>

          {/* 12. Observability */}
          <DocSection id="guide-observability" eyebrow={t('guide.doc.observe.eyebrow')} title={t('guide.doc.observe.title')}>
            <DocParagraph text={t('guide.doc.observe.lead')} />
            <DocList items={[t('guide.doc.observe.li1'), t('guide.doc.observe.li2'), t('guide.doc.observe.li3'), t('guide.doc.observe.li4'), t('guide.doc.observe.li5')]} />
          </DocSection>

          {/* 13. Admin Map */}
          <DocSection id="guide-admin-map" eyebrow={t('guide.doc.admin.eyebrow')} title={t('guide.doc.admin.title')}>
            <DocParagraph text={t('guide.doc.admin.lead')} />
            <div className="!mt-6 grid gap-4 md:grid-cols-2">
              {ADMIN_KEYS.map((key) => (
                <div key={key} className="rounded-xl border border-black/[0.06] bg-gradient-to-br from-white/55 to-[var(--void)]/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-md">
                  <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t(`guide.doc.admin.${key}Title`)}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--fog)]">{t(`guide.doc.admin.${key}Body`)}</p>
                </div>
              ))}
            </div>
          </DocSection>

          {/* 14. API Reference */}
          <DocSection id="guide-api" eyebrow={t('guide.doc.api.eyebrow')} title={t('guide.doc.api.title')}>
            <DocParagraph text={t('guide.doc.api.lead')} />

            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-6">{t('guide.doc.api.baseUrl')}</h3>
            <p className="text-[12px] text-[var(--fog)] mt-1">
              <code className="px-1.5 py-0.5 rounded-md bg-teal-500/[0.08] text-[11px] text-teal-700 font-mono">
                {t('guide.doc.api.baseUrlDesc')}
              </code>
            </p>

            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-5">{t('guide.doc.api.auth')}</h3>
            <DocParagraph text={t('guide.doc.api.authDesc')} />

            {/* Send Message */}
            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-5">{t('guide.doc.api.sendMessageTitle')}</h3>
            <DocParagraph text={t('guide.doc.api.sendMessageDesc')} />

            <div className="!mt-3 rounded-xl border border-black/[0.06] bg-black/[0.01] p-4 font-mono text-[11px] leading-relaxed">
              <div className="text-[var(--fog)] mb-2">
                <span className="inline-block w-14 text-[10px] uppercase tracking-wider text-teal-600 font-semibold">POST</span>
                <span className="text-[var(--mist)]">/api/messages</span>
              </div>
              <div className="text-[var(--fog)] mb-2">
                <span className="inline-block w-14 text-[10px] uppercase tracking-wider text-[var(--fog)]/60">Host</span>
                <span>intera-chat.up.railway.app</span>
              </div>
              <div className="text-[var(--fog)] mb-2">
                <span className="inline-block w-14 text-[10px] uppercase tracking-wider text-[var(--fog)]/60">{t('guide.doc.api.contentType')}</span>
                <span>application/json</span>
              </div>
              <div className="text-[var(--fog)]/60 mt-3 mb-1 text-[10px] uppercase tracking-wider">{t('guide.doc.api.reqBody')}</div>
              <div className="bg-teal-500/[0.04] rounded-lg p-3 text-[var(--mist)] overflow-x-auto">
{`{
  "userId": "player_123",
  "message": "I deposited 500 Taka but it's not showing in my balance",
  "chatId": "",
  "customerId": "default"
}`}
              </div>
            </div>

            <ul className="!mt-3 space-y-1.5 text-[11px] text-[var(--fog)]">
              <li><code className="text-[10px] bg-black/[0.04] px-1 rounded">userId</code> — {t('guide.doc.api.fieldUserId')}</li>
              <li><code className="text-[10px] bg-black/[0.04] px-1 rounded">message</code> — {t('guide.doc.api.fieldMessage')}</li>
              <li><code className="text-[10px] bg-black/[0.04] px-1 rounded">chatId</code> — {t('guide.doc.api.fieldChatId')}</li>
              <li><code className="text-[10px] bg-black/[0.04] px-1 rounded">customerId</code> — {t('guide.doc.api.fieldCustomerId')}</li>
            </ul>

            {/* SSE Response */}
            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-5">{t('guide.doc.api.sseTitle')}</h3>
            <DocParagraph text={t('guide.doc.api.sseDesc')} />
            <div className="!mt-3 rounded-xl border border-black/[0.06] bg-black/[0.01] p-4 font-mono text-[11px] leading-relaxed overflow-x-auto">
              <div className="text-[var(--fog)]/60 text-[10px] mb-2">event: text_delta</div>
              <div className="text-[var(--mist)] mb-3">{`data: {"delta":"Hello"}`}</div>

              <div className="text-[var(--fog)]/60 text-[10px] mb-2">event: tool_executing</div>
              <div className="text-[var(--mist)] mb-3">{`data: {"name":"kb_hybrid_retrieve","displayLabel":"Searching knowledge base"}`}</div>

              <div className="text-[var(--fog)]/60 text-[10px] mb-2">event: case_update</div>
              <div className="text-[var(--mist)] mb-3">{`data: {"caseId":"...","status":"investigating","type":"deposit_issue"}`}</div>

              <div className="text-[var(--fog)]/60 text-[10px] mb-2">event: tool_result</div>
              <div className="text-[var(--mist)] mb-3">{`data: {"name":"kb_hybrid_retrieve","result":{"list":[...],"total":3}}`}</div>

              <div className="text-[var(--fog)]/60 text-[10px] mb-2">event: done</div>
              <div className="text-[var(--mist)]">data: [DONE]</div>
            </div>

            <ul className="!mt-3 space-y-1.5 text-[11px] text-[var(--fog)]">
              <li><strong>text_delta</strong> — {t('guide.doc.api.eventTextDelta')}</li>
              <li><strong>tool_executing</strong> — {t('guide.doc.api.eventToolExecuting')}</li>
              <li><strong>tool_result</strong> — {t('guide.doc.api.eventToolResult')}</li>
              <li><strong>case_update</strong> — {t('guide.doc.api.eventCaseUpdate')}</li>
              <li><strong>error</strong> — {t('guide.doc.api.eventError')}</li>
              <li><strong>done</strong> — {t('guide.doc.api.eventDone')}</li>
            </ul>

            {/* Health check */}
            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-5">{t('guide.doc.api.healthTitle')}</h3>
            <DocParagraph text={t('guide.doc.api.healthDesc')} />
            <div className="!mt-2 rounded-xl border border-black/[0.06] bg-black/[0.01] p-3 font-mono text-[11px]">
              <span className="inline-block w-12 text-[10px] uppercase tracking-wider text-green-600 font-semibold">GET</span>
              <span className="text-[var(--mist)]">/api/health</span>
            </div>

            {/* Chat UI */}
            <h3 className="text-[13px] font-semibold text-[var(--mist)] !mt-5">{t('guide.doc.api.chatUiTitle')}</h3>
            <p className="text-[12px] text-[var(--fog)] mt-1">
              <a href="https://intera-chat.up.railway.app/chat" target="_blank" rel="noopener noreferrer"
                className="text-teal-600 hover:underline font-mono text-[11px]">
                {t('guide.doc.api.chatUiDesc')}
              </a>
            </p>

            {/* Postman Quick Start */}
            <DocCallout variant="note">
              <p className="text-[12px] font-semibold mb-2">{t('guide.doc.api.postmanTitle')}</p>
              <ol className="space-y-1 text-[11px] text-[var(--fog)] list-decimal list-inside">
                <li>{t('guide.doc.api.postmanP1')}</li>
                <li>{t('guide.doc.api.postmanP2')}</li>
                <li>{t('guide.doc.api.postmanP3')}</li>
                <li>{t('guide.doc.api.postmanP4')}</li>
                <li>{t('guide.doc.api.postmanP5')}</li>
              </ol>
            </DocCallout>
          </DocSection>

          {/* Footer */}
          <p className="border-t border-black/[0.05] pt-10 text-center text-[12px] leading-relaxed text-[var(--smoke)]/80">{t('guide.footer.note')}</p>
        </main>
      </div>
    </div>
  )
}
