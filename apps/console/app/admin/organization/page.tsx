'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Building2, UserPlus, Trash2, Copy, Check, Shield, AlertCircle, X, Link } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, ApiClientError } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'

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
  email: string | null
  role: string
  state: string
  token: string
  maxUses: number | null
  useCount: number
  expiresAt: string
  createdAt: string
  inviter: { email: string; name: string | null } | null
}

const ROLE_OPTIONS = ['admin', 'operator', 'viewer'] as const

function roleLabel(t: (k: string) => string, role: string): string {
  return t(`organization.role.${role}`)
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return iso }
}

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

// ── Glass card wrapper ─────────────────────────────────────────────

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white/60 backdrop-blur-xl border border-white/20 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────

function OrganizationPageInner() {
  const { t } = useConsoleLocale()
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = searchParams.get('tab') || 'general'

  return (
    <div className="px-8 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-white/60 backdrop-blur-sm border border-white/20 shadow-sm flex items-center justify-center">
          <Building2 className="w-4.5 h-4.5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('organization.title')}</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 mb-8 border-b border-black/5">
        {(['general', 'members', 'permissions'] as const).map((tKey) => (
          <button
            key={tKey}
            type="button"
            onClick={() => router.push(`/admin/organization?tab=${tKey}`)}
            className={`relative px-5 py-2.5 text-[13px] font-medium transition-colors -mb-px ${
              tab === tKey
                ? 'text-[var(--mist)]'
                : 'text-[var(--fog)]/60 hover:text-[var(--fog)]'
            }`}
          >
            {t(`organization.${tKey}`)}
            {tab === tKey && (
              <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-indigo" />
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
  const { orgId, userId, loading: sessionLoading } = useSession()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await apiClient(`/api/admin/organizations/${orgId}`, {
        method: 'PUT',
        body: { name: name.trim() },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError(t('organization.nameSaveError'))
    } finally {
      setSaving(false)
    }
  }

  if (sessionLoading) return <div className="text-[var(--fog)] text-sm">{t('common.loading')}</div>

  return (
    <div className="max-w-md">
      <GlassCard className="p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--smoke)] mb-1.5 uppercase tracking-wider">{t('organization.nameLabel')}</label>
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
              className="px-5 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo text-white hover:bg-indigo/90 disabled:opacity-40 transition-all shadow-sm"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            {saved && <span className="text-[12px] text-malachite font-medium">{t('organization.nameSaved')}</span>}
          </div>
          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>
      </GlassCard>
    </div>
  )
}

// ── Members Tab ────────────────────────────────────────────────────

function MembersTab() {
  const { t } = useConsoleLocale()
  const { userId } = useSession()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('viewer')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [showShareLink, setShowShareLink] = useState(false)
  const [shareRole, setShareRole] = useState<string>('viewer')
  const [shareMaxUses, setShareMaxUses] = useState<string>('')
  const [shareLinkError, setShareLinkError] = useState<string | null>(null)
  const [shareLinkToken, setShareLinkToken] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const load = useCallback(async () => {
    try {
      const [mRes, iRes] = await Promise.all([
        apiClient<{ members: Member[] }>('/api/admin/members'),
        apiClient<{ invitations: Invitation[] }>('/api/admin/invitations'),
      ])
      setMembers(mRes.data.members)
      setInvitations(iRes.data.invitations)
      if (userId) setCurrentUserId(userId)
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
      const res = await apiClient<{ invitation: { token: string } }>('/api/admin/invitations', {
        method: 'POST',
        body: { email: inviteEmail, role: inviteRole },
      })
      setInviteToken(res.data.invitation.token)
      setInviteSuccess(true)
      setCopiedLink(false)
      load()
    } catch (err) {
      setInviteError(err instanceof ApiClientError ? err.envelope.error.message : t('common.failedSave'))
    }
  }

  const handleCloseInvite = () => {
    setShowInvite(false)
    setInviteEmail('')
    setInviteRole('viewer')
    setInviteSuccess(false)
    setInviteToken(null)
    setCopiedLink(false)
  }

  const handleCreateShareLink = async () => {
    setShareLinkError(null)
    try {
      const body: Record<string, unknown> = { role: shareRole }
      if (shareMaxUses.trim()) {
        const n = parseInt(shareMaxUses, 10)
        if (isNaN(n) || n < 1) { setShareLinkError(t('organization.shareLink.maxUsesError')); return }
        body.maxUses = n
      }
      const res = await apiClient<{ invitation: { token: string } }>('/api/admin/invitations', {
        method: 'POST',
        body,
      })
      setShareLinkToken(res.data.invitation.token)
      load()
    } catch (err) {
      setShareLinkError(err instanceof ApiClientError ? err.envelope.error.message : t('organization.shareLink.createError'))
    }
  }

  const handleCloseShareLink = () => {
    setShowShareLink(false)
    setShareRole('viewer')
    setShareMaxUses('')
    setShareLinkError(null)
    setShareLinkToken(null)
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

  const copyLinkFromSuccess = () => {
    if (!inviteToken) return
    const url = `${window.location.origin}/login?invite=${inviteToken}`
    navigator.clipboard.writeText(url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 3000)
  }

  const rl = (role: string) => roleLabel(t, role)

  if (loading) {
    return <div className="text-[var(--fog)] text-sm">{t('common.loading')}</div>
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
        <p className="text-[13px] text-[var(--fog)]">
          {t('organization.memberCount', { n: members.length, nPl: members.length !== 1 ? 's' : '', m: invitations.length, mPl: invitations.length !== 1 ? 's' : '' })}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowShareLink(true); setShareLinkError(null); setShareLinkToken(null) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-indigo/20 text-indigo hover:bg-indigo/[0.04] transition-all"
          >
            <Link className="w-4 h-4" /> {t('organization.shareLink')}
          </button>
          <button
            onClick={() => { setShowInvite(true); setInviteError(null); setInviteSuccess(false); setInviteToken(null); setCopiedLink(false) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo text-white hover:bg-indigo/90 transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" /> {t('organization.inviteMember')}
          </button>
        </div>
      </div>

      {/* Members table */}
      <GlassCard className="overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 text-[11px] text-[var(--mist)]/60 uppercase tracking-wider">
              <th className="text-left px-5 py-3 font-semibold">{t('organization.table.member')}</th>
              <th className="text-left px-5 py-3 font-semibold">{t('organization.table.role')}</th>
              <th className="text-left px-5 py-3 font-semibold">{t('organization.table.joined')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-black/[0.03] last:border-0 hover:bg-black/[0.01] transition-colors">
                <td className="px-5 py-3.5">
                  <div className="font-medium text-[var(--mist)]">{m.user.name || m.user.email}</div>
                  <div className="text-xs text-[var(--fog)] mt-0.5">{m.user.email}</div>
                </td>
                <td className="px-5 py-3.5">
                  {m.role === 'owner' || m.user.id === currentUserId ? (
                    <span className={`inline-flex items-center gap-1.5 text-[var(--mist)] px-2.5 py-1 rounded-lg border ${m.role === 'owner' ? 'bg-amber-50 border-amber-200/50' : 'bg-slate-50 border-slate-200/50'}`}>
                      <Shield className={`w-3.5 h-3.5 ${m.role === 'owner' ? 'text-amber-500' : 'text-slate-400'}`} />
                      <span className="text-[12px] font-medium">{rl(m.role)}</span>
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      className="glass-input-console text-[13px] py-1.5 px-2.5 rounded-lg"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{rl(r)}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-5 py-3.5 text-[var(--fog)] text-xs">
                  {formatDate(m.invitedAt)}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-[var(--fog)] text-sm">
                  {t('organization.noMembers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-3">{t('organization.pendingInvitations')}</h2>
          <GlassCard className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-[11px] text-[var(--mist)]/60 uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">{t('organization.table.email')}</th>
                  <th className="text-left px-5 py-3 font-semibold">{t('organization.table.role')}</th>
                  <th className="text-left px-5 py-3 font-semibold">{t('organization.table.expires')}</th>
                  <th className="text-right px-5 py-3 font-semibold">{t('organization.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-black/[0.03] last:border-0">
                    <td className="px-5 py-3.5">
                      {inv.email ? (
                        <>
                          <div className="text-[var(--mist)] font-medium">{inv.email}</div>
                          {inv.inviter && (
                            <div className="text-xs text-[var(--fog)] mt-0.5">{t('organization.invitedBy', { name: inv.inviter.name || inv.inviter.email })}</div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Link className="w-3.5 h-3.5 text-indigo" />
                          <span className="text-[var(--mist)] font-medium">{t('organization.shareLink')}</span>
                          <span className="text-[11px] text-[var(--fog)]">({rl(inv.role)})</span>
                          {inv.maxUses != null && (
                            <span className="text-[11px] text-[var(--fog)]">{t('organization.shareLink.usedCount', { used: inv.useCount, max: inv.maxUses })}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[13px] text-[var(--fog)] bg-black/[0.03] px-2.5 py-1 rounded-lg">{rl(inv.role)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--fog)] text-xs">
                      {formatDate(inv.expiresAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => copyInviteLink(inv.token)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-indigo/[0.06] text-[var(--fog)] hover:text-indigo transition-colors text-[12px] font-medium"
                          title={t('organization.copyLink')}
                        >
                          {copiedId === inv.token ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedId === inv.token ? t('organization.copied') : t('organization.copyLink')}
                        </button>
                        <button
                          onClick={() => handleRevoke(inv.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-[var(--fog)] hover:text-red-500 transition-colors text-[12px]"
                          title={t('organization.revoke')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </>
      )}

      {/* Share Link modal */}
      {showShareLink && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={handleCloseShareLink}>
          <div
            className="bg-white/90 backdrop-blur-xl rounded-2xl border border-white/30 shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[16px] font-semibold text-[var(--mist)]">{t('organization.shareLink.createTitle')}</h3>
              <button onClick={handleCloseShareLink} className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[var(--fog)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {shareLinkToken ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 text-sm py-2">
                  <Check className="w-4 h-4" />
                  <span className="font-medium">{t('organization.shareLink.created')}</span>
                </div>
                <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-200/50">
                  <p className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wider mb-2">{t('organization.shareLink.shareTitle')}</p>
                  <p className="text-[11px] text-indigo-700 mb-3 leading-relaxed">
                    {t('organization.shareLink.desc', { role: rl(shareRole) })}
                    {shareMaxUses.trim() && t('organization.shareLink.limited', { n: parseInt(shareMaxUses), nPl: parseInt(shareMaxUses) !== 1 ? 's' : '' })}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono text-indigo-900 bg-white/60 px-3 py-2 rounded-lg border border-indigo-200/50 break-all select-all">
                      {window.location.origin}/login?invite={shareLinkToken}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/login?invite=${shareLinkToken}`)
                        setCopiedLink(true)
                        setTimeout(() => setCopiedLink(false), 3000)
                      }}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-indigo text-white hover:bg-indigo/90 transition-all"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedLink ? t('organization.copied') : t('organization.copyLink')}
                    </button>
                  </div>
                </div>
                <button onClick={handleCloseShareLink} className="w-full py-2.5 rounded-xl text-[13px] font-medium border border-black/10 text-[var(--fog)] hover:bg-black/[0.02] transition-colors">
                  {t('organization.done')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--smoke)] mb-1.5 uppercase tracking-wider">{t('organization.table.role')}</label>
                  <select
                    value={shareRole}
                    onChange={(e) => setShareRole(e.target.value)}
                    className="glass-input-console text-[14px] w-full"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{rl(r)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--smoke)] mb-1.5 uppercase tracking-wider">
                    {t('organization.shareLink.maxUses')} <span className="text-[var(--fog)] font-normal">{t('organization.shareLink.maxUsesOptional')}</span>
                  </label>
                  <input
                    type="number"
                    value={shareMaxUses}
                    onChange={(e) => setShareMaxUses(e.target.value)}
                    placeholder={t('organization.shareLink.noLimit')}
                    className="glass-input-console text-[14px] w-full"
                    min="1"
                  />
                </div>
                {shareLinkError && (
                  <div className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{shareLinkError}</div>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={handleCloseShareLink} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border border-black/[0.08] text-[var(--fog)] hover:bg-black/[0.02] transition-colors">
                    {t('common.cancel')}
                  </button>
                  <button onClick={handleCreateShareLink} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo text-white hover:bg-indigo/90 transition-all shadow-sm">
                    {t('organization.shareLink.createLink')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Invite modal */}
      {showInvite && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={handleCloseInvite}>
          <div
            className="bg-white/90 backdrop-blur-xl rounded-2xl border border-white/30 shadow-2xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[16px] font-semibold text-[var(--mist)]">{t('organization.invite.title')}</h3>
              <button onClick={handleCloseInvite} className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[var(--fog)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteSuccess ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 text-sm py-2">
                  <Check className="w-4 h-4" />
                  <span className="font-medium">{t('organization.invite.created', { email: inviteEmail })}</span>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/50">
                  <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider mb-2">{t('organization.shareLink.shareTitle')}</p>
                  <p className="text-[11px] text-amber-700 mb-3 leading-relaxed">
                    {t('organization.invite.shareDesc', { email: inviteEmail })}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono text-amber-900 bg-white/60 px-3 py-2 rounded-lg border border-amber-200/50 break-all select-all">
                      {window.location.origin}/login?invite={inviteToken}
                    </code>
                    <button
                      onClick={copyLinkFromSuccess}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all"
                      style={{
                        background: copiedLink ? 'var(--malachite)' : 'var(--amber)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedLink ? t('organization.copied') : t('organization.copyLink')}
                    </button>
                  </div>
                </div>

                <div className="pt-1">
                  <button onClick={handleCloseInvite} className="w-full py-2.5 rounded-xl text-[13px] font-medium border border-black/10 text-[var(--fog)] hover:bg-black/[0.02] transition-colors">
                    {t('organization.done')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--smoke)] mb-1.5 uppercase tracking-wider">{t('organization.invite.email')}</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder={t('organization.invite.emailPlaceholder')}
                    className="glass-input-console text-[14px] w-full"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--smoke)] mb-1.5 uppercase tracking-wider">{t('organization.table.role')}</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="glass-input-console text-[14px] w-full"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{rl(r)}</option>
                    ))}
                  </select>
                </div>
                {inviteError && (
                  <div className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{inviteError}</div>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={handleCloseInvite} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium border border-black/[0.08] text-[var(--fog)] hover:bg-black/[0.02] transition-colors">
                    {t('common.cancel')}
                  </button>
                  <button onClick={handleInvite} disabled={!inviteEmail} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-indigo text-white hover:bg-indigo/90 disabled:opacity-40 transition-all shadow-sm">
                    {t('organization.invite.send')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Permissions Tab ────────────────────────────────────────────────

function PermissionsTab() {
  const { t } = useConsoleLocale()

  return (
    <GlassCard className="overflow-hidden max-w-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/5 text-[11px] text-[var(--smoke)] uppercase tracking-wider">
            <th className="text-left px-5 py-3 font-semibold">{t('organization.permissions.capability')}</th>
            <th className="text-center px-5 py-3 font-semibold w-16">{t('organization.role.owner')}</th>
            <th className="text-center px-5 py-3 font-semibold w-16">{t('organization.role.admin')}</th>
            <th className="text-center px-5 py-3 font-semibold w-16">{t('organization.role.operator')}</th>
            <th className="text-center px-5 py-3 font-semibold w-16">{t('organization.role.viewer')}</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((row) => (
            <tr key={row.capability} className="border-b border-black/[0.03] last:border-0">
              <td className="px-5 py-3.5 text-[var(--mist)] text-[13px]">{row.capability}</td>
              <td className="px-5 py-3.5 text-center">{row.owner ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/20 text-xs">&mdash;</span>}</td>
              <td className="px-5 py-3.5 text-center">{row.admin ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/20 text-xs">&mdash;</span>}</td>
              <td className="px-5 py-3.5 text-center">{row.operator ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/20 text-xs">&mdash;</span>}</td>
              <td className="px-5 py-3.5 text-center">{row.viewer ? <Check className="w-4 h-4 text-malachite mx-auto" /> : <span className="text-[var(--fog)]/20 text-xs">&mdash;</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
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
