'use client'

// ThinkingIndicator — CC-style loading animation with dynamic verbs + icons
//
// Four SVG loader types (from Sam Herbert's SVG-Loaders, MIT):
//   dots  → ThreeDotsWave (gentle, for general thinking)
//   pulse → PuffRing      (expanding ring, for asking/requesting)
//   spin  → SpinningCircles (sequential dots, for processing/external calls)
//   scan  → Rings         (radar ping, for searching/looking up)

import type { IconType } from '@/lib/spinner-verbs'

export type ThinkState = 'thinking' | 'executing' | 'done'

interface ThinkingIndicatorProps {
  state: ThinkState
  verb?: string
  icon?: IconType
  activeTools?: Array<{ name: string; status: 'executing' | 'completed' | 'error' }>
  onDone?: () => void
}

export default function ThinkingIndicator({
  state,
  verb,
  icon = 'dots',
  activeTools = [],
  onDone,
}: ThinkingIndicatorProps) {
  return (
    <div className="flex flex-col gap-3 py-2 animate-fade-up">
      {/* ── Spinner + verb ── */}
      <div className="flex items-center gap-3">
        {state !== 'done' && <LoaderIcon type={icon} />}
        {state === 'done' && <CheckMark />}

        <span className="font-serif text-[15px] sm:text-[16px] italic text-fog/70 animate-shimmer-text">
          {state === 'done' ? 'Done' : (verb || 'Thinking')}
        </span>
      </div>

      {/* ── Tool badges (executing state) ── */}
      {state === 'executing' && activeTools.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-9">
          {activeTools.map((tool) => (
            <span
              key={tool.name}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-sans tracking-[0.03em] uppercase border transition-all duration-300 ${
                tool.status === 'executing'
                  ? 'border-indigo/30 text-indigo bg-indigo/[0.04]'
                  : tool.status === 'completed'
                    ? 'border-malachite/30 text-malachite bg-malachite/[0.04]'
                    : 'border-vermillion/30 text-vermillion bg-vermillion/[0.04]'
              }`}
            >
              {tool.status === 'executing' && (
                <span className="inline-block w-2 h-2 rounded-full border border-current border-l-transparent animate-tool-spin" />
              )}
              {tool.status === 'completed' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
              )}
              {tool.status === 'error' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
              )}
              {tool.name.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SVG Loader Icons (Sam Herbert, MIT) ────────────────────────────

function LoaderIcon({ type }: { type: IconType }) {
  switch (type) {
    case 'dots':  return <ThreeDotsWave />
    case 'pulse': return <PuffRing />
    case 'spin':  return <SpinningCircles />
    case 'scan':  return <Rings />
    default:      return <ThreeDotsWave />
  }
}

// dots — three dots pulsing in staggered wave (gentle, general thinking)
function ThreeDotsWave() {
  return (
    <svg width="28" height="8" viewBox="0 0 28 8" fill="rgba(140,138,133,0.6)" aria-hidden="true" className="flex-shrink-0">
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={4 + i * 10} cy="4" r={i === 1 ? 2 : 4} fillOpacity={i === 1 ? 0.3 : 1}>
          <animate attributeName="r" values={i === 1 ? '2;4;2' : '4;2;4'} calcMode="linear" begin="0s" dur="0.8s" repeatCount="indefinite" />
          <animate attributeName="fill-opacity" values={i === 1 ? '0.3;1;0.3' : '1;0.3;1'} calcMode="linear" begin="0s" dur="0.8s" repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  )
}

// pulse — expanding ring with opacity fade (for preparing/requesting)
function PuffRing() {
  return (
    <svg width="22" height="22" viewBox="0 0 44 44" stroke="rgba(140,138,133,0.6)" aria-hidden="true" className="flex-shrink-0">
      <g fill="none" fillRule="evenodd" strokeWidth="2">
        {[0, -0.9].map((begin, i) => (
          <circle key={i} cx="22" cy="22" r="1">
            <animate attributeName="r" begin={`${begin}s`} dur="1.8s" values="1;20" calcMode="spline" keyTimes="0;1" keySplines="0.165,0.84,0.44,1" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" begin={`${begin}s`} dur="1.8s" values="1;0" calcMode="spline" keyTimes="0;1" keySplines="0.3,0.61,0.355,1" repeatCount="indefinite" />
          </circle>
        ))}
      </g>
    </svg>
  )
}

// spin — 8 dots sequential fill (for processing/external calls)
function SpinningCircles() {
  const positions = ['42.601,11.462', '49.063,27.063', '42.601,42.663', '27,49.125', '11.399,42.663', '4.938,27.063', '11.399,11.462', '27,5']
  return (
    <svg width="22" height="22" viewBox="0 0 58 58" aria-hidden="true" className="flex-shrink-0">
      <g fill="none" fillRule="evenodd">
        <g transform="translate(2 1)" fill="rgba(212,145,46,0.7)">
          {positions.map((coords, i) => (
            <circle key={i} cx={coords.split(',')[0]} cy={coords.split(',')[1]} r="5" fillOpacity="0">
              <animate attributeName="fill-opacity" values={Array.from({ length: 8 }, (_, j) => (j === i ? '1' : '0')).join(';')} calcMode="linear" begin="0s" dur="1.3s" repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      </g>
    </svg>
  )
}

// scan — radar ping concentric rings (for searching/looking up)
function Rings() {
  return (
    <svg width="22" height="22" viewBox="0 0 45 45" stroke="rgba(91,110,245,0.6)" aria-hidden="true" className="flex-shrink-0">
      <g fill="none" fillRule="evenodd" transform="translate(1 1)" strokeWidth="2">
        {[0, 1.5, 3].map((begin, i) => (
          <circle key={i} cx="22" cy="22" r="6" strokeOpacity="0">
            <animate attributeName="r" begin={`${begin}s`} dur="3s" values="6;22" calcMode="linear" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" begin={`${begin}s`} dur="3s" values="1;0" calcMode="linear" repeatCount="indefinite" />
            <animate attributeName="stroke-width" begin={`${begin}s`} dur="3s" values="2;0" calcMode="linear" repeatCount="indefinite" />
          </circle>
        ))}
        <circle cx="22" cy="22" r="8">
          <animate attributeName="r" begin="0s" dur="1.5s" values="6;1;2;3;4;5;6" calcMode="linear" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  )
}

function CheckMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(46,160,74,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 animate-tool-done">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
