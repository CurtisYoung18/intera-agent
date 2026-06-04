'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Shield, Plus, Pencil, Trash2, AlertTriangle, Eye, CheckCircle, ToggleLeft, ToggleRight, Sparkles, BarChart3 } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import ChipInput from '@/components/ui/chip-input'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { useConsoleLocale } from '@/components/locale-provider'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useCapabilityBindings, checkItemBinding, toggleItemBinding, BindingIndicator } from '@/components/admin/binding-column'
import { apiClient } from '@/lib/api/client'
import type { GuardrailHook, GuardrailCheckpoint } from '@intera/shared/types'

// ── Platform constants (mirrors policy.ts safety floor) ──────────────────

const HIGH_RISK_SKILLS = ['refund_money', 'change_ban_status', 'delete_account']
const SAFE_TOOLS = [
  { value: 'create_human_task', label: 'Create Human Task (转人工)' },
  { value: 'request_user_input', label: 'Request User Input' },
]
const CHECKPOINTS: { value: GuardrailCheckpoint; label: string }[] = [
  { value: 'preTool', label: 'Before Tool' },
  { value: 'postTool', label: 'After Tool' },
  { value: 'preFinalize', label: 'Before Case Resolution' },
]
const CHECK_KINDS = [
  { value: 'rule' as const, label: 'Rule (deterministic)' },
  { value: 'ai' as const, label: 'AI Evaluation' },
]
const VIOLATION_ACTIONS = [
  { value: 'warn' as const, label: 'Warn' },
  { value: 'block' as const, label: 'Block' },
  { value: 'invoke_tool' as const, label: 'Invoke Tool' },
]
const UNAVAILABLE_ACTIONS = [
  { value: 'open' as const, label: 'Open (allow + warn)' },
  { value: 'closed' as const, label: 'Closed (block)' },
  { value: 'invoke_tool' as const, label: 'Invoke Tool' },
]

const PLACEHOLDERS = ['{{skill_name}}', '{{skill_input}}', '{{skill_output}}', '{{confirmed_facts}}', '{{skills_called}}']

interface PolicyItem { id: string; name: string; description: string; hook: string; rule: string; guardrailConfig?: string | null; enabled: boolean }

// ── Parse / build GuardrailHook ──────────────────────────────────────────

function parseGuardrailConfig(raw: string | null | undefined): GuardrailHook | null {
  if (!raw) return null
  try { return JSON.parse(raw) as GuardrailHook } catch { return null }
}

function buildGuardrailConfig(hook: GuardrailHook): string {
  return JSON.stringify(hook)
}

function defaultGuardrailHook(): GuardrailHook {
  return {
    when: 'preTool',
    match: { skills: [] },
    check: { kind: 'rule' },
    onViolation: { action: 'warn' },
    onUnavailable: { action: 'closed' },
  }
}

function summarizeHook(p: PolicyItem): string {
  const gh = parseGuardrailConfig(p.guardrailConfig ?? null)
  if (gh) {
    const parts: string[] = []
    const cpLabel = CHECKPOINTS.find(c => c.value === gh.when)?.label || gh.when
    parts.push(cpLabel)
    if (gh.match.skills.length) parts.push(`Skills: ${gh.match.skills.join(', ')}`)
    parts.push(gh.check.kind === 'rule' ? 'Rule' : 'AI')
    if (gh.onViolation.action !== 'warn') parts.push(`On violation: ${gh.onViolation.action}`)
    return parts.join(' · ')
  }
  // Legacy fallback
  try {
    const r = JSON.parse(p.rule || '{}')
    const parts: string[] = []
    if (r.deny_skills?.length) parts.push(`Blocks: ${r.deny_skills.join(', ')}`)
    if (r.require_skills?.length) parts.push(`Requires ALL: ${r.require_skills.join(', ')}`)
    if (r.require_skills_any?.length) parts.push(`Requires ANY: ${r.require_skills_any.join(', ')}`)
    if (r.evaluationPrompt) parts.push('AI eval')
    return parts.length ? parts.join(' · ') : 'Legacy rule'
  } catch { return 'No conditions' }
}

