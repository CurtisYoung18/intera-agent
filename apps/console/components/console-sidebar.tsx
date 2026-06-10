'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAgentContext } from '@/lib/agent/agent-context'
import type { TranslateFn } from '@/lib/i18n/types'
import {
  ClipboardList, Puzzle, Shield, Layers,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
  Globe, Lock, Unlock, ArrowRightLeft,
  MessageSquare,
  Search,
  Loader2,
  Plug,
  Users2,
  FlaskConical,
  TestTubeDiagonal,
  Settings,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import InteraLogo from '@intera/shared/ui/intera-logo'
import AgentManagementDrawer from '@/components/admin/agent-management-drawer'
import AgentVersionPicker from '@/components/admin/agent-version-picker'

interface NavItem {
  href: string
  slug: NavSlug
  icon: typeof ClipboardList
  color: string
  matchPattern?: string
  badge?: string
}

interface CustomerInfo {
  id: string
  name: string
  hasPassword: boolean
  hasApiKey: boolean
}

/**
 * Console IA route map.
 */

type NavSlug =
  | 'release'
  | 'pilotLab'
  | 'components'
  | 'brain'
  | 'caseTypes'
  | 'tools'
  | 'hooks'
  | 'knowledge'
  | 'integrations'
  | 'chats'
  | 'users'
  | 'organization'

const BUILD_ITEMS: NavItem[] = [
  { href: '/build/pilot-lab', slug: 'pilotLab', icon: TestTubeDiagonal, color: '#357f7c', matchPattern: '/build/pilot-lab' },
  { href: '/build/release', slug: 'release', icon: FlaskConical, color: '#8b6ff5', matchPattern: '/build/release' },
  { href: '/build/components', slug: 'components', icon: Layers, color: '#5b8af7', matchPattern: '/build/components' },
]

const OPERATE_ITEMS: NavItem[] = [
  { href: '/operate/conversations', slug: 'chats', icon: MessageSquare, color: '#6366f1', matchPattern: '/operate/conversations' },
  { href: '/operate/handoff', slug: 'users', icon: Users2, color: '#8b6ff5', matchPattern: '/operate/handoff' },
]

const SETTINGS_ITEMS: NavItem[] = [
  { href: '/settings/organization', slug: 'organization', icon: Building2, color: '#6366f1', matchPattern: '/settings/organization' },
]

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPattern) return pathname.startsWith(item.matchPattern)
  return pathname === item.href
}

function navLabel(t: (key: string, vars?: Record<string, string | number>) => string, slug: NavSlug): string {
  const fallback: Record<NavSlug, string> = {
    release: t('sidebar.release'),
    pilotLab: t('sidebar.pilotLab'),
    components: t('sidebar.components'),
    brain: t('sidebar.brain'),
    caseTypes: t('sidebar.procedures'),
    tools: t('sidebar.tools'),
    hooks: t('sidebar.hooks'),
    knowledge: t('sidebar.knowledge'),
    integrations: t('sidebar.integrations'),
    chats: t('sidebar.conversations'),
    users: t('sidebar.handoff'),
    organization: t('sidebar.organization'),
  }
  return fallback[slug]
}

function CollapsedSidebarMark() {
  return (
    <svg viewBox="0 0 64 64" className="h-7 w-7 flex-shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="sidebarCollapsedMark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1b2c33" />
          <stop offset="0.5" stopColor="#2f8f99" />
          <stop offset="1" stopColor="#7fcdd4" />
        </linearGradient>
      </defs>
      <path
        d="M39.7 50.7A20.5 20.5 0 1 1 50.2 41.3"
        stroke="url(#sidebarCollapsedMark)"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="29" y="29" width="6.4" height="14.8" rx="3.2" fill="#1f3138" />
      <circle cx="32.2" cy="22.2" r="3.8" fill="#14b8a6" />
    </svg>
  )
}

