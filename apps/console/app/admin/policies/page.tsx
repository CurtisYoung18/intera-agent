'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Shield, Plus, Pencil, Trash2, AlertTriangle, Eye, CheckCircle, ToggleLeft, ToggleRight, Sparkles, Code, Layout } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import ChipInput from '@/components/ui/chip-input'
import { useConsoleLocale } from '@/components/locale-provider'

interface PolicyItem { id: string; name: string; description: string; hook: string; rule: string; enabled: boolean }
interface RuleFields {
  deny_skills: string[]
  require_skills: string[]
  require_skills_any: string[]
  hook_skills: string[]
  enableLlm: boolean
  evaluationPrompt: string
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
  return JSON.stringify(rule)
}

const HOOK_SLUGS = ['preTool', 'postTool', 'preFinalize'] as const

type GuardrailType = 'must_call' | 'never_allow' | 'ai_eval'
type PolicyFormMode = 'simple' | 'advanced'

const GUARDRAIL_LABELS: Record<GuardrailType, string> = {
  must_call: 'Must call',
  never_allow: 'Never allow',
  ai_eval: 'AI evaluation',
}

const HOOK_SIMPLE_LABELS: Record<string, string> = {
  preTool: 'Before any tool',
  postTool: 'After any tool',
  preFinalize: 'Before case resolution',
}

function detectGuardrailType(f: RuleFields): GuardrailType {
  if (f.deny_skills.length > 0) return 'never_allow'
  if (f.require_skills.length > 0) return 'must_call'
  if (f.enableLlm && f.evaluationPrompt) return 'ai_eval'
  return 'must_call'
}

function getGuardrailTargetSkills(f: RuleFields): string[] {
  const gt = detectGuardrailType(f)
  if (gt === 'never_allow') return f.deny_skills
  if (gt === 'must_call') return f.require_skills
  return []
}

function summarizeRule(rule: string): string {
  const f = parseRule(rule)
  const gt = detectGuardrailType(f)
  const targets = getGuardrailTargetSkills(f)
  if (gt === 'never_allow' && targets.length) return `Blocks: ${targets.join(', ')}`
  if (gt === 'must_call' && targets.length) return `Requires: ${targets.join(', ')} before proceeding`
  if (gt === 'ai_eval' && f.evaluationPrompt) return `AI checks: ${f.evaluationPrompt.slice(0, 80)}${f.evaluationPrompt.length > 80 ? '…' : ''}`
  return 'No conditions configured'
}

function applyGuardrailToRule(f: RuleFields, type: GuardrailType, skills: string[], condition: string): RuleFields {
  const base: RuleFields = {
    deny_skills: [],
    require_skills: [],
    require_skills_any: [],
    hook_skills: [],
    enableLlm: false,
    evaluationPrompt: '',
  }
  switch (type) {
    case 'must_call':
      return { ...base, require_skills: skills }
    case 'never_allow':
      return { ...base, deny_skills: skills }
    case 'ai_eval':
      return { ...base, enableLlm: true, evaluationPrompt: condition }
  }
}

export default function PoliciesPage() {
  const { t } = useConsoleLocale()
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
    const payload = { ...editing, rule: buildRule(ruleFields) }
    const url = isNew ? '/api/admin/policies' : `/api/admin/policies/${encodeURIComponent(editing.name)}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) return alert(t('common.failedSave', { status: res.status }))
    setEditing(null); load()
  }, [editing, isNew, load, ruleFields, t])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(t('common.deleteConfirm', { name }))) return
    await fetch(`/api/admin/policies/${encodeURIComponent(name)}`, { method: 'DELETE' })
    load()
  }, [load, t])

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('policies.title')}</h1><p className="text-[13px] text-[var(--fog)] mt-0.5">{t('policies.subtitle', { n: items.length })}</p></div>
        <button type="button" onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"><Plus className="w-4 h-4" /> {t('policies.new')}</button>
      </div>
      {items.length === 0 ? <EmptyState icon={Shield} title={t('policies.noPolicies')} description={t('policies.noPoliciesDesc')} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(p => { const hm = hookMeta[p.hook] || hookMeta.preTool; const Icon = hm.icon
            return (
              <TiltCard key={p.id || p.name} accentColor={hm.color} onClick={() => openEdit(p)}>
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber/[0.06] flex-shrink-0"><Icon className="w-5 h-5 text-amber" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{p.name}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-indigo/[0.06] text-indigo mt-0.5 inline-block">{hm.label}</span>
                    </div>
                    <button onClick={e => { e.stopPropagation(); toggleEnabled(p) }} className="flex-shrink-0">
                      {p.enabled ? <ToggleRight className="w-7 h-7 text-malachite" /> : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-1">{p.description || t('common.noDescription')}</p>
                  <p className="text-[10px] text-[var(--smoke)] font-mono line-clamp-2 mb-3">{summarizeRule(p.rule)}</p>
                  <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                    <span className="text-[10px] text-[var(--smoke)]">{p.enabled ? t('common.active') : t('common.inactive')}</span>
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
      )}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? t('policies.newPolicy') : t('policies.editPolicy')}>
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

            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.name')}</span><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} /></label>
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

                  {/* Target skills — shown for must_call and never_allow */}
                  {(gt === 'must_call' || gt === 'never_allow') && (
                    <label className="space-y-1.5 block">
                      <span className="text-[11px] text-[var(--fog)]">Target skills</span>
                      <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">
                        {gt === 'must_call'
                          ? 'Skills the agent must call before this hook triggers'
                          : 'Skills the agent is never allowed to call'}
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

                  {/* AI evaluation condition */}
                  {gt === 'ai_eval' && (
                    <label className="space-y-1.5 block">
                      <span className="text-[11px] text-[var(--fog)]">Evaluation condition</span>
                      <p className="text-[10px] text-[var(--smoke)] -mt-0.5 mb-0.5">
                        Describe what the AI should check for. Use {'{{skill_name}}'} and {'{{skill_output}}'} as placeholders.
                      </p>
                      <textarea
                        ref={textareaRef}
                        value={ruleFields.evaluationPrompt}
                        onChange={e =>
                          setRuleFields(applyGuardrailToRule(ruleFields, 'ai_eval', [], e.target.value))
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
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]"><button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">{t('common.save')}</button><button type="button" onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">{t('common.cancel')}</button></div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
