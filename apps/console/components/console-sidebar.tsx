'use client'

// ConsoleSidebar v2 — neumorphic glass, icon-based nav, avatar + project selector

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardList,
  FolderOpen,
  Bot,
  Puzzle,
  Shield,
  Layers,
  GitBranch,
  User,
  ChevronDown,
  LogOut,
  Building2,
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
  { href: '/ops/cases', label: 'Cases', icon: FolderOpen, color: '#6b8cff', matchPattern: '/ops/cases' },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/agent', label: 'Agent Config', icon: Bot, color: '#4dd98b' },
  { href: '/admin/skills', label: 'Skills', icon: Puzzle, color: '#6b8cff' },
  { href: '/admin/policies', label: 'Policies', icon: Shield, color: '#f05050' },
  { href: '/admin/case-types', label: 'Case Types', icon: Layers, color: '#f0b050' },
  { href: '/admin/routing', label: 'Routing', icon: GitBranch, color: '#4dd98b' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPattern) return pathname.startsWith(item.matchPattern)
  return pathname === item.href
}

export default function ConsoleSidebar() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  return (
    <aside
      className={`relative z-20 flex-shrink-0 glass-sidebar flex flex-col transition-all duration-400 ease-out ${
        expanded ? 'w-52' : 'w-14'
      }`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => {
        setExpanded(false)
        setAvatarOpen(false)
      }}
    >
      {/* ── Avatar / Project section ── */}
      <div className="px-2 pt-4 pb-3 border-b border-white/[0.04]">
        <button
          onClick={() => setAvatarOpen(!avatarOpen)}
          className="w-full flex items-center gap-2.5 rounded-xl p-2 hover:bg-white/[0.04] transition-all duration-200"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo/40 to-indigo/10 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-indigo" strokeWidth={2} />
          </div>

          {/* Expanded: user info + chevron */}
          {expanded && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[12px] font-medium text-primary truncate leading-tight">Admin User</p>
                <p className="text-[10px] text-muted truncate leading-tight">Demo Vendor</p>
              </div>
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted transition-transform duration-200 ${avatarOpen ? 'rotate-180' : ''}`}
                strokeWidth={2}
              />
            </>
          )}
        </button>

        {/* Dropdown */}
        {avatarOpen && expanded && (
          <div className="mt-2 ml-11 space-y-0.5 animate-fade-up">
            <button className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-secondary hover:text-primary hover:bg-white/[0.04] rounded-md transition-all duration-150">
              <Building2 className="w-3 h-3" />
              Switch Project
            </button>
            <button className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-secondary hover:text-vermillion hover:bg-white/[0.04] rounded-md transition-all duration-150">
              <LogOut className="w-3 h-3" />
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto scroll-thin">
        {/* Ops group */}
        <NavGroup
          label="Ops"
          items={OPS_ITEMS}
          pathname={pathname}
          expanded={expanded}
        />

        {/* Admin group */}
        <NavGroup
          label="Admin"
          items={ADMIN_ITEMS}
          pathname={pathname}
          expanded={expanded}
        />
      </nav>

      {/* ── Footer ── */}
      <div className="px-2 pb-3 pt-2 border-t border-white/[0.04]">
        {expanded ? (
          <p className="text-[10px] text-muted font-mono px-2">v0.1</p>
        ) : (
          <div className="w-4 h-4 mx-auto rounded-full bg-white/[0.03]" />
        )}
      </div>
    </aside>
  )
}

// ── Nav Group ──────────────────────────────────────

function NavGroup({
  label,
  items,
  pathname,
  expanded,
}: {
  label: string
  items: NavItem[]
  pathname: string
  expanded: boolean
}) {
  return (
    <div>
      {expanded && (
        <p className="px-2.5 mb-1.5 text-[9px] font-sans tracking-[0.1em] uppercase text-muted/40">
          {label}
        </p>
      )}
      <div className={expanded ? 'space-y-0.5' : 'space-y-2'}>
        {items.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center rounded-xl transition-all duration-200 group ${
                expanded ? 'gap-2.5 px-2.5 py-2' : 'justify-center py-2.5'
              } ${
                active
                  ? 'bg-white/[0.06]'
                  : 'hover:bg-white/[0.03]'
              }`}
              title={!expanded ? item.label : undefined}
            >
              <item.icon
                className={`w-[22px] h-[22px] flex-shrink-0 transition-all duration-300 ${
                  active ? 'animate-glow' : ''
                }`}
                style={{
                  color: active ? item.color : undefined,
                  fill: active ? item.color : 'transparent',
                  ['--glow-color' as string]: item.color,
                }}
                strokeWidth={active ? 0 : 1.5}
              />

              {expanded && (
                <span
                  className={`text-[13px] whitespace-nowrap transition-colors duration-200 ${
                    active ? 'text-primary font-medium' : 'text-secondary'
                  }`}
                >
                  {item.label}
                </span>
              )}

              {/* Active indicator dot (collapsed mode) */}
              {active && !expanded && (
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
