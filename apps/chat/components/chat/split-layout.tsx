'use client'

import { type ReactNode } from 'react'

interface SplitLayoutProps {
  splitMode: boolean
  /** Case rail + investigation timeline */
  leftRail?: ReactNode
  mainPanel: ReactNode
  tabBar?: ReactNode
}

export default function SplitLayout({ splitMode, leftRail, mainPanel, tabBar }: SplitLayoutProps) {
  const rowClass = splitMode
    ? 'flex min-h-0 flex-1 flex-col gap-3 pt-2 lg:flex-row lg:gap-5 lg:items-stretch xl:gap-6'
    : 'relative flex min-h-0 flex-1'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tabBar && <div className="flex-shrink-0">{tabBar}</div>}

      <div className={rowClass}>
        {splitMode && leftRail && (
          <aside className="flex shrink-0 flex-col lg:w-[clamp(154px,16vw,200px)]">
            <div className="lg:sticky lg:top-20">{leftRail}</div>
          </aside>
        )}

        <main
          className={
            splitMode && leftRail
              ? 'flex min-h-0 min-w-0 flex-1 flex-col lg:rounded-2xl lg:bg-white/[0.03] lg:ring-1 lg:ring-[var(--border-subtle)] lg:backdrop-blur-[2px]'
              : 'flex min-h-0 min-w-0 flex-1 flex-col'
          }
        >
          {mainPanel}
        </main>
      </div>
    </div>
  )
}
