'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Building2, UserPlus, Trash2, Copy, Check, Shield, AlertCircle } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, ApiClientError } from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────

interface Member {
  id: string
  userId: string
  orgId: string
  role: string
  invitedAt: string
  user: { id: string; email: string; name: string | null }
}

interface Invitation {
  id: string
  email: string
  role: string
  state: string
  token: string
  expiresAt: string
  createdAt: string
  inviter: { email: string; name: string | null } | null
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
}

const ROLE_OPTIONS = ['admin', 'operator', 'viewer'] as const

// ── Permissions matrix (static) ────────────────────────────────────

interface PermRow { capability: string; owner: boolean; admin: boolean; operator: boolean; viewer: boolean }

const PERMISSIONS: PermRow[] = [
  { capability: 'Manage org settings', owner: true, admin: false, operator: false, viewer: false },
  { capability: 'Manage members', owner: true, admin: true, operator: false, viewer: false },
  { capability: 'Edit agent config', owner: true, admin: true, operator: false, viewer: false },
  { capability: 'View agent config', owner: true, admin: true, operator: true, viewer: true },
  { capability: 'Access playground', owner: true, admin: true, operator: true, viewer: false },
  { capability: 'View dashboards', owner: true, admin: true, operator: true, viewer: true },
  { capability: 'View chats', owner: true, admin: true, operator: true, viewer: false },
  { capability: 'Manage API keys', owner: true, admin: true, operator: false, viewer: false },
]

// ── Page ───────────────────────────────────────────────────────────

