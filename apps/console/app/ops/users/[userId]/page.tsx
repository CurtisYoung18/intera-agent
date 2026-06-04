'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, User, MessageSquare, Trash2 } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ReactMarkdown from 'react-markdown'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, ApiClientError } from '@/lib/api/client'

interface UserProfileData {
  userId: string
  profile: string
  totalChats: number; totalCases: number; resolvedCases: number; escalatedCases: number
  lastCaseType: string | null
  firstSeenAt: string | null; lastSeenAt: string | null
  updatedAt: string
}

interface ChatLink { chatId: string; caseCount: number; lastActivity: string }

export default function UserProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params)
  const router = useRouter()
  const { t } = useConsoleLocale()

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
      router.push('/ops/users')
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
    <div className="mx-auto flex min-h-[100dvh] max-w-[960px] flex-col px-4 py-4 sm:px-6">
      <header className="sticky top-0 z-30 mb-4 flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/55 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <button type="button" onClick={() => router.back()} className="console-btn-icon-square">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--mist)]">
            <User className="inline h-3.5 w-3.5 mr-1.5 text-indigo/60" />
            User Profile · {userId}
          </h1>
          {profile && (
            <p className="mt-0.5 text-[11px] text-[var(--fog)]/70">
              {profile.totalCases} cases · {profile.resolvedCases} resolved · {profile.escalatedCases} escalated
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-red-500 rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </header>

      {profile && (
        <>
          {/* Stats */}
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total Cases" value={String(profile.totalCases)} />
            <Stat label="Resolved" value={String(profile.resolvedCases)} />
            <Stat label="Escalated" value={String(profile.escalatedCases)} />
            <Stat label="Total Chats" value={String(profile.totalChats)} />
            {profile.lastCaseType && <Stat label="Last Case Type" value={profile.lastCaseType} />}
            {profile.firstSeenAt && <Stat label="First Seen" value={new Date(profile.firstSeenAt).toLocaleDateString()} />}
            {profile.lastSeenAt && <Stat label="Last Seen" value={new Date(profile.lastSeenAt).toLocaleDateString()} />}
          </div>

          {/* Profile Markdown */}
          <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-[var(--mist)]">Profile</h3>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button onClick={() => { setEditing(false); setEditText(profile.profile) }}
                      className="px-3 py-1.5 text-[11px] rounded-lg border border-black/[0.08] hover:bg-black/[0.02]">Cancel</button>
                    <button onClick={handleSave} disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg bg-indigo/[0.08] text-indigo hover:bg-indigo/[0.14]">
                      <Save className="w-3 h-3" />{saving ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button onClick={() => { setEditing(true); setEditText(profile.profile) }}
                    className="px-3 py-1.5 text-[11px] rounded-lg border border-black/[0.08] hover:bg-black/[0.02]">Edit</button>
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
            <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-5">
              <h3 className="text-[13px] font-bold text-[var(--mist)] mb-3">Chat History ({chats.length})</h3>
              <div className="space-y-2">
                {chats.map((c) => (
                  <Link key={c.chatId} href={`/ops/chats/${encodeURIComponent(c.chatId)}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/[0.04] hover:bg-black/[0.02] transition-colors">
                    <MessageSquare className="h-3.5 w-3.5 text-[var(--fog)]/60" />
                    <span className="text-[12px] font-mono text-[var(--mist)]">{c.chatId.slice(0, 16)}...</span>
                    <span className="text-[11px] text-[var(--fog)]/50">{c.caseCount} cases</span>
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
    <div className="rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2.5">
      <p className="text-[10px] text-[var(--fog)]">{label}</p>
      <p className="text-[14px] font-semibold text-[var(--mist)]">{value}</p>
    </div>
  )
}
