'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Save, MessageSquare, Trash2 } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ReactMarkdown from 'react-markdown'
import { apiClient } from '@/lib/api/client'
import SourceTruthPill from '@/components/operate/source-truth-pill'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleBackButton } from '@/components/ui/console-chrome'
import { getRuntimeSourceTruth } from '@/lib/operate/runtime-truth'
import { useAgentContext } from '@/lib/agent/agent-context'

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
  const { locale } = useConsoleLocale()
  const { selectedAgentId, loading: agentLoading } = useAgentContext()
  const isZh = locale === 'zh'
  const sourceTruth = getRuntimeSourceTruth({ userId })
  const withAgent = (path: string) => {
    if (!selectedAgentId) return path
    return `${path}${path.includes('?') ? '&' : '?'}agentId=${encodeURIComponent(selectedAgentId)}`
  }

  const [profile, setProfile] = useState<UserProfileData | null>(null)
  const [chats, setChats] = useState<ChatLink[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      if (agentLoading) return
      if (!selectedAgentId) {
        setProfile(null)
        setChats([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const [profResult, chatsResult] = await Promise.all([
          apiClient<{ profile: UserProfileData }>(withAgent(`/api/users/${encodeURIComponent(userId)}/profile`)),
          apiClient<{ chats: ChatLink[] }>(withAgent(`/api/users/${encodeURIComponent(userId)}/chats`)),
        ])
        setProfile(profResult.data.profile ?? profResult.data)
        setEditText(profResult.data.profile?.profile ?? '')
        setChats(chatsResult.data.chats ?? [])
      } catch (e) { console.error('Profile load failed:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [agentLoading, selectedAgentId, userId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient(`/api/users/${encodeURIComponent(userId)}/profile`, {
        method: 'PUT',
        body: { profile: editText, agentId: selectedAgentId },
      })
      setProfile(prev => prev ? { ...prev, profile: editText } : null)
      setEditing(false)
    } catch (e) { console.error('Save failed:', e) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm(isZh ? `删除用户 ${userId} 的全部数据？此操作无法撤销。` : `Delete ALL data for user ${userId}? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await apiClient(withAgent(`/api/users/${encodeURIComponent(userId)}/profile`), { method: 'DELETE' })
      router.push(withAgent('/operate/handoff'))
    } catch (e) {
      console.error('Delete failed:', e)
      alert(isZh ? '删除失败' : 'Delete failed')
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
            <ConsoleBackButton label={isZh ? '人工交接' : 'Handoff'} ariaLabel={isZh ? '返回人工交接' : 'Back to handoff'} onClick={() => router.back()} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">{isZh ? '用户' : 'User'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--mist)]">
                  {sourceTruth.isSynthetic ? (isZh ? '试跑评审档案' : 'Synthetic review profile') : (isZh ? '用户档案' : 'User profile')} · {userId}
                </h1>
                {sourceTruth.isSynthetic ? <SourceTruthPill truth={sourceTruth} /> : null}
              </div>
              {profile ? (
                <p className="mt-1 text-[12px] text-[var(--fog)]/78">
                  {profile.totalCases} ProcedureRuns · {profile.resolvedCases} {isZh ? '已解决' : 'resolved'} · {profile.escalatedCases} {isZh ? '已升级' : 'escalated'} · {isZh ? '更新于' : 'updated'} {new Date(profile.updatedAt).toLocaleDateString()}
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
            {deleting ? (isZh ? '删除中...' : 'Deleting...') : (isZh ? '删除' : 'Delete')}
          </button>
        </div>
      </header>

      {sourceTruth.isSynthetic ? (
        <div className="rounded-2xl border border-amber/18 bg-amber/[0.06] px-4 py-3 text-[13px] leading-6 text-[var(--mist)] shadow-[var(--shadow-card)]">
          <p className="font-semibold text-amber">{isZh ? '试跑评审身份' : 'Synthetic review identity'}</p>
          <p className="mt-1 text-[var(--fog)]">
            {isZh
              ? '这个档案键来自 Playground 导出的评审流程，不是真实客户身份，也不应当被视为真实渠道历史。'
              : 'This profile key was generated by Playground export for review workflows. It is not a live customer identity and should not be treated as real channel history.'}
          </p>
        </div>
      ) : null}

      {profile && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            <Stat label={isZh ? 'ProcedureRun 总数' : 'Total ProcedureRuns'} value={String(profile.totalCases)} />
            <Stat label={isZh ? '已解决' : 'Resolved'} value={String(profile.resolvedCases)} />
            <Stat label={isZh ? '已升级' : 'Escalated'} value={String(profile.escalatedCases)} />
            <Stat label={isZh ? '会话总数' : 'Total Chats'} value={String(profile.totalChats)} />
            {profile.lastCaseType && <Stat label={isZh ? '最近 Procedure 类型' : 'Last Procedure Type'} value={profile.lastCaseType} />}
            {profile.firstSeenAt && <Stat label={isZh ? '首次出现' : 'First Seen'} value={new Date(profile.firstSeenAt).toLocaleDateString()} />}
            {profile.lastSeenAt && <Stat label={isZh ? '最近出现' : 'Last Seen'} value={new Date(profile.lastSeenAt).toLocaleDateString()} />}
          </div>

          {/* Profile Markdown */}
          <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.68] p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-semibold text-[var(--mist)]">{isZh ? '档案' : 'Profile'}</h3>
                <p className="mt-1 text-[12px] text-[var(--fog)]">{isZh ? '跨会话笔记、记住的偏好，以及运营上下文。' : 'Cross-chat notes, remembered preferences, and operator context.'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <button onClick={() => { setEditing(false); setEditText(profile.profile) }}
                      className="rounded-[14px] border border-black/[0.08] px-3 py-1.5 text-[11px] hover:bg-black/[0.02]">{isZh ? '取消' : 'Cancel'}</button>
                    <button onClick={handleSave} disabled={saving}
                      className="flex items-center gap-1 rounded-[14px] bg-indigo/[0.08] px-3 py-1.5 text-[11px] text-indigo hover:bg-indigo/[0.14]">
                      <Save className="h-3 w-3" />{saving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存' : 'Save')}
                    </button>
                  </>
                ) : (
                  <button onClick={() => { setEditing(true); setEditText(profile.profile) }}
                    className="rounded-[14px] border border-black/[0.08] px-3 py-1.5 text-[11px] hover:bg-black/[0.02]">{isZh ? '编辑' : 'Edit'}</button>
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
                  <p className="text-[var(--fog)]/50 italic">{isZh ? '还没有档案数据，Agent 会随着时间逐步建立。' : 'No profile data yet. The agent will build this over time.'}</p>
                )}
              </div>
            )}
          </div>

          {/* Chat History */}
          {chats.length > 0 && (
            <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.68] p-5 shadow-[var(--shadow-card)]">
              <div className="mb-3">
                <h3 className="text-[14px] font-semibold text-[var(--mist)]">
                  {sourceTruth.isSynthetic ? (isZh ? '评审会话' : 'Review chats') : (isZh ? '会话历史' : 'Chat History')} ({chats.length})
                </h3>
                <p className="mt-1 text-[12px] text-[var(--fog)]">
                  {sourceTruth.isSynthetic
                    ? (isZh ? '这些是挂在该 synthetic profile key 上的 Playground 评审副本。' : 'Saved Playground review copies linked to this synthetic profile key.')
                    : (isZh ? '最近与这个用户档案关联的 Chats。' : 'Recent Chats linked to this User profile.')}
                </p>
              </div>
              <div className="space-y-2">
                {chats.map((c) => (
                  <Link key={c.chatId} href={withAgent(`/operate/conversations/${encodeURIComponent(c.chatId)}`)}
                    className="flex items-center gap-2 rounded-[16px] border border-black/[0.04] px-3 py-2.5 transition-colors hover:bg-black/[0.02]">
                    <MessageSquare className="h-3.5 w-3.5 text-[var(--fog)]/60" />
                    <span className="text-[12px] font-mono text-[var(--mist)]">{c.chatId.slice(0, 16)}...</span>
                    <span className="text-[11px] text-[var(--fog)]/50">{c.caseCount} {isZh ? '个 ProcedureRun' : 'ProcedureRuns'}</span>
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