function OrganizationPageInner() {
  const { t } = useConsoleLocale()
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = searchParams.get('tab') || 'general'

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
          <Building2 className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('organization.title')}</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border-color)]">
        {(['general', 'members', 'permissions'] as const).map((tKey) => (
          <button
            key={tKey}
            type="button"
            onClick={() => router.push(`/admin/organization?tab=${tKey}`)}
            className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === tKey
                ? 'text-[var(--mist)]'
                : 'text-[var(--fog)] hover:text-[var(--mist)]'
            }`}
          >
            {t(`organization.${tKey}`)}
            {tab === tKey && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'general' && <GeneralTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'permissions' && <PermissionsTab />}
    </div>
  )
}

// ── General Tab ────────────────────────────────────────────────────

function GeneralTab() {
  const { t } = useConsoleLocale()
  const [orgId, setOrgId] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => {
        setOrgId(d.orgId || '')
        setName(d.customerName || '')
      })
      .catch(() => setError(t('common.failedLoad')))
      .finally(() => setLoading(false))
  }, [t])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const r = await fetch(`/api/admin/organizations/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('organization.nameSaveError'))
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError(t('organization.nameSaveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[var(--fog)] text-sm">Loading…</div>

  return (
    <div className="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[var(--fog)] mb-1">{t('organization.nameLabel')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass-input-console text-[14px] w-full"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-xl text-[13px] font-medium bg-indigo text-white hover:bg-indigo/90 disabled:opacity-40 transition-all"
          >
            {saving ? 'Saving…' : t('common.save')}
          </button>
          {saved && <span className="text-[12px] text-malachite">{t('organization.nameSaved')}</span>}
        </div>
        {error && <p className="text-[12px] text-red-500">{error}</p>}
      </div>
    </div>
  )
}

// ── Members Tab ────────────────────────────────────────────────────

function MembersTab() {
  const { t } = useConsoleLocale()
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('viewer')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [mRes, iRes] = await Promise.all([
        apiClient<{ members: Member[] }>('/api/admin/members'),
        apiClient<{ invitations: Invitation[] }>('/api/admin/invitations'),
      ])
      setMembers(mRes.data.members)
      setInvitations(iRes.data.invitations)
      setError(null)
    } catch {
      setError(t('common.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const handleInvite = async () => {
    setInviteError(null)
    try {
      await apiClient('/api/admin/invitations', {
        method: 'POST',
        body: { email: inviteEmail, role: inviteRole },
      })
      setInviteSuccess(true)
      setInviteEmail('')
      setInviteRole('viewer')
      setTimeout(() => { setShowInvite(false); setInviteSuccess(false) }, 1500)
      load()
    } catch (err) {
      setInviteError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to send invitation')
    }
  }

  const handleRevoke = async (id: string) => {
    await apiClient(`/api/admin/invitations/${id}`, { method: 'DELETE' })
    load()
  }

  const handleRoleChange = async (membershipId: string, role: string) => {
    await apiClient('/api/admin/members', { method: 'PUT', body: { membershipId, role } })
    load()
  }

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/login?invite=${token}`
    navigator.clipboard.writeText(url)
    setCopiedId(token)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (loading) {
    return <div className="text-[var(--fog)] text-sm">Loading…</div>
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto text-center mt-20 space-y-4">
        <AlertCircle className="w-10 h-10 text-vermillion/60 mx-auto" />
        <p className="text-[var(--fog)]">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-indigo/[0.08] border border-indigo/20 text-indigo">
          {t('common.retry')}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[13px] text-[var(--fog)]">
            {members.length} member{members.length !== 1 ? 's' : ''} · {invitations.length} pending invitation{invitations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteError(null); setInviteSuccess(false) }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"
        >
          <UserPlus className="w-4 h-4" /> Invite Member
        </button>
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-[var(--border-color)] overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[var(--smoke)] text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Member</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--mist)]">{m.user.name || m.user.email}</div>
                  <div className="text-xs text-[var(--fog)]">{m.user.email}</div>
                </td>
                <td className="px-4 py-3">
                  {m.role === 'owner' ? (
                    <span className="inline-flex items-center gap-1 text-[var(--mist)]">
                      <Shield className="w-3.5 h-3.5 text-amber-500" />
                      Owner
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      className="glass-input-console text-[13px] py-1 px-2 rounded-lg"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--fog)] text-xs">
                  {new Date(m.invitedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[var(--fog)] text-sm">
                  No members yet. Invite someone to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-3">Pending Invitations</h2>
          <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-[var(--smoke)] text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--border-color)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-[var(--mist)]">{inv.email}</div>
                      {inv.inviter && (
                        <div className="text-xs text-[var(--fog)]">Invited by {inv.inviter.name || inv.inviter.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--fog)]">{ROLE_LABELS[inv.role] || inv.role}</td>
                    <td className="px-4 py-3 text-[var(--fog)] text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => copyInviteLink(inv.token)}
                          className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
                          title="Copy invite link"
                        >
                          {copiedId === inv.token ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleRevoke(inv.id)}
                          className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--fog)] hover:text-red-500 transition-colors"
                          title="Revoke invitation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border-color)] p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-semibold text-[var(--mist)] mb-4">Invite Member</h3>

            {inviteSuccess ? (
              <div className="text-green-500 text-sm py-4 text-center">Invitation sent!</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[var(--fog)] mb-1">Email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="glass-input-console text-[14px] w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fog)] mb-1">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="glass-input-console text-[14px] w-full"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
                {inviteError && (
                  <div className="text-red-500 text-xs">{inviteError}</div>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowInvite(false)} className="flex-1 py-2.5 rounded-xl text-[13px] border border-[var(--border-color)] text-[var(--fog)] hover:bg-[var(--bg-hover)] transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleInvite} disabled={!inviteEmail} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo text-white hover:bg-indigo/90 disabled:opacity-40 transition-all">
                    Send Invitation
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Permissions Tab ────────────────────────────────────────────────

function PermissionsTab() {
  return (
    <div className="rounded-xl border border-[var(--border-color)] overflow-hidden max-w-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-color)] text-[var(--smoke)] text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-3">Capability</th>
            <th className="text-center px-4 py-3 w-16">Owner</th>
            <th className="text-center px-4 py-3 w-16">Admin</th>
            <th className="text-center px-4 py-3 w-16">Operator</th>
            <th className="text-center px-4 py-3 w-16">Viewer</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((row) => (
            <tr key={row.capability} className="border-b border-[var(--border-color)] last:border-0">
              <td className="px-4 py-3 text-[var(--mist)]">{row.capability}</td>
              <td className="px-4 py-3 text-center">{row.owner ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/30">—</span>}</td>
              <td className="px-4 py-3 text-center">{row.admin ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/30">—</span>}</td>
              <td className="px-4 py-3 text-center">{row.operator ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/30">—</span>}</td>
              <td className="px-4 py-3 text-center">{row.viewer ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/30">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Export ─────────────────────────────────────────────────────────

export default function OrganizationPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[var(--fog)] text-sm">Loading…</div>}>
      <OrganizationPageInner />
    </Suspense>
  )
}
