'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ClipboardList, FolderOpen, Bot, Puzzle, Shield, Layers, GitBranch,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
  Languages, Lock, Unlock,
  BookOpen,
  MessageSquare,
  Search,
  Loader2,
  XCircle,
  Plug,
  HandPlatter,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { TranslateFn } from '@/lib/i18n/types'

type NavSlug = 'humanTasks' | 'chats' | 'guide' | 'agentConfig' | 'skills' | 'policies' | 'humanOps' | 'caseTypes' | 'routing' | 'knowledge' | 'integrations'

interface NavItem {
  href: string
  slug: NavSlug
  icon: typeof ClipboardList
  color: string
  matchPattern?: string
}

interface CustomerInfo {
  id: string
  name: string
  hasPassword: boolean
  hasApiKey: boolean
}

/**
 * Console route map (purpose, not just label):
 *
 * OPS — day-to-day:
 *   /ops/chats         Live conversation viewer + per-case trace.
 *   /ops/human-tasks   Queue of escalations awaiting human action.
 *   /ops/guide         Operator onboarding / runbook.
 *
 * ADMIN — configuration:
 *   /admin/agent           Agent blueprint (prompt, model, memory, guardrail-summary,
 *                          sub-agent-summary, human-ops, knowledge). Single-customer scope.
 *   /admin/skills          System (read-only 7) + Special (kb_hybrid_retrieve) + Business skills.
 *   /admin/policies        Guardrails canonical editor (sentence-builder + advanced JSON).
 *                          Agent-config "Guardrails" satellite is a read-only mirror.
 *   /admin/case-types      Stage / SOP definitions, sub-agent configuration.
 *                          Agent-config "Sub-Agents" satellite is a read-only mirror.
 *   /admin/routing         Channel → case-type routing rules.
 *   /admin/knowledge       Knowledge sources + GPTBots API key + retrieval params.
 *                          Mirrored from agent-config "Knowledge" satellite.
 *   /admin/human-ops       Consultation prompt + human skills allowed list.
 *                          Mirrored from agent-config "Human Ops" satellite.
 *   /admin/integrations    Channel integrations (LiveChat active; Slack/Discord placeholders).
 */

