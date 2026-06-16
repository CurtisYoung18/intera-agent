'use client'

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAgentContext } from '@/lib/agent/agent-context'
import type { TranslateFn } from '@/lib/i18n/types'
import {
  Layers,
  type LucideIcon,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
  Globe, Lock, Unlock, ArrowRightLeft,
  MessageSquare,
  Loader2,
  Users2,
  FlaskConical,
  TestTubeDiagonal,
  SlidersHorizontal,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import InteraLogo from '@intera/shared/ui/intera-logo'
import AgentManagementDrawer from '@/components/admin/agent-management-drawer'
import { ConsoleSurface } from '@/components/ui/console-chrome'

interface NavItem {
  href: string
  slug: NavSlug
  icon: LucideIcon
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
  { href: '/build/release', slug: 'release', icon: FlaskConical, color: '#5f7f78', matchPattern: '/build/release' },
  { href: '/build/components', slug: 'components', icon: Layers, color: '#628595', matchPattern: '/build/components' },
]

const OPERATE_ITEMS: NavItem[] = [
  { href: '/operate/conversations', slug: 'chats', icon: MessageSquare, color: '#5d7487', matchPattern: '/operate/conversations' },
  { href: '/operate/handoff', slug: 'users', icon: Users2, color: '#7d7a63', matchPattern: '/operate/handoff' },
]

const SETTINGS_ITEMS: NavItem[] = [
  { href: '/settings/organization', slug: 'organization', icon: Building2, color: '#6a746b', matchPattern: '/settings/organization' },
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

type NavDensity = 'default' | 'compact' | 'tight'

export default function ConsoleSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const { t, toggleLocale, locale } = useConsoleLocale()
  const { selectedAgentId, selectAgent, refreshConfigs, agentConfigs } = useAgentContext()

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
  const selectedAgent =
    agentConfigs.find((config) => config.id === selectedAgentId) ??
    agentConfigs.find((config) => config.isActive) ??
    agentConfigs[0] ??
    null

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
  const navDensity: NavDensity = avatarOpen ? (switchOpen ? 'tight' : 'compact') : 'default'

  return (
    <>
      <aside
        className="console-sidebar"
        data-collapsed={collapsed}
      >
        <div className="console-sidebar-header flex-shrink-0 pb-3 pt-3">
          {collapsed ? (
            <div className="px-2">
              <ConsoleSurface tone="toolbar" padding="sm" className="flex flex-col items-center gap-2">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
                  <CollapsedSidebarMark />
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="console-sidebar-toggle"
                  aria-label={t('sidebar.expandAria')}
                >
                  <ChevronRight className="h-4 w-4 opacity-75" strokeWidth={2.25} aria-hidden />
                </button>
              </ConsoleSurface>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3">
              <ConsoleSurface tone="toolbar" padding="sm" className="flex min-w-0 flex-1 items-center gap-2.5">
                <InteraLogo size={26} mode="idle" />
              </ConsoleSurface>
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
        </div>

        {/* Agent switcher — always visible below logo */}
        {collapsed && (
          <div className="flex-shrink-0 border-b border-black/[0.04] px-2 py-3">
            <button
              type="button"
              onClick={() => setAgentDrawerOpen(true)}
              className="flex w-full flex-col items-center gap-1.5 rounded-[18px] border border-white/75 bg-white/[0.78] px-2 py-2.5 text-center shadow-[0_10px_20px_rgba(21,23,25,0.06),inset_0_1px_0_rgba(255,255,255,0.68)] transition hover:border-[rgba(53,127,124,0.22)] hover:bg-white/[0.94]"
              title={t('sidebar.openAgents')}
              aria-label={t('sidebar.openAgents')}
            >
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${
                  selectedAgent?.isActive ? 'bg-[var(--color-signal-success)]' : 'bg-[var(--color-signal-warning)]'
                }`}
              />
              <span className="max-w-full truncate text-[12px] font-semibold leading-4 text-[var(--color-text-primary)]">
                {selectedAgent?.name ?? t('common.loading')}
              </span>
              {selectedAgent ? (
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                  selectedAgent.isActive
                    ? 'border-[rgba(111,158,114,0.26)] bg-[rgba(111,158,114,0.12)] text-[var(--color-signal-success)]'
                    : 'border-[rgba(213,150,61,0.28)] bg-[rgba(213,150,61,0.13)] text-[var(--color-signal-warning)]'
                }`}>
                  v{selectedAgent.version}
                </span>
              ) : null}
            </button>
          </div>
        )}
        {!collapsed && (
          <div className="flex-shrink-0 border-b border-black/[0.04] px-3 py-3">
            <div className="mb-2 flex items-center gap-2 px-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">
                {t('sidebar.currentAgent')}
              </span>
              <span className="h-px flex-1 bg-black/[0.04]" />
            </div>
            <ConsoleSurface tone="toolbar" padding="sm" className="flex items-stretch gap-2 rounded-[22px]">
              <button
                type="button"
                onClick={() => setAgentDrawerOpen(true)}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-white/75 bg-white/[0.74] px-3 py-3 text-left shadow-[0_10px_22px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.68)] transition hover:border-[rgba(53,127,124,0.22)] hover:bg-white/[0.94]"
                aria-label={t('sidebar.openAgents')}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        selectedAgent?.isActive ? 'bg-[var(--color-signal-success)]' : 'bg-[var(--color-signal-warning)]'
                      }`}
                    />
                    <span className="min-w-0 truncate text-[16px] font-semibold leading-5 text-[var(--color-text-primary)]">
                      {selectedAgent?.name ?? t('common.loading')}
                    </span>
                    {selectedAgent ? (
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        selectedAgent.isActive
                          ? 'border-[rgba(111,158,114,0.26)] bg-[rgba(111,158,114,0.12)] text-[var(--color-signal-success)]'
                          : 'border-[rgba(213,150,61,0.28)] bg-[rgba(213,150,61,0.13)] text-[var(--color-signal-warning)]'
                      }`}>
                        v{selectedAgent.version}
                      </span>
                    ) : null}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)] transition group-hover:text-[var(--color-accent-primary)]" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => setAgentDrawerOpen(true)}
                className="flex w-12 flex-shrink-0 items-center justify-center rounded-[18px] border border-white/75 bg-white/[0.7] text-[var(--color-text-secondary)] shadow-[0_8px_16px_rgba(21,23,25,0.04)] transition-colors hover:bg-white hover:text-[var(--color-accent-primary)]"
                title={t('sidebar.openAgents')}
                aria-label={t('sidebar.openAgents')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </ConsoleSurface>
          </div>
        )}

        <nav
          className={`flex-1 overflow-y-auto px-3 scroll-thin transition-[padding] duration-200 ${
            navDensity === 'tight'
              ? 'space-y-2 py-2'
              : navDensity === 'compact'
                ? 'space-y-3 py-2.5'
                : 'space-y-4 py-4'
          }`}
        >
          <NavGroup label={t('sidebar.build')} items={BUILD_ITEMS} pathname={pathname} collapsed={collapsed} density={navDensity} t={t} />
          <NavGroup label={t('sidebar.operate')} items={OPERATE_ITEMS} pathname={pathname} collapsed={collapsed} density={navDensity} t={t} />
          <NavGroup label={t('sidebar.settings')} items={SETTINGS_ITEMS} pathname={pathname} collapsed={collapsed} density={navDensity} t={t} />
        </nav>

        <div className="mt-auto flex-shrink-0 border-t border-black/5 bg-white/[0.14] px-3 pb-3 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
          {/* Controls panel — opens upward from bottom */}
          {avatarOpen && !collapsed && (
            <ConsoleSurface tone="floating" padding="sm" className="mb-3 max-h-[min(56vh,28rem)] overflow-y-auto rounded-[22px]">
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
                <div className="mt-2 rounded-[18px] border border-white/80 bg-white/[0.7] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
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
            </ConsoleSurface>
          )}

          {/* Bottom bar — always visible */}
          <button
            type="button"
            onClick={() => { setAvatarOpen(!avatarOpen); setSwitchOpen(false) }}
            className={`flex w-full items-center gap-2.5 rounded-[18px] border shadow-[0_10px_24px_rgba(21,23,25,0.08),inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-xl transition-all ${
              avatarOpen
                ? 'border-[rgba(53,127,124,0.16)] bg-white/[0.96]'
                : 'border-white/75 bg-white/[0.82] hover:bg-white/[0.94]'
            } ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}`}
            aria-expanded={avatarOpen}
            aria-label={customerName}
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
  density,
  t,
}: {
  label: string
  items: NavItem[]
  pathname: string
  collapsed: boolean
  density: NavDensity
  t: TranslateFn
}) {
  return (
    <div>
      {!collapsed && (
        <p className="console-sidebar-section-label" data-density={density}>
          {label}
        </p>
      )}
      <div className="console-sidebar-nav" data-density={density}>
        {items.map(item => {
          const active = isActive(pathname, item)
          const itemLabel = navLabel(t, item.slug)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? itemLabel : undefined}
              aria-label={itemLabel}
              className="console-sidebar-link group"
              data-active={active}
              data-collapsed={collapsed}
              data-density={density}
              style={{ '--console-nav-accent': item.color } as CSSProperties}
            >
              <div className="console-sidebar-link-icon">
                <item.icon
                  className="h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
                  style={{ color: active ? item.color : 'var(--fog)', opacity: active ? 1 : 0.62 }}
                  strokeWidth={active ? 2 : 1.5}
                />
              </div>

              {!collapsed && (
                <span className="console-sidebar-link-label">
                  {itemLabel}
                  {item.badge && (
                    <span className="console-sidebar-link-badge ml-1.5">
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
