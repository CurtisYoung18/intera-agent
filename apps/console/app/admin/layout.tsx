// Admin Layout — shared sidebar nav for all admin pages

import type { ReactNode } from 'react'
import Link from 'next/link'
import FluidBackground from '@intera/shared/ui/fluid-background'

const NAV_ITEMS = [
  { href: '/admin/agent', label: 'Agent Config' },
  { href: '/admin/skills', label: 'Skills' },
  { href: '/admin/policies', label: 'Policies' },
  { href: '/admin/case-types', label: 'Case Types' },
  { href: '/admin/routing', label: 'Routing' },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] flex">
      <FluidBackground intensity="subtle" />

      {/* Sidebar */}
      <aside className="relative z-10 w-52 flex-shrink-0 glass-sidebar flex flex-col">
        <div className="px-4 py-4 border-b border-white/[0.04]">
          <Link href="/ops/human-tasks" className="text-[12px] text-fog/40 hover:text-fog/60 transition-colors">
            ← Back to Ops
          </Link>
          <h1 className="text-[13px] font-medium text-mist mt-3 tracking-[-0.01em]">Intera Admin</h1>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 text-[13px] text-fog/60 hover:text-mist hover:bg-white/[0.03] rounded-md transition-all duration-150"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-white/[0.04]">
          <p className="text-[10px] text-fog/20 font-mono">intera-agent</p>
        </div>
      </aside>

      {/* Content */}
      <main className="relative z-10 flex-1 min-h-[100dvh] overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
