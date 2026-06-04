'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Shield, Plus, Pencil, Trash2, AlertTriangle, Eye, CheckCircle, ToggleLeft, ToggleRight, Sparkles, Code, Layout, BarChart3 } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import ChipInput from '@/components/ui/chip-input'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { useConsoleLocale } from '@/components/locale-provider'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useCapabilityBindings, checkItemBinding, toggleItemBinding, BindingIndicator } from '@/components/admin/binding-column'

interface PolicyItem { id: string; name: string; description: string; hook: string; rule: string; enabled: boolean }
interface RuleFields {
  deny_skills: string[]
  require_skills: string[]
  require_skills_any: string[]
  hook_skills: string[]
  enableLlm: boolean
  evaluationPrompt: string
  guardrailType?: GuardrailType
}

const PLACEHOLDERS = ['{{skill_name}}', '{{skill_output}}', '{{confirmed_facts}}', '{{skills_called}}']

function parseRule(rule: string): RuleFields {
  try {
    const r = JSON.parse(rule || '{}')
    return {
      deny_skills: Array.isArray(r.deny_skills) ? r.deny_skills : [],
      require_skills: Array.isArray(r.require_skills) ? r.require_skills : [],
      require_skills_any: Array.isArray(r.require_skills_any) ? r.require_skills_any : [],
      hook_skills: Array.isArray(r.hook_skills) ? r.hook_skills : [],
      enableLlm: r.enableLlm !== false,
      evaluationPrompt: r.evaluationPrompt || '',
      guardrailType: r.guardrailType as GuardrailType | undefined,
    }
  } catch {
    return { deny_skills: [], require_skills: [], require_skills_any: [], hook_skills: [], enableLlm: true, evaluationPrompt: '' }
  }
}

function buildRule(f: RuleFields): string {
  const rule: Record<string, unknown> = {}
  if (f.deny_skills.length) rule.deny_skills = f.deny_skills
  if (f.require_skills.length) rule.require_skills = f.require_skills
  if (f.require_skills_any.length) rule.require_skills_any = f.require_skills_any
  if (f.hook_skills.length) rule.hook_skills = f.hook_skills
  if (!f.enableLlm) rule.enableLlm = false
  if (f.evaluationPrompt) rule.evaluationPrompt = f.evaluationPrompt
  if (f.guardrailType) rule.guardrailType = f.guardrailType
  return JSON.stringify(rule)
}

const HOOK_SLUGS = ['preTool', 'postTool', 'preFinalize'] as const

type GuardrailType = 'must_call' | 'must_call_any' | 'never_allow' | 'ai_eval' | 'ai_eval_filtered'
type PolicyFormMode = 'simple' | 'advanced'

const GUARDRAIL_LABELS: Record<GuardrailType, string> = {
  must_call: 'Must call (all)',
  must_call_any: 'Must call (any one)',
  never_allow: 'Never allow',
  ai_eval: 'AI evaluation',
  ai_eval_filtered: 'AI evaluation (filtered)',
}

const HOOK_SIMPLE_LABELS: Record<string, string> = {
  preTool: 'Before any tool',
  postTool: 'After any tool',
  preFinalize: 'Before case resolution',
}

function detectGuardrailType(f: RuleFields): GuardrailType {
  // Prefer the explicit stored field; fall back to field-based detection
  if (f.guardrailType) return f.guardrailType
  // Priority: deny > require_skills > require_skills_any > ai eval
  if (f.deny_skills.length > 0) return 'never_allow'
  if (f.require_skills.length > 0) return 'must_call'
  if (f.require_skills_any.length > 0) return 'must_call_any'
  if (f.evaluationPrompt && f.enableLlm) {
    return f.hook_skills.length > 0 ? 'ai_eval_filtered' : 'ai_eval'
  }
  // Fallback: if nothing configured, default to must_call
  return 'must_call'
}

function getGuardrailTargetSkills(f: RuleFields, type?: GuardrailType): string[] {
  const gt = type || detectGuardrailType(f)
  if (gt === 'never_allow') return f.deny_skills
  if (gt === 'must_call') return f.require_skills
  if (gt === 'must_call_any') return f.require_skills_any
  return []
}

function summarizeRule(rule: string): string {
  const f = parseRule(rule)
  const parts: string[] = []
  if (f.deny_skills.length) parts.push(`Blocks: ${f.deny_skills.join(', ')}`)
  if (f.require_skills.length) parts.push(`Requires ALL: ${f.require_skills.join(', ')}`)
  if (f.require_skills_any.length) parts.push(`Requires ANY: ${f.require_skills_any.join(', ')}`)
  if (f.hook_skills.length) parts.push(`Trigger: ${f.hook_skills.join(', ')}`)
  if (f.evaluationPrompt && f.enableLlm !== false) {
    const preview = f.evaluationPrompt.length > 60 ? f.evaluationPrompt.slice(0, 60) + '…' : f.evaluationPrompt
    parts.push(`AI: ${preview}`)
  }
  return parts.length ? parts.join(' · ') : 'No conditions configured'
}