const OPS_ITEMS: NavItem[] = [
  { href: '/ops/chats', slug: 'chats', icon: MessageSquare, color: '#6366f1', matchPattern: '/ops/chats' },
  { href: '/ops/human-tasks', slug: 'humanTasks', icon: ClipboardList, color: '#f0b050' },
  { href: '/ops/guide', slug: 'guide', icon: BookOpen, color: '#8b6ff5', matchPattern: '/ops/guide' },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/agent', slug: 'agentConfig', icon: Bot, color: '#2ea04a' },
  { href: '/admin/skills', slug: 'skills', icon: Puzzle, color: '#5b8af7' },
  { href: '/admin/policies', slug: 'policies', icon: Shield, color: '#e64539' },
  { href: '/admin/human-ops', slug: 'humanOps', icon: HandPlatter, color: '#5bb8f7' },
  { href: '/admin/case-types', slug: 'caseTypes', icon: Layers, color: '#d4912e' },
  { href: '/admin/routing', slug: 'routing', icon: GitBranch, color: '#5bb8f7' },
  { href: '/admin/knowledge', slug: 'knowledge', icon: Search, color: '#14b8a6' },
  { href: '/admin/integrations', slug: 'integrations', icon: Plug, color: '#7c3aed' },
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
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const { t, toggleLocale, locale } = useConsoleLocale()

  // Session state
  const [customerName, setCustomerName] = useState('Demo Vendor')
  const [customers, setCustomers] = useState<CustomerInfo[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)

  // Password modal
  const [passwordTarget, setPasswordTarget] = useState<CustomerInfo | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  const langButtonLabel = locale === 'en' ? t('sidebar.switchToZh') : t('sidebar.switchToEn')

  // Load session on mount
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => {
        if (d.customerName) setCustomerName(d.customerName)
      })
      .catch(() => {})
  }, [])

  // Load customer list
  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true)
    try {
      const res = await fetch('/api/admin/customers')
      const data = await res.json()
      setCustomers(data.customers || [])
    } catch {
      // ignore
    } finally {
      setCustomersLoading(false)
    }
  }, [])

  // Handle customer switch
  const handleSwitchClick = () => {
    setSwitchOpen(!switchOpen)
    if (!switchOpen) loadCustomers()
  }

  const handleCustomerSelect = (customer: CustomerInfo) => {
    if (customer.hasPassword) {
      setPasswordTarget(customer)
      setPassword('')
      setPasswordError('')
    } else {
      doSwitch(customer.id)
    }
  }

  const doSwitch = async (customerId: string, pwd?: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, password: pwd || '' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPasswordError(data.error || 'Login failed')
        return
      }
      setSwitchOpen(false)
      setPasswordTarget(null)
      setPassword('')
      setAvatarOpen(false)
      // Full page reload to pick up new cookie on server side
      window.location.href = window.location.pathname
    } catch {
      setPasswordError('Network error — try again')
    }
  }

  const handlePasswordSubmit = () => {
    if (!passwordTarget) return
    setPasswordLoading(true)
    doSwitch(passwordTarget.id, password)
    setPasswordLoading(false)
  }

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  return (
    <>
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
                onClick={() => { setAvatarOpen(!avatarOpen); setSwitchOpen(false) }}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 hover:bg-black/5 transition-all"
                aria-expanded={avatarOpen}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
                  <User className="h-4 w-4 text-indigo" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-medium text-[var(--mist)]">{t('shell.adminUser')}</p>
                  <p className="truncate text-[10px] text-[var(--fog)]">{customerName}</p>
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
                onClick={handleSwitchClick}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
              >
                <Building2 className="w-3 h-3" /> {t('sidebar.switchProject')}
              </button>

              {/* Customer list inline */}
              {switchOpen && (
                <div className="ml-4 py-1 space-y-0.5 border-l border-black/[0.06] pl-2">
                  {customersLoading ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--fog)] py-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                    </div>
                  ) : (
                    customers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCustomerSelect(c)}
                        className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.03] rounded-md transition-all text-left"
                      >
                        {c.hasPassword ? (
                          <Lock className="w-3 h-3 text-amber flex-shrink-0" />
                        ) : (
                          <Unlock className="w-3 h-3 text-teal-500/60 flex-shrink-0" />
                        )}
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

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
                onClick={handleSignOut}
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

      {/* Password Modal */}
      {passwordTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[25vh] bg-black/20 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setPasswordTarget(null); setPasswordError('') } }}
        >
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-black/[0.08] bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
              <h3 className="text-[14px] font-bold text-[var(--mist)]">
                Login to {passwordTarget.name}
              </h3>
              <button
                onClick={() => { setPasswordTarget(null); setPasswordError('') }}
                className="p-1 rounded-lg hover:bg-black/[0.04]"
              >
                <XCircle className="w-5 h-5 text-[var(--fog)]" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePasswordSubmit() }}
                  autoFocus
                  placeholder="Enter password"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] text-[var(--mist)] outline-none focus:border-indigo/30"
                />
              </div>
              {passwordError && (
                <p className="text-[11px] text-red-500">{passwordError}</p>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-black/[0.06]">
              <button
                onClick={() => { setPasswordTarget(null); setPasswordError('') }}
                className="flex-1 px-4 py-2 rounded-lg border border-black/[0.08] text-[12px] text-[var(--fog)] hover:bg-black/[0.02] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordSubmit}
                disabled={passwordLoading || !password}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo text-white text-[12px] font-semibold hover:bg-indigo/90 transition-colors disabled:opacity-40"
              >
                {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Login'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