export default function ConsoleSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const { t, toggleLocale, locale } = useConsoleLocale()
  const { selectedAgentId, selectAgent, refreshConfigs } = useAgentContext()

  // Session state
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)

  const [customerName, setCustomerName] = useState('Test')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
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
        const p = d.data || d
        if (p.customerName) setCustomerName(p.customerName)
        setAvatarUrl(typeof p.avatarUrl === 'string' && p.avatarUrl ? p.avatarUrl : null)
        setAvatarLoadFailed(false)
        setIsStaff(p.isAuthenticated === true)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const collapseForNarrowViewport = () => {
      if (media.matches) setCollapsed(true)
    }

    collapseForNarrowViewport()
    media.addEventListener('change', collapseForNarrowViewport)
    return () => media.removeEventListener('change', collapseForNarrowViewport)
  }, [])

  const handleAgentSelect = (id: string) => {
    selectAgent(id)
  }

  // Load customer list
  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true)
    try {
      const data = await fetch('/api/admin/customers').then(r => r.json()).then(d => d.data || d)
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
    // Staff switch freely — no per-org password (they're already authenticated as staff).
    doSwitch(customer.id)
  }

  const doSwitch = async (orgId: string) => {
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPasswordError((typeof data.error === 'string' ? data.error : data.error?.message) || 'Switch failed')
        return
      }
      setSwitchOpen(false)
      setPasswordTarget(null)
      setPassword('')
      setAvatarOpen(false)
      // Full page reload to pick up the new session cookie on the server side.
      window.location.href = window.location.pathname
    } catch {
      setPasswordError('Network error — try again')
    }
  }

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.reload()
  }

  const showAvatarImage = Boolean(avatarUrl && !avatarLoadFailed)

  return (
    <>
      <aside
        className={`relative z-20 flex min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-out
          border-r border-white/75 bg-[rgba(255,252,246,0.78)] shadow-[0_18px_48px_rgba(21,23,25,0.07),inset_-1px_0_0_rgba(255,255,255,0.58)] backdrop-blur-[24px]
          ${collapsed ? 'w-14' : 'w-56'} h-full`}
      >
        <div className="relative z-30 flex-shrink-0 border-b border-black/[0.045] bg-white/[0.14] pb-3 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          {collapsed ? (
            <div className="flex flex-col items-center px-2">
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="flex w-full flex-col items-center gap-2 rounded-[18px] border border-white/70 bg-white/80 p-3 text-[var(--fog)] shadow-[0_8px_20px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25 focus-visible:ring-offset-2"
                aria-label={t('sidebar.expandAria')}
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
                  <CollapsedSidebarMark />
                </div>
                <ChevronRight className="h-4 w-4 opacity-75" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[22px] border border-white/60 bg-white/[0.68] px-3 py-2.5 shadow-[0_10px_24px_rgba(21,23,25,0.04),inset_0_1px_0_rgba(255,255,255,0.58)]">
                <InteraLogo size={26} mode="idle" />
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="console-sidebar-toggle flex-shrink-0 border border-white/75 bg-white/[0.88] shadow-[0_8px_18px_rgba(21,23,25,0.06),inset_0_1px_0_rgba(255,255,255,0.72)]"
                aria-expanded
                aria-label={t('sidebar.collapseAria')}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
          )}
        </div>

        {/* Agent switcher — always visible below logo */}
        {!collapsed && (
          <div className="flex-shrink-0 border-b border-black/[0.04] px-3 py-3">
            <div className="flex items-center gap-2.5 rounded-[24px] border border-white/70 bg-white/[0.76] px-3 py-2.5 shadow-[0_12px_28px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.62)]">
              <div className="flex-1 min-w-0">
                <AgentVersionPicker
                  agentId={selectedAgentId}
                  onChange={handleAgentSelect}
                  onAgentsChanged={refreshConfigs}
                />
              </div>
              <button
                type="button"
                onClick={() => setAgentDrawerOpen(true)}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[16px] border border-white/65 bg-white/[0.72] text-[var(--fog)] shadow-[0_4px_10px_rgba(21,23,25,0.04)] transition-colors hover:bg-white hover:text-[var(--mist)]"
                title={t('sidebar.openAgents')}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4 scroll-thin">
          <NavGroup label={t('sidebar.build')} items={BUILD_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
          <NavGroup label={t('sidebar.operate')} items={OPERATE_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
          <NavGroup label={t('sidebar.settings')} items={SETTINGS_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
        </nav>

        <div className="border-t border-black/5 bg-white/[0.14] px-3 pb-2 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
          {/* Controls panel — opens upward from bottom */}
          {avatarOpen && !collapsed && (
            <div className="mb-3 rounded-[22px] border border-white/70 bg-white/[0.92] p-2 shadow-[0_16px_40px_rgba(21,23,25,0.12),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl">
              <button
                type="button"
                onClick={() => toggleLocale()}
                className="flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-[14px] font-medium text-[var(--mist)] transition-colors hover:bg-black/[0.035]"
              >
                <Globe className="h-4 w-4 flex-shrink-0 text-[var(--fog)]" />
                <span className="truncate">{langButtonLabel}</span>
              </button>

              {isStaff && (
                <button
                  type="button"
                  onClick={handleSwitchClick}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-[14px] font-medium text-[var(--mist)] transition-colors hover:bg-black/[0.035]"
                >
                  <ArrowRightLeft className="h-4 w-4 flex-shrink-0 text-[var(--fog)]" />
                  <span className="truncate">{t('sidebar.switchProject')}</span>
                </button>
              )}

              {isStaff && switchOpen && (
                <div className="mt-2 rounded-[18px] border border-black/[0.04] bg-[rgba(247,247,243,0.9)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  {customersLoading ? (
                    <div className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] text-[var(--fog)]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    customers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCustomerSelect(c)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12px] text-[var(--fog)] transition-colors hover:bg-white hover:text-[var(--mist)]"
                      >
                        {c.hasPassword ? (
                          <Lock className="h-3.5 w-3.5 flex-shrink-0 text-amber" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5 flex-shrink-0 text-teal-500/60" />
                        )}
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleSignOut}
                className="mt-1 flex w-full items-center gap-3 rounded-[16px] px-3.5 py-3 text-[14px] font-medium text-[#f05645] transition-colors hover:bg-[#f05645]/[0.07]"
              >
                <LogOut className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{t('sidebar.signOut')}</span>
              </button>
            </div>
          )}

          {/* Bottom bar — always visible */}
          <button
            type="button"
            onClick={() => { setAvatarOpen(!avatarOpen); setSwitchOpen(false) }}
            className={`flex w-full items-center gap-2.5 rounded-[18px] border bg-white/[0.84] shadow-[0_10px_24px_rgba(21,23,25,0.08),inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl transition-all ${
              avatarOpen
                ? 'border-[rgba(53,127,124,0.16)] bg-white'
                : 'border-white/75 hover:bg-white'
            } ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}`}
            aria-expanded={avatarOpen}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-black/[0.05] bg-white shadow-[0_1px_2px_rgba(21,23,25,0.05)]">
              {showAvatarImage ? (
                // Google profile images are external and can fail independently, so we keep
                // the current icon as a graceful fallback.
                <img
                  src={avatarUrl!}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <User className="h-3.5 w-3.5 text-[var(--color-accent-primary)]" />
              )}
            </div>
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left text-[13px] font-medium text-[var(--mist)]">{customerName}</span>
                <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--fog)] transition-transform ${avatarOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>

          {!collapsed && (
            <p className="px-1.5 pt-1 text-[10px] font-mono text-[var(--fog)]/45">{t('shell.version')}</p>
          )}
        </div>
      </aside>

      <AgentManagementDrawer
        open={agentDrawerOpen}
        onClose={() => setAgentDrawerOpen(false)}
        activeAgentId={selectedAgentId}
        onSelectAgent={handleAgentSelect}
        onAgentsChanged={refreshConfigs}
      />
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
        <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--mist)]/70">
          {label}
        </p>
      )}
      <div className="space-y-1.5">
        {items.map(item => {
          const active = isActive(pathname, item)
          const itemLabel = navLabel(t, item.slug)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? itemLabel : undefined}
              className={`group relative flex items-center rounded-[18px] border transition-all duration-200 ${
                collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3.5 py-3'
              } ${
                active
                  ? 'border-white/80 bg-white/[0.88] shadow-[0_10px_24px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.62)]'
                  : 'border-transparent bg-transparent hover:border-white/60 hover:bg-white/[0.58] hover:shadow-[0_8px_20px_rgba(21,23,25,0.03)]'
              }`}
            >
              {active && !collapsed && (
                <div
                  className="absolute left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full opacity-85"
                  style={{ background: `linear-gradient(180deg, ${item.color}, color-mix(in srgb, ${item.color} 48%, white))` }}
                />
              )}

              {active && collapsed && (
                <div
                  className="absolute inset-x-1.5 top-1/2 h-11 -translate-y-1/2 rounded-[16px] border border-white/80 bg-white/[0.92] shadow-[0_10px_22px_rgba(21,23,25,0.06),inset_0_1px_0_rgba(255,255,255,0.7)]"
                  style={{ backgroundColor: `color-mix(in srgb, ${item.color} 8%, white)` }}
                />
              )}

              <div className={`relative z-10 flex items-center justify-center ${collapsed ? 'h-9 w-9 rounded-[14px]' : ''}`}>
                <item.icon
                  className="h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
                  style={{ color: active ? item.color : 'var(--fog)', opacity: active ? 1 : 0.62 }}
                  strokeWidth={active ? 2 : 1.5}
                />
              </div>

              {!collapsed && (
                <span className={`whitespace-nowrap text-[14px] transition-colors ${
                  active ? 'text-[var(--mist)] font-medium' : 'text-[var(--fog)]'
                }`}>
                  {itemLabel}
                  {item.badge && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-indigo/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo">
                      {item.badge}
                    </span>
                  )}
                </span>
              )}

            </Link>
          )
        })}
      </div>
    </div>
  )
}
