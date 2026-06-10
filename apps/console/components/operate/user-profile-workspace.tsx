'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Save, User, MessageSquare, Trash2 } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ReactMarkdown from 'react-markdown'
import { apiClient } from '@/lib/api/client'
import { ConsoleBackButton } from '@/components/ui/console-chrome'

interface UserProfileData {
  userId: string
  profile: string
  totalChats: number; totalCases: number; resolvedCases: number; escalatedCases: number
  lastCaseType: string | null
  firstSeenAt: string | null; lastSeenAt: string | null
  updatedAt: string
}

interface ChatLink { chatId: string; caseCount: number; lastActivity: string }

export default function UserProfileWorkspace({ userId }: { userId: string }) {
  const router = useRouter()

  const [profile, setProfile] = useState<UserProfileData | null>(null)
  const [chats, setChats] = useState<ChatLink[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [profResult, chatsResult] = await Promise.all([
          apiClient<{ profile: UserProfileData }>(`/api/users/${encodeURIComponent(userId)}/profile`),
          apiClient<{ chats: ChatLink[] }>(`/api/users/${encodeURIComponent(userId)}/chats`),
        ])
        setProfile(profResult.data.profile ?? profResult.data)
        setEditText(profResult.data.profile?.profile ?? '')
        setChats(chatsResult.data.chats ?? [])
      } catch (e) { console.error('Profile load failed:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [userId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient(`/api/users/${encodeURIComponent(userId)}/profile`, {
        method: 'PUT',
        body: { profile: editText },
      })
      setProfile(prev => prev ? { ...prev, profile: editText } : null)
      setEditing(false)
    } catch (e) { console.error('Save failed:', e) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ALL data for user ${userId}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await apiClient(`/api/users/${encodeURIComponent(userId)}/profile`, { method: 'DELETE' })
      router.push('/operate/handoff')
    } catch (e) {
      console.error('Delete failed:', e)
      alert('Delete failed')
    }
    finally { setDeleting(false) }
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center"><OrganicLoader icon="spin" size={28} className="text-indigo/60" /></div>
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1320px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-30 rounded-[26px] border border-black/[0.06] bg-white/[0.68] px-4 py-4 shadow-[var(--shadow-card)] backdrop-blur-xl sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ConsoleBackButton label="Handoff" ariaLabel="Back to handoff" onClick={() => router.back()} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">User</p>
              <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--mist)]">
                User profile · {userId}
              </h1>
              {profile ? (
                <p className="mt-1 text-[12px] text-[var(--fog)]/78">
                  {profile.totalCases} ProcedureRuns · {profile.resolvedCases} resolved · {profile.escalatedCases} escalated · updated {new Date(profile.updatedAt).toLocaleDateString()}
                </p>
              ) : null}
            </div>
          </div>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-[14px] border border-red-200 bg-red-50/80 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </header>

      {profile && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            <Stat label="Total ProcedureRuns" value={String(profile.totalCases)} />
            <Stat label="Resolved" value={String(profile.resolvedCases)} />
            <Stat label="Escalated" value={String(profile.escalatedCases)} />
            <Stat label="Total Chats" value={String(profile.totalChats)} />
            {profile.lastCaseType && <Stat label="Last Procedure Type" value={profile.lastCaseType} />}
            {profile.firstSeenAt && <Stat label="First Seen" value={new Date(profile.firstSeenAt).toLocaleDateString()} />}
            {profile.lastSeenAt && <Stat label="Last Seen" value={new Date(profile.lastSeenAt).toLocaleDateString()} />}
          </div>

          {/* Profile Markdown */}
          <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.68] p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--mist)]">Profile</h3>
                <p className="mt-1 text-[12px] text-[var(--fog)]">Cross-chat notes, remembered preferences, and operator context.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <button onClick={() => { setEditing(false); setEditText(profile.profile) }}
                      className="rounded-[14px] border border-black/[0.08] px-3 py-1.5 text-[11px] hover:bg-black/[0.02]">Cancel</button>
                    <button onClick={handleSave} disabled={saving}
                      className="flex items-center gap-1 rounded-[14px] bg-indigo/[0.08] px-3 py-1.5 text-[11px] text-indigo hover:bg-indigo/[0.14]">
                      <Save className="h-3 w-3" />{saving ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button onClick={() => { setEditing(true); setEditText(profile.profile) }}
                    className="rounded-[14px] border border-black/[0.08] px-3 py-1.5 text-[11px] hover:bg-black/[0.02]">Edit</button>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-64 px-3 py-2 text-[13px] font-mono border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30 resize-y"
              />
            ) : (
              <div className="prose prose-sm max-w-none text-[13px] text-[var(--mist)]">
                {profile.profile ? <ReactMarkdown>{profile.profile}</ReactMarkdown> : (
                  <p className="text-[var(--fog)]/50 italic">No profile data yet. The agent will build this over time.</p>
                )}
              </div>
            )}
          </div>

          {/* Chat History */}
          {chats.length > 0 && (
            <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.68] p-5 shadow-[var(--shadow-card)]">
              <div className="mb-3">
                <h3 className="text-[14px] font-semibold text-[var(--mist)]">Chat History ({chats.length})</h3>
                <p className="mt-1 text-[12px] text-[var(--fog)]">Recent Chats linked to this User profile.</p>
              </div>
              <div className="space-y-2">
                {chats.map((c) => (
                  <Link key={c.chatId} href={`/operate/conversations/${encodeURIComponent(c.chatId)}`}
                    className="flex items-center gap-2 rounded-[16px] border border-black/[0.04] px-3 py-2.5 transition-colors hover:bg-black/[0.02]">
                    <MessageSquare className="h-3.5 w-3.5 text-[var(--fog)]/60" />
                    <span className="text-[12px] font-mono text-[var(--mist)]">{c.chatId.slice(0, 16)}...</span>
                    <span className="text-[11px] text-[var(--fog)]/50">{c.caseCount} ProcedureRuns</span>
                    <span className="text-[10px] text-[var(--fog)]/40 ml-auto">{new Date(c.lastActivity).toLocaleDateString()}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-black/[0.05] bg-white/[0.72] px-3 py-3 shadow-[var(--shadow-card)]">
      <p className="text-[10px] text-[var(--fog)]">{label}</p>
      <p className="text-[14px] font-semibold text-[var(--mist)]">{value}</p>
    </div>
  )
}
