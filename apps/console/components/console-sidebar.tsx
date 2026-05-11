'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardList, FolderOpen, Bot, Puzzle, Shield, Layers, GitBranch,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: typeof ClipboardList
  color: string
  matchPattern?: string
}

const OPS_ITEMS: NavItem[] = [
  { href: '/ops/human-tasks', label: 'Human Tasks', icon: ClipboardList, color: '#f0b050' },
  { href: '/ops/cases', label: 'Cases', icon: FolderOpen, color: '#5b8af7', matchPattern: '/ops/cases' },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/agent', label: 'Agent Config', icon: Bot, color: '#2ea04a' },
  { href: '/admin/skills', label: 'Skills', icon: Puzzle, color: '#5b8af7' },
  { href: '/admin/policies', label: 'Policies', icon: Shield, color: '#e64539' },
  { href: '/admin/case-types', label: 'Case Types', icon: Layers, color: '#d4912e' },
  { href: '/admin/routing', label: 'Routing', icon: GitBranch, color: '#5bb8f7' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPattern) return pathname.startsWith(item.matchPattern)
  return pathname === item.href
}

export default function ConsoleSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  return (
    <aside
      className={`relative z-20 flex-shrink-0 flex flex-col transition-[width] duration-300 ease-out
        bg-white/50 backdrop-blur-2xl border-r border-black/5
        ${collapsed ? 'w-14' : 'w-56'}`}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-white border border-black/10 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors z-30"
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-gray-400" />
          : <ChevronLeft className="w-3 h-3 text-gray-400" />
        }
      </button>

      {/* Avatar section */}
      <div className="px-3 pt-4 pb-3">
        <button
          onClick={() => setAvatarOpen(!avatarOpen)}
          className="w-full flex items-center gap-2.5 rounded-xl p-2 hover:bg-black/5 transition-all"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo/20 to-indigo/5 border border-indigo/20 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-indigo" />
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[12px] font-medium text-[var(--mist)] truncate">Admin User</p>
                <p className="text-[10px] text-[var(--fog)] truncate">Demo Vendor</p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform ${avatarOpen ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>
        {avatarOpen && !collapsed && (
          <div className="mt-1 ml-10 space-y-0.5 animate-fade-up">
            <button className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all">
              <Building2 className="w-3 h-3" /> Switch Project
            </button>
            <button className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/5 rounded-lg transition-all">
              <LogOut className="w-3 h-3" /> Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-2 px-2 space-y-4 overflow-y-auto scroll-thin">
        <NavGroup label="Operations" items={OPS_ITEMS} pathname={pathname} collapsed={collapsed} />
        <NavGroup label="Administration" items={ADMIN_ITEMS} pathname={pathname} collapsed={collapsed} />
      </nav>

      {/* Footer */}
      <div className="px-3 pb-3 pt-2 border-t border-black/5">
        {!collapsed ? (
          <p className="text-[10px] text-[var(--fog)] font-mono px-2">v0.1</p>
        ) : (
          <div className="w-3 h-3 mx-auto rounded-full bg-black/5" />
        )}
      </div>
    </aside>
  )
}

function NavGroup({ label, items, pathname, collapsed }: {
  label: string
  items: NavItem[]
  pathname: string
  collapsed: boolean
}) {
  return (
    <div>
      {!collapsed && (
        <p className="px-2.5 mb-1 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--fog)]/40">
          {label}
        </p>
      )}
      <div className="space-y-0.5">
        {items.map(item => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-lg transition-all duration-200 group relative ${
                collapsed ? 'justify-center py-2.5 px-0' : 'gap-2.5 px-2.5 py-2'
              } ${
                active
                  ? 'bg-black/[0.04]'
                  : 'hover:bg-black/[0.02]'
              }`}
            >
              {/* Active indicator bar */}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                  style={{ background: `linear-gradient(180deg, ${item.color}, transparent)` }} />
              )}

              <item.icon
                className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
                style={{ color: active ? item.color : 'var(--fog)', opacity: active ? 1 : 0.5 }}
                strokeWidth={active ? 2 : 1.5}
              />

              {!collapsed && (
                <span className={`text-[13px] whitespace-nowrap transition-colors ${
                  active ? 'text-[var(--mist)] font-medium' : 'text-[var(--fog)]'
                }`}>
                  {item.label}
                </span>
              )}

              {/* Active dot for collapsed */}
              {active && collapsed && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-3 rounded-full"
                  style={{ backgroundColor: item.color }} />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
