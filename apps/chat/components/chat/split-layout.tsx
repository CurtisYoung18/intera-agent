'use client'

import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

interface SplitLayoutProps {
  splitMode: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  mainPanel: ReactNode
  sidePanel: ReactNode
  tabBar?: ReactNode
}

export default function SplitLayout({
  splitMode,
  collapsed,
  onToggleCollapse,
  mainPanel,
  sidePanel,
  tabBar,
}: SplitLayoutProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar (multi-case switching) */}
      {tabBar && (
        <div className="flex-shrink-0">{tabBar}</div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* ── Main panel (core agent chat) ── */}
        <motion.div
          layout
          className="flex-1 flex flex-col min-w-0"
          animate={{
            marginRight: splitMode && !collapsed ? '0px' : '0px',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {mainPanel}
        </motion.div>

        {/* ── Side panel (dedicated agents) ── */}
        <AnimatePresence>
          {splitMode && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{
                width: collapsed ? 48 : 340,
                opacity: 1,
              }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="overflow-hidden border-l border-white/5 flex-shrink-0"
            >
              {sidePanel}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
