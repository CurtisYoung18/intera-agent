'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAgentContext } from '@/lib/agent/agent-context'
import {
  ClipboardList, FolderOpen, Bot, Puzzle, Shield, Layers,
  User, ChevronDown, LogOut, Building2, ChevronLeft, ChevronRight,
  Languages, Lock, Unlock,
  BookOpen,
  MessageSquare,
  Search,
  Loader2,
  BarChart3,
  Plug,
  HandPlatter,
  Users2,
  FlaskConical,
  Key,
  GitBranch,
  Settings,
  Brain,
  Database,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { TranslateFn } from '@/lib/i18n/types'
import InteraLogo from '@intera/shared/ui/intera-logo'
import AgentManagementDrawer from '@/components/admin/agent-management-drawer'
import AgentVersionPicker from '@/components/admin/agent-version-picker'

type NavSlug = 'playground' | 'chats' | 'users' | 'dashboards' | 'guide' | 'agentConfig' | 'tools' | 'guardrails' | 'caseTypes' | 'knowledge' | 'channels' | 'apiKeys' | 'model' | 'memory' | 'members'

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
 *   /admin/knowledge       Knowledge sources + GPTBots API key + retrieval params.
 *                          Mirrored from agent-config "Knowledge" satellite.
 *   /admin/integrations    Channel integrations (LiveChat active; Slack/Discord placeholders).
 */

const BUILD_ITEMS: NavItem[] = [
  { href: '/admin/playground', slug: 'playground', icon: FlaskConical, color: '#8b6ff5' },
  { href: '/admin/agent', slug: 'agentConfig', icon: Bot, color: '#2ea04a' },
  { href: '/admin/model', slug: 'model' as NavSlug, icon: Brain, color: '#8b6ff5' },
  { href: '/admin/memory', slug: 'memory' as NavSlug, icon: Database, color: '#d4912e' },
  { href: '/admin/guardrails', slug: 'guardrails', icon: Shield, color: '#e64539' },
  { href: '/admin/tools', slug: 'tools', icon: Puzzle, color: '#5b8af7' },
  { href: '/admin/case-types', slug: 'caseTypes', icon: Layers, color: '#d4912e' },
  { href: '/admin/knowledge', slug: 'knowledge', icon: Search, color: '#14b8a6' },
  { href: '/admin/channels', slug: 'channels', icon: Plug, color: '#7c3aed' },
  { href: '/admin/api-keys', slug: 'apiKeys', icon: Key, color: '#d4912e' },
]

const OPERATE_ITEMS: NavItem[] = [
  { href: '/ops/dashboards', slug: 'dashboards', icon: BarChart3, color: '#14b8a6', matchPattern: '/ops/dashboards' },
  { href: '/ops/chats', slug: 'chats', icon: MessageSquare, color: '#6366f1', matchPattern: '/ops/chats' },
  { href: '/ops/users', slug: 'users', icon: Users2, color: '#8b6ff5', matchPattern: '/ops/users' },
  { href: '/ops/guide', slug: 'guide', icon: BookOpen, color: '#8b6ff5', matchPattern: '/ops/guide' },
  { href: '/admin/members', slug: 'members', icon: Users2, color: '#6366f1' },
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
  const { selectedAgentId, selectAgent, refreshConfigs } = useAgentContext()

  // Session state
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)

  const [customerName, setCustomerName] = useState('Test')
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
        if (d.customerName) setCustomerName(d.customerName)
        setIsStaff(d.isAuthenticated === true)
      })
      .catch(() => {})
  }, [])

  const handleAgentSelect = (id: string) => {
    selectAgent(id)
    if (pathname.startsWith('/admin/agent')) {
      router.push(`/admin/agent?agentId=${id}`)
    }
  }

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
                  <InteraLogo size={15} collapsed mode="none" />
                </div>
                <ChevronRight className="h-4 w-4 opacity-75" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2">
              <div className="flex items-center gap-2.5 px-2 pt-1 flex-1 min-w-0">
                <InteraLogo size={26} mode="idle" />
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="console-sidebar-toggle flex-shrink-0"
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
          <div className="flex-shrink-0 px-3 py-2 border-b border-black/[0.04]">
            <div className="flex items-center gap-1.5">
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
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/[0.05] text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
                title={t('sidebar.openAgents')}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 py-2 px-2 space-y-4 overflow-y-auto scroll-thin">
          <NavGroup label={t('sidebar.build')} items={BUILD_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
          <NavGroup label={t('sidebar.operate')} items={OPERATE_ITEMS} pathname={pathname} collapsed={collapsed} t={t} />
        </nav>

        <div className="border-t border-black/5">
          {/* Controls panel — opens upward from bottom */}
          {avatarOpen && !collapsed && (
            <div className="px-3 pt-2 pb-1 space-y-0.5 border-b border-black/[0.04]">
              <button
                type="button"
                onClick={() => toggleLocale()}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
              >
                <Languages className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{langButtonLabel}</span>
              </button>

              {isStaff && (
              <button
                type="button"
                onClick={handleSwitchClick}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/5 rounded-lg transition-all"
              >
                <Building2 className="w-3 h-3 flex-shrink-0" /> {t('sidebar.switchProject')}
              </button>
              )}

              {isStaff && switchOpen && (
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
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/5 rounded-lg transition-all"
              >
                <LogOut className="w-3 h-3 flex-shrink-0" /> {t('sidebar.signOut')}
              </button>
            </div>
          )}

          {/* Bottom bar — always visible */}
          <button
            type="button"
            onClick={() => { setAvatarOpen(!avatarOpen); setSwitchOpen(false) }}
            className={`w-full flex items-center gap-2.5 px-3 transition-all ${collapsed ? 'justify-center py-2.5' : 'py-2 hover:bg-black/[0.02]'}`}
            aria-expanded={avatarOpen}
          >
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-indigo/20 bg-gradient-to-br from-indigo/20 to-indigo/5">
              <User className="h-3 w-3 text-indigo" />
            </div>
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-[11px] text-[var(--fog)] truncate">{customerName}</span>
                <ChevronDown className={`h-3 w-3 flex-shrink-0 text-[var(--fog)] transition-transform ${avatarOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>

          {!collapsed && (
            <p className="text-[9px] text-[var(--fog)]/40 font-mono px-3 pb-2">{t('shell.version')}</p>
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
                  {item.badge && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-indigo/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo">
                      {item.badge}
                    </span>
                  )}
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