function applyGuardrailToRule(f: RuleFields, type: GuardrailType, skills: string[], condition: string): RuleFields {
  // Preserve existing fields — only modify what this guardrail type controls
  const next = { ...f, guardrailType: type }
  switch (type) {
    case 'must_call':
      next.require_skills = skills
      break
    case 'must_call_any':
      next.require_skills_any = skills
      break
    case 'never_allow':
      next.deny_skills = skills
      break
    case 'ai_eval':
      next.evaluationPrompt = condition
      next.enableLlm = true
      break
    case 'ai_eval_filtered':
      next.evaluationPrompt = condition
      next.enableLlm = true
      // hook_skills is controlled separately via the filtered skills chip in UI
      break
  }
  return next
}

export default function PoliciesPage() {
  const { t } = useConsoleLocale()
  const agentId = useSelectedAgentId()
  const { bindings, saveBindings } = useCapabilityBindings(agentId)
  const hookMeta = useMemo(
    () =>
      ({
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
  const defaultFields: RuleFields = { deny_skills: [], require_skills: [], require_skills_any: [], hook_skills: [], enableLlm: true, evaluationPrompt: '' }
  const [ruleFields, setRuleFields] = useState<RuleFields>(defaultFields)
  const [formMode, setFormMode] = useState<PolicyFormMode>('simple')
  const [allSkills, setAllSkills] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/policies')
    const data = await res.json()
    setItems(data.policies || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Load which policies are currently assigned to the agent
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
    const before = ruleFields.evaluationPrompt.slice(0, start)
    const after = ruleFields.evaluationPrompt.slice(end)
    const next = before + ph + after
    setRuleFields({ ...ruleFields, evaluationPrompt: next })
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + ph.length
    })
  }

  const toggleEnabled = useCallback(async (p: PolicyItem) => {
    const updated = { ...p, enabled: !p.enabled, rule: buildRule(parseRule(p.rule)) }
    await fetch(`/api/admin/policies/${encodeURIComponent(p.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    load()
  }, [load])

  const openEdit = (p: PolicyItem) => { setEditing({ ...p }); setIsNew(false); setRuleFields(parseRule(p.rule)); setFormMode('simple') }
  const openNew = () => { setEditing({ id: '', name: '', description: '', hook: 'preTool', rule: '{}', enabled: true }); setIsNew(true); setRuleFields(defaultFields); setFormMode('simple') }

  const handleSave = useCallback(async () => {
    if (!editing) return
    setSaveError(null)

    // Validate: name is required
    if (!editing.name.trim()) {
      setSaveError('Name is required.')
      return
    }
    // Validate: at least one rule condition is configured
    const hasRule = ruleFields.deny_skills.length > 0
      || ruleFields.require_skills.length > 0
      || ruleFields.require_skills_any.length > 0
      || (ruleFields.enableLlm && ruleFields.evaluationPrompt.trim().length > 0)
    if (!hasRule) {
      setSaveError('Configure at least one rule condition (deny skills, required skills, or an AI evaluation prompt).')
      return
    }

    const payload = { ...editing, rule: buildRule(ruleFields) }
    const url = isNew ? '/api/admin/policies' : `/api/admin/policies/${encodeURIComponent(editing.name)}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) {
      setSaveError(`Save failed (HTTP ${res.status}).`)
      return
    }
    setEditing(null); load()
  }, [editing, isNew, load, ruleFields])

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

  return (
    <div>
      <VersionContextBar onVersionChange={() => window.location.reload()} />
      <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('policies.title')}</h1><p className="text-[13px] text-[var(--fog)] mt-0.5">{t('policies.subtitle', { n: items.length })}</p></div>
        <button type="button" onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> {t('policies.new')}</button>
      </div>
      {items.length === 0 ? <EmptyState icon={Shield} title={t('policies.noPolicies')} description={t('policies.noPoliciesDesc')} /> : (
        <div className="space-y-6">
          {HOOK_SLUGS.map(hook => {
            const hookItems = items.filter(p => p.hook === hook)
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
                          <p className="text-[10px] text-[var(--smoke)] font-mono line-clamp-2 mb-3">{summarizeRule(p.rule)}</p>
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
                  <p className="text-[10px] text-[var(--fog)]">
                    {p.hook === 'preTool' ? 'Before tool' : p.hook === 'postTool' ? 'After tool' : 'Before resolve'}
                  </p>
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

      <ImmersiveModal open={!!editing} onClose={() => { setEditing(null); setSaveError(null) }} title={isNew ? t('policies.newPolicy') : t('policies.editPolicy')}>
        {editing && (
          <div className="space-y-4">
            {/* ── Mode toggle: Simple / Advanced ── */}
            <div className="flex rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] p-0.5">
              <button
                type="button"
                onClick={() => setFormMode('simple')}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium transition-all ${
                  formMode === 'simple'
                    ? 'bg-white shadow-sm text-[var(--mist)]'
                    : 'text-[var(--fog)] hover:text-[var(--mist)]'
                }`}
              >
                <Layout className="w-3 h-3" />
                Simple
              </button>
              <button
                type="button"
                onClick={() => setFormMode('advanced')}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium transition-all ${
                  formMode === 'advanced'
                    ? 'bg-white shadow-sm text-[var(--mist)]'
                    : 'text-[var(--fog)] hover:text-[var(--mist)]'
                }`}
              >
                <Code className="w-3 h-3" />
                Advanced
              </button>
            </div>

            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.name')}</span><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} placeholder="e.g. investigate_before_escalation" />{!isNew && <p className="text-[10px] text-[var(--smoke)]">Name cannot be changed after creation.</p>}</label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span><input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" /></label>

            {/* ── When dropdown (hook) ── */}
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)]">When</span>
              <select
                value={editing.hook}
                onChange={e => setEditing({ ...editing, hook: e.target.value })}
                className="glass-input-console text-[13px]"
              >
                {HOOK_SLUGS.map(h => (
                  <option key={h} value={h}>{HOOK_SIMPLE_LABELS[h] || h}</option>
                ))}
              </select>
            </label>

            {/* ── Simple mode (Guardrails Builder) ── */}
            {formMode === 'simple' && (() => {
              const gt = detectGuardrailType(ruleFields)
              const skills = getGuardrailTargetSkills(ruleFields)
              return (
                <>
                  <div className="border-t border-[var(--border-subtle)] pt-3">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Rule Type</span>
                  </div>

                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">Guardrail type</span>
                    <select
                      value={gt}
                      onChange={e => {
                        const newType = e.target.value as GuardrailType
                        setRuleFields(applyGuardrailToRule(ruleFields, newType, skills, ruleFields.evaluationPrompt))
                      }}
                      className="glass-input-console text-[13px]"
                    >
                      {(Object.keys(GUARDRAIL_LABELS) as GuardrailType[]).map(t => (
                        <option key={t} value={t}>{GUARDRAIL_LABELS[t]}</option>
                      ))}
                    </select>
                  </label>

                  {/* Target skills — shown for must_call, must_call_any, and never_allow */}
                  {(gt === 'must_call' || gt === 'must_call_any' || gt === 'never_allow') && (
                    <label className="space-y-1.5 block">
                      <span className="text-[11px] text-[var(--fog)]">Target skills</span>
                      <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">
                        {gt === 'never_allow'
                          ? 'Skills the agent is never allowed to call'
                          : gt === 'must_call_any'
                            ? 'Skills the agent must call at least one of before proceeding'
                            : 'Skills the agent must call (all of them) before this hook triggers'}
                      </p>
                      <ChipInput
                        values={skills}
                        onChange={v =>
                          setRuleFields(applyGuardrailToRule(ruleFields, gt, v, ruleFields.evaluationPrompt))
                        }
                        suggestions={allSkills}
                        placeholder={t('policies.addSkill')}
                      />
                    </label>
                  )}

                  {/* AI evaluation condition (for ai_eval and ai_eval_filtered) */}
                  {(gt === 'ai_eval' || gt === 'ai_eval_filtered') && (
                    <>
                      <label className="space-y-1.5 block">
                        <span className="text-[11px] text-[var(--fog)]">Evaluation condition</span>
                        <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">
                          Describe what the AI should check for. Use {'{{skill_name}}'} and {'{{skill_output}}'} as placeholders.
                        </p>
                        <textarea
                          ref={textareaRef}
                          value={ruleFields.evaluationPrompt}
                          onChange={e =>
                            setRuleFields(applyGuardrailToRule(ruleFields, gt, [], e.target.value))
                          }
                          rows={5}
                          className="glass-input-console text-[13px] resize-y"
                          placeholder="e.g. Check if the agent verified the user's identity before resolving the case"
                        />
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-[10px] text-[var(--smoke)]">{t('policies.insertPlaceholder')}</span>
                          {PLACEHOLDERS.map(ph => (
                            <button
                              key={ph}
                              type="button"
                              onClick={() => insertPlaceholder(ph)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-lavender/[0.06] border border-lavender/15 text-lavender hover:bg-lavender/[0.12] transition-colors cursor-pointer"
                              title={`Insert ${ph}`}
                            >
                              {ph}
                            </button>
                          ))}
                        </div>
                      </label>

                      {/* Trigger skills (hook_skills) — only for ai_eval_filtered, or always shown when hook is postTool */}
                      {gt === 'ai_eval_filtered' && (
                        <label className="space-y-1.5 block">
                          <span className="text-[11px] text-[var(--fog)]">Trigger skills (filter)</span>
                          <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">
                            Only evaluate this guardrail when these specific skills are called. Leave empty to evaluate on all skills.
                          </p>
                          <ChipInput
                            values={ruleFields.hook_skills}
                            onChange={v => setRuleFields({ ...ruleFields, hook_skills: v })}
                            suggestions={allSkills}
                            placeholder={t('policies.addSkill')}
                          />
                        </label>
                      )}
                    </>
                  )}

                  {/* Preview of generated JSON */}
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] p-2.5">
                    <span className="text-[10px] font-medium text-[var(--fog)]/60">Generated policy JSON</span>
                    <pre className="text-[10px] font-mono text-[var(--mist)] mt-1 whitespace-pre-wrap break-all">
                      {JSON.stringify(JSON.parse(buildRule(ruleFields)), null, 2)}
                    </pre>
                  </div>
                </>
              )
            })()}

            {/* ── Advanced mode (raw JSON editor) ── */}
            {formMode === 'advanced' && (
              <>
                <div className="border-t border-[var(--border-subtle)] pt-3"><span className="text-[11px] font-medium text-[var(--fog)]">{t('policies.ruleFields')}</span></div>

                {/* ── Exact-match rules ──────────────────────── */}
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('policies.denySkills')}</span>
                  <ChipInput values={ruleFields.deny_skills} onChange={v => setRuleFields({ ...ruleFields, deny_skills: v })} suggestions={allSkills} placeholder={t('policies.addSkill')} />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('policies.requireSkills')}</span>
                  <ChipInput values={ruleFields.require_skills} onChange={v => setRuleFields({ ...ruleFields, require_skills: v })} suggestions={allSkills} placeholder={t('policies.addSkill')} />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('policies.requireSkillsAny')}</span>
                  <ChipInput values={ruleFields.require_skills_any} onChange={v => setRuleFields({ ...ruleFields, require_skills_any: v })} suggestions={allSkills} placeholder={t('policies.addSkill')} />
                </label>

                {/* ── postTool hook_skills ──────────────────── */}
                {editing.hook === 'postTool' && (
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">{t('policies.hookSkills')}</span>
                    <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">{t('policies.hookSkillsDesc')}</p>
                    <ChipInput values={ruleFields.hook_skills} onChange={v => setRuleFields({ ...ruleFields, hook_skills: v })} suggestions={allSkills} placeholder={t('policies.addSkill')} />
                  </label>
                )}

                {/* ── LLM evaluation toggle ─────────────────── */}
                <div className="border-t border-[var(--border-subtle)] pt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={ruleFields.enableLlm} onChange={e => setRuleFields({ ...ruleFields, enableLlm: e.target.checked })} className="accent-indigo rounded" />
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-lavender" />
                      <span className="text-[12px] font-medium text-[var(--mist)]">{t('policies.enableLlm')}</span>
                    </span>
                  </label>
                  <p className="text-[10px] text-[var(--smoke)] mt-0.5 ml-6">{ruleFields.enableLlm ? t('policies.enableLlmDesc') : t('policies.llmDisabledHint')}</p>
                </div>

                {/* ── evaluationPrompt (LLM) ────────────────── */}
                {ruleFields.enableLlm && (
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] text-[var(--fog)]">{t('policies.evaluationPrompt')}</span>
                    <textarea
                      ref={textareaRef}
                      value={ruleFields.evaluationPrompt}
                      onChange={e => setRuleFields({ ...ruleFields, evaluationPrompt: e.target.value })}
                      rows={5}
                      className="glass-input-console text-[13px] resize-y"
                      placeholder={t('policies.phEvalPrompt')}
                    />
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] text-[var(--smoke)]">{t('policies.insertPlaceholder')}</span>
                      {PLACEHOLDERS.map(ph => (
                        <button
                          key={ph}
                          type="button"
                          onClick={() => insertPlaceholder(ph)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-lavender/[0.06] border border-lavender/15 text-lavender hover:bg-lavender/[0.12] transition-colors cursor-pointer"
                          title={`Insert ${ph}`}
                        >
                          {ph}
                        </button>
                      ))}
                    </div>
                  </label>
                )}
              </>
            )}

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