function isHighRiskHook(gh: GuardrailHook): boolean {
  return gh.match.skills.some(s => HIGH_RISK_SKILLS.includes(s))
}

export default function PoliciesPage() {
  const { t } = useConsoleLocale()
  const agentId = useSelectedAgentId()
  const { bindings, saveBindings } = useCapabilityBindings(agentId)
  const hookMeta = useMemo(
    () => ({
      preTool: { label: t('policy.hook.preTool'), icon: AlertTriangle, color: '#d4912e' },
      postTool: { label: t('policy.hook.postTool'), icon: Eye, color: '#5b8af7' },
      preFinalize: { label: t('policy.hook.preFinalize'), icon: CheckCircle, color: '#2ea04a' },
    }) as Record<string, { label: string; icon: typeof Shield; color: string }>,
    [t],
  )

  const [items, setItems] = useState<PolicyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PolicyItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hitStats, setHitStats] = useState<Map<string, number>>(new Map())
  const [usedByAgent, setUsedByAgent] = useState<Set<string>>(new Set())
  const [allSkills, setAllSkills] = useState<string[]>([])
  const [gh, setGh] = useState<GuardrailHook>(defaultGuardrailHook())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/policies')
    const data = await res.json()
    setItems(data.policies || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/admin/agent')
      .then((r) => r.json())
      .then((d) => {
        try {
          const hooks = typeof d.config?.policyHooks === 'string' ? JSON.parse(d.config.policyHooks) : d.config?.policyHooks
          const names = new Set<string>()
          for (const key of ['preTool', 'postTool', 'preFinalize']) {
            if (Array.isArray(hooks?.[key])) {
              for (const n of hooks[key]) if (typeof n === 'string') names.add(n)
            }
          }
          setUsedByAgent(names)
        } catch { /* ignore */ }
      })
      .catch(() => {})
  }, [items])

  useEffect(() => {
    fetch('/api/admin/policies/stats')
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, number>()
        for (const s of d.stats || []) m.set(s.name, s.hits)
        setHitStats(m)
      })
      .catch(() => {})
  }, [items])

  useEffect(() => {
    fetch('/api/admin/skills')
      .then((r) => r.json())
      .then((d) => setAllSkills((d.skills || []).map((s: { name: string }) => s.name)))
      .catch(() => {})
  }, [])

  const insertPlaceholder = (ph: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const before = gh.check.evaluationPrompt?.slice(0, start) || ''
    const after = gh.check.evaluationPrompt?.slice(end) || ''
    const next = before + ph + after
    setGh({ ...gh, check: { ...gh.check, evaluationPrompt: next } })
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + ph.length
    })
  }

  const toggleEnabled = useCallback(async (p: PolicyItem) => {
    await fetch(`/api/admin/policies/${encodeURIComponent(p.name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    })
    load()
  }, [load])

  const openEdit = (p: PolicyItem) => {
    setEditing({ ...p })
    setIsNew(false)
    const parsed = parseGuardrailConfig(p.guardrailConfig ?? null)
    setGh(parsed || defaultGuardrailHook())
  }

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', hook: 'preTool', rule: '{}', enabled: true })
    setIsNew(true)
    setGh(defaultGuardrailHook())
  }

  const handleSave = useCallback(async () => {
    if (!editing) return
    setSaveError(null)

    if (!editing.name.trim()) {
      setSaveError('Name is required.')
      return
    }

    // Validate safety floor in UI
    if (isHighRiskHook(gh) && gh.onUnavailable.action === 'open') {
      setSaveError('onUnavailable cannot be "open" for hooks on high-risk skills (refund_money, change_ban_status, delete_account). Use "closed" or "invoke_tool".')
      return
    }

    if (gh.onViolation.action === 'invoke_tool' && gh.onViolation.tool) {
      if (!SAFE_TOOLS.some(t => t.value === gh.onViolation.tool)) {
        setSaveError(`Invoke tool target must be one of: ${SAFE_TOOLS.map(t => t.label).join(', ')}.`)
        return
      }
    }

    if (gh.onUnavailable.action === 'invoke_tool' && gh.onUnavailable.tool) {
      if (!SAFE_TOOLS.some(t => t.value === gh.onUnavailable.tool)) {
        setSaveError(`Fallback tool target must be one of: ${SAFE_TOOLS.map(t => t.label).join(', ')}.`)
        return
      }
    }

    const guardrailConfig = buildGuardrailConfig(gh)
    // Also keep legacy rule/hook for backward compat
    const legacyRule = JSON.stringify({
      hook_skills: gh.match.skills,
      ...(gh.check.kind === 'rule' ? {
        deny_skills: gh.check.denySkills,
        require_skills: gh.check.requireSkills,
        require_skills_any: gh.check.requireSkillsAny,
      } : {
        evaluationPrompt: gh.check.evaluationPrompt,
      }),
    })

    const payload = {
      ...editing,
      hook: gh.when,
      rule: legacyRule,
      guardrailConfig,
    }
    const url = isNew ? '/api/admin/policies' : `/api/admin/policies/${encodeURIComponent(editing.name)}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) {
      setSaveError(`Save failed (HTTP ${res.status}).`)
      return
    }
    setEditing(null); load()
  }, [editing, isNew, load, gh])

  const handleDelete = useCallback(async (name: string) => {
    setConfirmDeleteName(name)
  }, [])

  const confirmDelete = useCallback(async () => {
    const name = confirmDeleteName
    if (!name) return
    setConfirmDeleteName(null)
    await fetch(`/api/admin/policies/${encodeURIComponent(name)}`, { method: 'DELETE' })
    load()
  }, [confirmDeleteName, load])

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  const highRisk = isHighRiskHook(gh)

  return (
    <div>
      <VersionContextBar />
      <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('policies.title')}</h1><p className="text-[13px] text-[var(--fog)] mt-0.5">{t('policies.subtitle', { n: items.length })}</p></div>
        <button type="button" onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> {t('policies.new')}</button>
      </div>
      {items.length === 0 ? <EmptyState icon={Shield} title={t('policies.noPolicies')} description={t('policies.noPoliciesDesc')} /> : (
        <div className="space-y-6">
          {(['preTool', 'postTool', 'preFinalize'] as const).map(hook => {
            const hookItems = items.filter(p => {
              const g = parseGuardrailConfig(p.guardrailConfig ?? null)
              return g ? g.when === hook : p.hook === hook
            })
            if (hookItems.length === 0) return null
            const hm = hookMeta[hook]
            const HIcon = hm.icon
            return (
              <div key={hook}>
                <div className="flex items-center gap-2 mb-3">
                  <HIcon className="w-4 h-4" style={{ color: hm.color }} />
                  <span className="text-[13px] font-semibold text-[var(--mist)]">{hm.label}</span>
                  <span className="text-[11px] text-[var(--fog)]/50">{hookItems.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {hookItems.map(p => {
                    return (
                      <TiltCard key={p.id || p.name} accentColor={hm.color} onClick={() => openEdit(p)}>
                        <div className="p-5">
                          <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${hm.color}10` }}>
                              <HIcon className="w-5 h-5" style={{ color: hm.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{p.name}</div>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 inline-block" style={{ backgroundColor: `${hm.color}12`, color: hm.color }}>{hm.label}</span>
                            </div>
                            <button onClick={e => { e.stopPropagation(); toggleEnabled(p) }} className="flex-shrink-0">
                              {p.enabled ? <ToggleRight className="w-7 h-7 text-malachite" /> : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                            </button>
                          </div>
                          <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-1">{p.description || t('common.noDescription')}</p>
                          <p className="text-[10px] text-[var(--smoke)] font-mono line-clamp-2 mb-3">{summarizeHook(p)}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-[var(--smoke)]">{p.enabled ? t('common.active') : t('common.inactive')}</span>
                              {usedByAgent.has(p.name) && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-malachite/[0.08] text-malachite font-medium">Assigned to agent</span>
                              )}
                              {agentId && (() => {
                                const stats = checkItemBinding(bindings, 'guardrails', p.name, p.hook as 'preTool' | 'postTool' | 'preFinalize')
                                return (
                                  <BindingIndicator
                                    isBound={stats.isBound}
                                    isDrift={stats.isDrift}
                                    otherVersionsBound={stats.otherVersionsBound}
                                    onToggle={() => {
                                      const newB = toggleItemBinding(bindings, 'guardrails', p.name, p.hook as 'preTool' | 'postTool' | 'preFinalize')
                                      saveBindings(newB)
                                    }}
                                  />
                                )
                              })()}
                            </div>
                            <div className="flex gap-1">
                              <button type="button" onClick={e => { e.stopPropagation(); openEdit(p) }} className="p-1.5 rounded-lg hover:bg-black/5" title={t('common.edit')}><Pencil className="w-3.5 h-3.5 text-[var(--fog)]" /></button>
                              <button type="button" onClick={e => { e.stopPropagation(); handleDelete(p.name) }} className="p-1.5 rounded-lg hover:bg-vermillion/5" title={t('common.delete')}><Trash2 className="w-3.5 h-3.5 text-vermillion/60" /></button>
                            </div>
                          </div>
                        </div>
                      </TiltCard>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Hit Stats ── */}
      {items.length > 0 && (
        <div className="mt-8 rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-[var(--fog)]" />
            <h2 className="text-[13px] font-semibold text-[var(--mist)]">Hit Statistics</h2>
            <span className="text-[10px] text-[var(--fog)]/60 ml-1">(last 7 days)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {items.filter(p => p.enabled).slice(0, 6).map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-black/[0.04] bg-white">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[var(--mist)] truncate">{p.name}</p>
                  <p className="text-[10px] text-[var(--fog)]">{p.hook === 'preTool' ? 'Before tool' : p.hook === 'postTool' ? 'After tool' : 'Before resolve'}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-[16px] font-bold text-[var(--mist)]">{hitStats.get(p.name) ?? '—'}</p>
                  <p className="text-[9px] text-[var(--fog)]/50">hits</p>
                </div>
              </div>
            ))}
          </div>
          {hitStats.size === 0 && (
            <p className="text-[10px] text-[var(--fog)]/50 mt-2">No policy hits recorded in the last 7 days.</p>
          )}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!confirmDeleteName}
        title="Delete Guardrail"
        message={confirmDeleteName ? t('common.permanentlyDelete', { name: confirmDeleteName }) : ''}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteName(null)}
      />

      {/* ── Edit/New Modal — six GuardrailHook fields ── */}
      <ImmersiveModal open={!!editing} onClose={() => { setEditing(null); setSaveError(null) }} title={isNew ? t('policies.newPolicy') : t('policies.editPolicy')}>
        {editing && (
          <div className="space-y-4">
            {/* ── Name & Description ── */}
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.name')}</span><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} placeholder="e.g. investigate_before_escalation" />{!isNew && <p className="text-[10px] text-[var(--smoke)]">Name cannot be changed after creation.</p>}</label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span><input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" /></label>

            <div className="border-t border-[var(--border-subtle)] pt-3">
              <span className="text-[11px] font-medium text-[var(--fog)]">Guardrail Configuration</span>
              <p className="text-[10px] text-[var(--smoke)]">Answer six questions to define this guardrail hook.</p>
            </div>

            {/* ── 1. WHEN ── */}
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] font-medium">1. When does it run?</span>
              <select value={gh.when} onChange={e => setGh({ ...gh, when: e.target.value as GuardrailCheckpoint })} className="glass-input-console text-[13px]">
                {CHECKPOINTS.map(c => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </label>

            {/* ── 2. WHICH actions/outputs? ── */}
            <div className="space-y-3 border border-[var(--border-subtle)] rounded-xl p-3 bg-black/[0.01]">
              <span className="text-[11px] text-[var(--fog)] font-medium">2. Which actions/outputs?</span>

              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">Match skills</span>
                <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Skills that trigger this guardrail. Leave empty to match all skills at this checkpoint.</p>
                <ChipInput values={gh.match.skills} onChange={v => setGh({ ...gh, match: { ...gh.match, skills: v } })} suggestions={allSkills} placeholder="Add skill..." />
              </label>

              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">ifPattern (optional)</span>
                <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Cheap pre-filter on the payload (regex). Skip the expensive check when it can't apply.</p>
                <input value={gh.match.ifPattern || ''} onChange={e => setGh({ ...gh, match: { ...gh.match, ifPattern: e.target.value || undefined } })} className="glass-input-console text-[13px] font-mono" placeholder="e.g. refund|compensation" />
              </label>
            </div>

            {/* ── 3. HOW does it decide? ── */}
            <div className="space-y-3 border border-[var(--border-subtle)] rounded-xl p-3 bg-black/[0.01]">
              <span className="text-[11px] text-[var(--fog)] font-medium">3. How does it decide?</span>

              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">Check kind</span>
                <select value={gh.check.kind} onChange={e => setGh({ ...gh, check: { ...gh.check, kind: e.target.value as 'rule' | 'ai' } })} className="glass-input-console text-[13px]">
                  {CHECK_KINDS.map(k => (<option key={k.value} value={k.value}>{k.label}</option>))}
                </select>
              </label>

              {gh.check.kind === 'rule' ? (
                <>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Deny Skills</span>
                    <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Skills the agent is never allowed to call.</p>
                    <ChipInput values={gh.check.denySkills || []} onChange={v => setGh({ ...gh, check: { ...gh.check, denySkills: v.length ? v : undefined } })} suggestions={allSkills} placeholder="Add skill..." />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Require Skills (all)</span>
                    <p className="text-[10px] text-[var(--smoke)] -mt-0.5">All listed skills must have been called.</p>
                    <ChipInput values={gh.check.requireSkills || []} onChange={v => setGh({ ...gh, check: { ...gh.check, requireSkills: v.length ? v : undefined } })} suggestions={allSkills} placeholder="Add skill..." />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Require Skills (any)</span>
                    <p className="text-[10px] text-[var(--smoke)] -mt-0.5">At least one listed skill must have been called.</p>
                    <ChipInput values={gh.check.requireSkillsAny || []} onChange={v => setGh({ ...gh, check: { ...gh.check, requireSkillsAny: v.length ? v : undefined } })} suggestions={allSkills} placeholder="Add skill..." />
                  </label>
                </>
              ) : (
                <>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Evaluation Prompt</span>
                    <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Describe what the AI should check. Use placeholders for dynamic values.</p>
                    <textarea ref={textareaRef} value={gh.check.evaluationPrompt || ''} onChange={e => setGh({ ...gh, check: { ...gh.check, evaluationPrompt: e.target.value } })} rows={5} className="glass-input-console text-[13px] resize-y" placeholder="e.g. Check if the agent verified the user's identity before resolving the case" />
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] text-[var(--smoke)]">Insert:</span>
                      {PLACEHOLDERS.map(ph => (
                        <button key={ph} type="button" onClick={() => insertPlaceholder(ph)} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-lavender/[0.06] border border-lavender/15 text-lavender hover:bg-lavender/[0.12] transition-colors cursor-pointer">{ph}</button>
                      ))}
                    </div>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Model override (optional)</span>
                    <input value={gh.check.model || ''} onChange={e => setGh({ ...gh, check: { ...gh.check, model: e.target.value || undefined } })} className="glass-input-console text-[13px] font-mono" placeholder="e.g. MiniMax-M2.7-highspeed" />
                  </label>
                </>
              )}
            </div>

            {/* ── 4. WHAT on violation? ── */}
            <div className="space-y-3 border border-[var(--border-subtle)] rounded-xl p-3 bg-black/[0.01]">
              <span className="text-[11px] text-[var(--fog)] font-medium">4. What happens on violation?</span>

              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">Action</span>
                <select value={gh.onViolation.action} onChange={e => setGh({ ...gh, onViolation: { ...gh.onViolation, action: e.target.value as any } })} className="glass-input-console text-[13px]">
                  {VIOLATION_ACTIONS.map(a => (<option key={a.value} value={a.value}>{a.label}</option>))}
                </select>
              </label>

              {gh.onViolation.action === 'block' && (
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">Guidance message</span>
                  <p className="text-[10px] text-[var(--smoke)] -mt-0.5">What the agent is told when blocked.</p>
                  <textarea value={gh.onViolation.guidance || ''} onChange={e => setGh({ ...gh, onViolation: { ...gh.onViolation, guidance: e.target.value || undefined } })} rows={2} className="glass-input-console text-[13px] resize-y" placeholder="e.g. Complete the required investigation first." />
                </label>
              )}

              {gh.onViolation.action === 'invoke_tool' && (
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">Tool to invoke</span>
                  <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Only safe control-flow tools are allowed.</p>
                  <select value={gh.onViolation.tool || ''} onChange={e => setGh({ ...gh, onViolation: { ...gh.onViolation, tool: e.target.value || undefined } })} className="glass-input-console text-[13px]">
                    <option value="">Select a tool...</option>
                    {SAFE_TOOLS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                </label>
              )}
            </div>

            {/* ── 5. FALLBACK if check can't run? ── */}
            <div className="space-y-3 border border-[var(--border-subtle)] rounded-xl p-3 bg-black/[0.01]">
              <span className="text-[11px] text-[var(--fog)] font-medium">5. Fallback if the check can't run?</span>
              <p className="text-[10px] text-[var(--smoke)] -mt-1">What happens when the AI evaluation is unavailable (e.g. LLM outage).</p>

              {highRisk && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-vermillion/[0.06] border border-vermillion/15">
                  <AlertTriangle className="w-3.5 h-3.5 text-vermillion flex-shrink-0" />
                  <span className="text-[10px] text-vermillion font-medium">This hook targets high-risk skills. "Open" (allow) is not available — the platform requires fail-closed safety.</span>
                </div>
              )}

              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">On unavailable</span>
                <select value={gh.onUnavailable.action} onChange={e => setGh({ ...gh, onUnavailable: { ...gh.onUnavailable, action: e.target.value as any } })} className="glass-input-console text-[13px]">
                  {UNAVAILABLE_ACTIONS.filter(a => !(highRisk && a.value === 'open')).map(a => (<option key={a.value} value={a.value}>{a.label}</option>))}
                </select>
              </label>

              {gh.onUnavailable.action === 'invoke_tool' && (
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">Tool to invoke</span>
                  <p className="text-[10px] text-[var(--smoke)] -mt-0.5">System tool to call when the check is unavailable.</p>
                  <select value={gh.onUnavailable.tool || ''} onChange={e => setGh({ ...gh, onUnavailable: { ...gh.onUnavailable, tool: e.target.value || undefined } })} className="glass-input-console text-[13px]">
                    <option value="">Select a tool...</option>
                    {SAFE_TOOLS.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                </label>
              )}
            </div>

            {/* ── 6. Guidance for the agent ── */}
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] font-medium">6. What is the agent told?</span>
              <p className="text-[10px] text-[var(--smoke)] -mt-0.5">Free text injected as the next instruction when blocked. Leave empty to use the generated feedback.</p>
              <textarea value={gh.guidance || ''} onChange={e => setGh({ ...gh, guidance: e.target.value || undefined })} rows={2} className="glass-input-console text-[13px] resize-y" placeholder="e.g. This tool is blocked by policy. If the customer needs this action, call create_human_task to escalate." />
            </label>

            {/* ── Preview ── */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] p-2.5">
              <span className="text-[10px] font-medium text-[var(--fog)]/60">Generated GuardrailHook JSON</span>
              <pre className="text-[10px] font-mono text-[var(--mist)] mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {JSON.stringify(gh, null, 2)}
              </pre>
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-2"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('common.enabled')}</span></label>

            {saveError && (
              <div className="text-[12px] text-vermillion bg-vermillion/[0.06] border border-vermillion/15 rounded-lg px-3 py-2">{saveError}</div>
            )}

            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]"><button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">{t('common.save')}</button><button type="button" onClick={() => { setEditing(null); setSaveError(null) }} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">{t('common.cancel')}</button></div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  </div>
  )
}
