'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardList, FolderOpen, Bot, Puzzle, Shield, Layers, GitBranch,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
  Languages,
  BookOpen,
  MessageSquare,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { TranslateFn } from '@/lib/i18n/types'

type NavSlug = 'humanTasks' | 'cases' | 'chats' | 'guide' | 'agentConfig' | 'skills' | 'policies' | 'caseTypes' | 'routing'

interface NavItem {
  href: string
  slug: NavSlug
  icon: typeof ClipboardList
  color: string
  matchPattern?: string
}

const OPS_ITEMS: NavItem[] = [
  { href: '/ops/chats', slug: 'chats', icon: MessageSquare, color: '#6366f1', matchPattern: '/ops/chats' },
  { href: '/ops/human-tasks', slug: 'humanTasks', icon: ClipboardList, color: '#f0b050' },
  { href: '/ops/cases', slug: 'cases', icon: FolderOpen, color: '#5b8af7', matchPattern: '/ops/cases' },
  { href: '/ops/guide', slug: 'guide', icon: BookOpen, color: '#8b6ff5', matchPattern: '/ops/guide' },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/agent', slug: 'agentConfig', icon: Bot, color: '#2ea04a' },
  { href: '/admin/skills', slug: 'skills', icon: Puzzle, color: '#5b8af7' },
  { href: '/admin/policies', slug: 'policies', icon: Shield, color: '#e64539' },
  { href: '/admin/case-types', slug: 'caseTypes', icon: Layers, color: '#d4912e' },
  { href: '/admin/routing', slug: 'routing', icon: GitBranch, color: '#5bb8f7' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPattern) return pathname.startsWith(item.matchPattern)
  return pathname === item.href
}

function navLabel(t: TranslateFn, slug: NavSlug): string {
  return t(`sidebar.${slug}`)
}

export default function ConsoleSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const { t, toggleLocale, locale } = useConsoleLocale()

  const langButtonLabel = locale === 'en' ? t('sidebar.switchToZh') : t('sidebar.switchToEn')

  return (
    <aside
      className={`relative z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-out
        bg-white/50 backdrop-blur-2xl border-r border-black/5
        ${collapsed ? 'w-14' : 'w-56'} h-full`}
    >
      <div className="relative z-30 flex-shrink-0 border-b border-black/[0.05] pb-3 pt-3">
        {collapsed ? (
          <div className="flex flex-col items-center px-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex w-full flex-col items-center gap-2 rounded-xl p-3 text-[var(--fog)] transition-colors hover:bg-black/[0.04] hover:text-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25 focus-visible:ring-offset-2"
              aria-label={t('sidebar.expandAria')}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
                <User className="h-4 w-4 text-indigo" />
              </div>
              <ChevronRight className="h-4 w-4 opacity-75" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2">
            <button
              type="button"
              onClick={() => setAvatarOpen(!avatarOpen)}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 hover:bg-black/5 transition-all"
              aria-expanded={avatarOpen}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
                <User className="h-4 w-4 text-indigo" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-[12px] font-medium text-[var(--mist)]">{t('shell.adminUser')}</p>
                <p className="truncate text-[10px] text-[var(--fog)]">{t('shell.demoVendor')}</p>
              </div>
              <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--fog)] transition-transform ${avatarOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="console-sidebar-toggle"
              aria-expanded
              aria-label={t('sidebar.collapseAria')}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </div>
        )}

        {avatarOpen && !collapsed && (
          <div className="mt-1 ml-10 space-y-0.5 animate-fade-up">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
            >
              <Building2 className="w-3 h-3" /> {t('sidebar.switchProject')}
            </button>
            <button
              type="button"
              onClick={() => toggleLocale()}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
              title={t('sidebar.language')}
            >
              <Languages className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{langButtonLabel}</span>
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/5 rounded-lg transition-all"
            >
              <LogOut className="w-3 h-3" /> {t('sidebar.signOut')}
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-4 overflow-y-auto scroll-thin">
        <NavGroup label={t('sidebar.ops')} items={OPS_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
        <NavGroup label={t('sidebar.admin')} items={ADMIN_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
      </nav>

      <div className="px-3 pb-3 pt-2 border-t border-black/5">
        {!collapsed ? (
          <p className="text-[10px] text-[var(--fog)] font-mono px-2">{t('shell.version')}</p>
        ) : (
          <div className="w-3 h-3 mx-auto rounded-full bg-black/5" />
        )}
      </div>
    </aside>
  )
}

function NavGroup({
  label,
  items,
  pathname,
  collapsed,
  t,
}: {
  label: string
  items: NavItem[]
  pathname: string
  collapsed: boolean
  t: TranslateFn
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
          const itemLabel = navLabel(t, item.slug)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? itemLabel : undefined}
              className={`flex items-center rounded-lg transition-all duration-200 group relative ${
                collapsed ? 'justify-center py-2.5 px-0' : 'gap-2.5 px-2.5 py-2'
              } ${
                active
                  ? 'bg-black/[0.04]'
                  : 'hover:bg-black/[0.02]'
              }`}
            >
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
                  {itemLabel}
                </span>
              )}

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
