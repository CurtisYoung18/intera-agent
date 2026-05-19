'use client'

import { type ReactNode } from 'react'

interface SplitLayoutProps {
  splitMode: boolean
  casePanel?: ReactNode
  mainPanel: ReactNode
}

export default function SplitLayout({ splitMode, casePanel, mainPanel }: SplitLayoutProps) {
  const rowClass = splitMode
    ? 'flex min-h-0 flex-1 flex-col gap-3 pt-2 lg:flex-row lg:gap-4 lg:items-stretch xl:gap-5'
    : 'relative flex min-h-0 flex-1'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={rowClass}>
        {splitMode && casePanel && (
          <div className="flex shrink-0 flex-col lg:w-[280px] overflow-y-auto">
            <div className="lg:sticky lg:top-20">{casePanel}</div>
          </div>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mainPanel}
        </main>
      </div>
    </div>
  )
}
