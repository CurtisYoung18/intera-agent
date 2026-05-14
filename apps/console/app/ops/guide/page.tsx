'use client'

import { BookOpen, Sparkles } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import {
  AgentTurnPipelineDiagram,
  FactsEvidenceDiagram,
  IntentRoutingFlowDiagram,
  StageNudgeFlowDiagram,
} from '@/components/ops/runtime-guide-diagrams'
import {
  DocCallout,
  DocList,
  DocParagraph,
  DocSection,
  GuideTableOfContents,
  StickyDocAside,
} from '@/components/ops/runtime-guide-doc-layout'

const CODE_MAP_MODULE_KEYS = Array.from({ length: 11 }, (_, i) => `guide.doc.codes.p${i + 1}` as const)
const CODE_MAP_HTTP_KEYS = ['guide.doc.codes.h1', 'guide.doc.codes.h2', 'guide.doc.codes.h3', 'guide.doc.codes.h4', 'guide.doc.codes.h5'] as const
const CODE_MAP_INTENT_KEYS = [
  'guide.doc.codes.ir1',
  'guide.doc.codes.ir2',
  'guide.doc.codes.ir3',
  'guide.doc.codes.ir4',
  'guide.doc.codes.ir5',
] as const

export default function OpsGuidePage() {
  const { t } = useConsoleLocale()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
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
          <DocSection id="guide-intro" eyebrow={t('guide.doc.intro.eyebrow')} title={t('guide.doc.intro.title')}>
            <DocParagraph text={t('guide.doc.intro.p1')} />
            <DocParagraph text={t('guide.doc.intro.p2')} />
            <DocList items={[t('guide.doc.intro.li1'), t('guide.doc.intro.li2'), t('guide.doc.intro.li3'), t('guide.doc.intro.li4')]} />
            <DocCallout>{t('guide.doc.intro.callout')}</DocCallout>
          </DocSection>

          <DocSection id="guide-routes" eyebrow={t('guide.doc.routes.eyebrow')} title={t('guide.doc.routes.title')}>
            <DocParagraph text={t('guide.doc.routes.lead')} />
            <DocList items={[t('guide.doc.routes.li1'), t('guide.doc.routes.li2'), t('guide.doc.routes.li3'), t('guide.doc.routes.li4')]} />
            <DocCallout variant="note">{t('guide.doc.routes.note')}</DocCallout>
          </DocSection>

          <DocSection id="guide-intent-routing" eyebrow={t('guide.doc.intent.eyebrow')} title={t('guide.doc.intent.title')}>
            <DocParagraph text={t('guide.doc.intent.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.intentDiag.figureTitle')}</p>
              <IntentRoutingFlowDiagram t={t} />
            </div>
            <DocList
              className="!mt-8"
              items={[
                t('guide.doc.intent.li1'),
                t('guide.doc.intent.li2'),
                t('guide.doc.intent.li3'),
                t('guide.doc.intent.li4'),
                t('guide.doc.intent.li5'),
              ]}
            />
            <DocCallout variant="note">{t('guide.doc.intent.callout')}</DocCallout>
          </DocSection>

          <DocSection id="guide-case-human" eyebrow={t('guide.doc.casehum.eyebrow')} title={t('guide.doc.casehum.title')}>
            <DocParagraph text={t('guide.doc.casehum.lead')} />
            <DocList
              items={[
                t('guide.doc.casehum.li1'),
                t('guide.doc.casehum.li2'),
                t('guide.doc.casehum.li3'),
                t('guide.doc.casehum.li4'),
              ]}
            />
            <DocCallout variant="note">{t('guide.doc.casehum.note')}</DocCallout>
          </DocSection>

          <DocSection id="guide-loop-engine" eyebrow={t('guide.doc.loop.eyebrow')} title={t('guide.doc.loop.title')}>
            <DocParagraph text={t('guide.doc.loop.lead')} />
            <div className="!mt-6 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.turnDiag.figureTitle')}</p>
              <AgentTurnPipelineDiagram t={t} />
            </div>
            <DocList className="!mt-8" items={[t('guide.doc.loop.li1'), t('guide.doc.loop.li2'), t('guide.doc.loop.li3'), t('guide.doc.loop.li4'), t('guide.doc.loop.li5')]} />
            <DocCallout variant="note">{t('guide.doc.loop.note')}</DocCallout>
          </DocSection>

          <DocSection id="guide-react-cycle" eyebrow={t('guide.doc.react.eyebrow')} title={t('guide.doc.react.title')}>
            <DocParagraph text={t('guide.doc.react.lead')} />
            <DocList items={[t('guide.doc.react.li1'), t('guide.doc.react.li2'), t('guide.doc.react.li3'), t('guide.doc.react.li4'), t('guide.doc.react.li5')]} />
          </DocSection>

          <DocSection id="guide-stage-runtime" eyebrow={t('guide.doc.stage.eyebrow')} title={t('guide.doc.stage.title')}>
            <DocParagraph text={t('guide.doc.stage.lead')} />
            <DocList items={[t('guide.doc.stage.li1'), t('guide.doc.stage.li2'), t('guide.doc.stage.li3')]} />
            <DocCallout>{t('guide.doc.stage.callout')}</DocCallout>
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section1.title')}</p>
              <StageNudgeFlowDiagram t={t} />
            </div>
          </DocSection>

          <DocSection id="guide-facts-memory" eyebrow={t('guide.doc.facts.eyebrow')} title={t('guide.doc.facts.title')}>
            <DocParagraph text={t('guide.doc.facts.lead')} />
            <DocList items={[t('guide.doc.facts.li1'), t('guide.doc.facts.li2'), t('guide.doc.facts.li3'), t('guide.doc.facts.li4')]} />
            <div className="!mt-8 rounded-[1.25rem] border border-black/[0.06] bg-gradient-to-br from-white/55 via-white/35 to-[var(--void)]/30 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-7">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{t('guide.section2.title')}</p>
              <FactsEvidenceDiagram t={t} />
            </div>
          </DocSection>

          <DocSection id="guide-tools-policy" eyebrow={t('guide.doc.tools.eyebrow')} title={t('guide.doc.tools.title')}>
            <DocParagraph text={t('guide.doc.tools.lead')} />
            <DocList items={[t('guide.doc.tools.li1'), t('guide.doc.tools.li2'), t('guide.doc.tools.li3'), t('guide.doc.tools.li4'), t('guide.doc.tools.li5')]} />
          </DocSection>

          <DocSection id="guide-observability" eyebrow={t('guide.doc.observe.eyebrow')} title={t('guide.doc.observe.title')}>
            <DocParagraph text={t('guide.doc.observe.lead')} />
            <DocList items={[t('guide.doc.observe.li1'), t('guide.doc.observe.li2'), t('guide.doc.observe.li3'), t('guide.doc.observe.li4'), t('guide.doc.observe.li5')]} />
          </DocSection>

          <DocSection id="guide-code-map" eyebrow={t('guide.doc.codes.eyebrow')} title={t('guide.doc.codes.title')}>
            <DocParagraph text={t('guide.doc.codes.lead')} />

            <p className="!mt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('guide.doc.codes.httpTitle')}</p>
            <ul className="mt-2 space-y-2 border-l-[3px] border-sky/20 pl-4 text-[12px] font-mono leading-relaxed text-[var(--mist)]/[0.82]">
              {CODE_MAP_HTTP_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>

            <p className="!mt-8 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('guide.doc.codes.modulesTitle')}</p>
            <ul className="mt-2 space-y-2 font-mono text-[12px] leading-relaxed text-[var(--fog)]">
              {CODE_MAP_MODULE_KEYS.map((key) => (
                <li key={key} className="rounded-lg border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[var(--mist)]/[0.78]">
                  {t(key)}
                </li>
              ))}
            </ul>

            <p className="!mt-8 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('guide.doc.codes.intentParamsTitle')}</p>
            <ul className="mt-2 space-y-2 border-l-[3px] border-amber/20 pl-4 text-[12px] leading-relaxed text-[var(--mist)]/[0.82]">
              {CODE_MAP_INTENT_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>

            <DocCallout variant="note" className="!mt-6">
              {t('guide.doc.codes.footer')}
            </DocCallout>
          </DocSection>

          <p className="border-t border-black/[0.05] pt-10 text-center text-[12px] leading-relaxed text-[var(--smoke)]/80">{t('guide.footer.note')}</p>
        </main>
      </div>
    </div>
  )
}
