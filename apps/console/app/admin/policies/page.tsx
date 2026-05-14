'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield, Plus, Pencil, Trash2, AlertTriangle, Eye, CheckCircle, ToggleLeft, ToggleRight } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import { useConsoleLocale } from '@/components/locale-provider'

interface PolicyItem { id: string; name: string; description: string; hook: string; rule: string; enabled: boolean }
interface RuleFields { deny_skills: string; require_skills: string; require_skills_any: string; evaluationPrompt: string; min_evidence_count: number }

function parseRule(rule: string): RuleFields {
  try { const r = JSON.parse(rule || '{}'); return { deny_skills: (r.deny_skills || []).join(', '), require_skills: (r.require_skills || []).join(', '), require_skills_any: (r.require_skills_any || []).join(', '), evaluationPrompt: r.evaluationPrompt || '', min_evidence_count: r.min_evidence_count ?? 0 } }
  catch { return { deny_skills: '', require_skills: '', require_skills_any: '', evaluationPrompt: '', min_evidence_count: 0 } }
}
function buildRule(f: RuleFields): string {
  const rule: Record<string, unknown> = {}
  if (f.deny_skills) rule.deny_skills = f.deny_skills.split(',').map(s => s.trim()).filter(Boolean)
  if (f.require_skills) rule.require_skills = f.require_skills.split(',').map(s => s.trim()).filter(Boolean)
  if (f.require_skills_any) rule.require_skills_any = f.require_skills_any.split(',').map(s => s.trim()).filter(Boolean)
  if (f.evaluationPrompt) rule.evaluationPrompt = f.evaluationPrompt
  if (f.min_evidence_count) rule.min_evidence_count = f.min_evidence_count
  return JSON.stringify(rule)
}

const HOOK_SLUGS = ['preTool', 'postTool', 'preFinalize'] as const

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
  const [ruleFields, setRuleFields] = useState<RuleFields>({ deny_skills: '', require_skills: '', require_skills_any: '', evaluationPrompt: '', min_evidence_count: 0 })

  const load = useCallback(async () => { const res = await fetch('/api/admin/policies'); const data = await res.json(); setItems(data.policies || []); setLoading(false) }, [])
  useEffect(() => { load() }, [load])

  const toggleEnabled = useCallback(async (p: PolicyItem) => {
    const updated = { ...p, enabled: !p.enabled, rule: buildRule(parseRule(p.rule)) }
    await fetch(`/api/admin/policies/${encodeURIComponent(p.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
    load()
  }, [load])

  const openEdit = (p: PolicyItem) => { setEditing({ ...p }); setIsNew(false); setRuleFields(parseRule(p.rule)) }
  const openNew = () => { setEditing({ id: '', name: '', description: '', hook: 'preTool', rule: '{}', enabled: true }); setIsNew(true); setRuleFields({ deny_skills: '', require_skills: '', require_skills_any: '', evaluationPrompt: '', min_evidence_count: 0 }) }

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
                  <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">{p.description || t('common.noDescription')}</p>
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
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.name')}</span><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span><input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.hook')}</span><select value={editing.hook} onChange={e => setEditing({ ...editing, hook: e.target.value })} className="glass-input-console text-[13px]">{HOOK_SLUGS.map(h => <option key={h} value={h}>{h}</option>)}</select></label>
            <div className="border-t border-[var(--border-subtle)] pt-3"><span className="text-[11px] font-medium text-[var(--fog)]">{t('policies.ruleFields')}</span></div>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.denySkills')}</span><input value={ruleFields.deny_skills} onChange={e => setRuleFields({ ...ruleFields, deny_skills: e.target.value })} className="glass-input-console text-[13px] font-mono" placeholder={t('policies.phSkills')} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.requireSkills')}</span><input value={ruleFields.require_skills} onChange={e => setRuleFields({ ...ruleFields, require_skills: e.target.value })} className="glass-input-console text-[13px] font-mono" placeholder={t('policies.phSkills')} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.requireSkillsAny')}</span><input value={ruleFields.require_skills_any} onChange={e => setRuleFields({ ...ruleFields, require_skills_any: e.target.value })} className="glass-input-console text-[13px] font-mono" placeholder={t('policies.phSkills')} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.evaluationPrompt')}</span><textarea value={ruleFields.evaluationPrompt} onChange={e => setRuleFields({ ...ruleFields, evaluationPrompt: e.target.value })} rows={5} className="glass-input-console text-[13px] resize-y" placeholder={t('policies.phEvalPrompt')} /></label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('policies.minEvidence')}</span><input type="number" value={ruleFields.min_evidence_count} onChange={e => setRuleFields({ ...ruleFields, min_evidence_count: parseInt(e.target.value) || 0 })} className="glass-input-console text-[13px] font-mono w-28" /></label>
            <label className="flex items-center gap-2 cursor-pointer pt-2"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('common.enabled')}</span></label>
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]"><button type="button" onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">{t('common.save')}</button><button type="button" onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">{t('common.cancel')}</button></div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
