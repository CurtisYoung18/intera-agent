'use client'

// ConsoleSidebar — unified sidebar with Ops + Admin groups

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  matchPattern?: string
}

const OPS_ITEMS: NavItem[] = [
  { href: '/ops/human-tasks', label: 'Human Tasks' },
  { href: '/ops/cases', label: 'Cases', matchPattern: '/ops/cases' },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/agent', label: 'Agent Config' },
  { href: '/admin/skills', label: 'Skills' },
  { href: '/admin/policies', label: 'Policies' },
  { href: '/admin/case-types', label: 'Case Types' },
  { href: '/admin/routing', label: 'Routing' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPattern) return pathname.startsWith(item.matchPattern)
  return pathname === item.href
}

export default function ConsoleSidebar() {
  const pathname = usePathname()

  return (
    <aside className="relative z-10 w-44 flex-shrink-0 glass-sidebar flex flex-col select-none">
      <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto scroll-thin">
        {/* Ops group */}
        <div>
          <h3 className="px-3 mb-1 text-[9px] font-sans tracking-[0.08em] uppercase text-fog/30">Ops</h3>
          {OPS_ITEMS.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-1.5 text-[13px] rounded-md transition-all duration-150 ${
                  active
                    ? 'text-mist bg-white/[0.06] font-medium'
                    : 'text-fog/50 hover:text-fog hover:bg-white/[0.02]'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Admin group */}
        <div>
          <h3 className="px-3 mb-1 text-[9px] font-sans tracking-[0.08em] uppercase text-fog/30">Admin</h3>
          {ADMIN_ITEMS.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-1.5 text-[13px] rounded-md transition-all duration-150 ${
                  active
                    ? 'text-mist bg-white/[0.06] font-medium'
                    : 'text-fog/50 hover:text-fog hover:bg-white/[0.02]'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="px-3 py-2 border-t border-white/[0.04]">
        <p className="text-[10px] text-fog/20 font-mono truncate">intera-agent</p>
      </div>
    </aside>
  )
}
