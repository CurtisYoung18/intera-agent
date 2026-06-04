'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserPlus, Trash2, Copy, Check, Shield } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, ApiClientError } from '@/lib/api/client'

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

export default function MembersPage() {
  const { t } = useConsoleLocale()
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
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
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

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
    return <div className="p-8 text-[var(--fog)] text-sm">Loading…</div>
  }

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">Members</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">
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
    </div>
  )
}
