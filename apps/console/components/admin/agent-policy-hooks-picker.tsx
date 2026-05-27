'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, X } from 'lucide-react'
import type { PolicyHook, PolicyHooks } from '@intera/shared/types'
import { useConsoleLocale } from '@/components/locale-provider'
import { drawerFieldClass } from '@/components/admin/agent-config-drawer-ui'

type PolicyRow = {
  id: string
  name: string
  description: string | null
  hook: string
  enabled: boolean
  rule?: string
}

function summarizeRule(rule?: string): string {
  if (!rule) return ''
  try {
    const r = JSON.parse(rule || '{}')
    const parts: string[] = []
    if (Array.isArray(r.deny_skills) && r.deny_skills.length) parts.push(`Deny: ${r.deny_skills.join(', ')}`)
    if (Array.isArray(r.require_skills) && r.require_skills.length) parts.push(`Need all: ${r.require_skills.join(', ')}`)
    if (Array.isArray(r.require_skills_any) && r.require_skills_any.length) parts.push(`Need any: ${r.require_skills_any.join(', ')}`)
    if (r.evaluationPrompt && r.enableLlm !== false) {
      const preview = r.evaluationPrompt.length > 50 ? r.evaluationPrompt.slice(0, 50) + '…' : r.evaluationPrompt
      parts.push(`AI: ${preview}`)
    }
    return parts.join(' · ')
  } catch {
    return ''
  }
}

const HOOK_ORDER: PolicyHook[] = ['preTool', 'postTool', 'preFinalize']

function stringifyHooks(h: PolicyHooks): string {
  return JSON.stringify(h, null, 2)
}

function parseHooksJson(raw: string): PolicyHooks | null {
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const pick = (k: keyof PolicyHooks) =>
      Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []
    return {
      preTool: pick('preTool'),
      postTool: pick('postTool'),
      preFinalize: pick('preFinalize'),
    }
  } catch {
    return null
  }
}

interface Props {
  value: string
  onChange: (nextJson: string) => void
}

export default function AgentPolicyHooksPicker({ value, onChange }: Props) {
  const { t } = useConsoleLocale()
  const [catalog, setCatalog] = useState<PolicyRow[]>([])
  const [loadErr, setLoadErr] = useState(false)

  const parsed = useMemo(() => parseHooksJson(value), [value])

  useEffect(() => {
    fetch('/api/admin/policies')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => setCatalog((d.policies || []) as PolicyRow[]))
      .catch(() => setLoadErr(true))
  }, [])

  const byName = useMemo(() => {
    const m = new Map<string, PolicyRow>()
    for (const p of catalog) m.set(p.name, p)
    return m
  }, [catalog])

  const mutate = useCallback((next: PolicyHooks) => onChange(stringifyHooks(next)), [onChange])

  const hooks = parsed ?? ({ preTool: [], postTool: [], preFinalize: [] } satisfies PolicyHooks)

  if (parsed === null) {
    return (
      <div className="space-y-3">
        <p className="text-[12px] text-amber-800/90 bg-amber-500/12 border border-amber-500/20 rounded-lg px-3 py-2">
          {t('agent.policyInvalidJson')}
        </p>
        <textarea
          value={value}
          spellCheck={false}
          rows={14}
          onChange={(e) => onChange(e.target.value)}
          className={`glass-input-console resize-y ${drawerFieldClass(true)} w-full`}
        />
      </div>
    )
  }

  const eligibleToAdd = (hook: PolicyHook) => {
    const taken = new Set(hooks[hook])
    const out: PolicyRow[] = []
    for (const p of catalog) {
      if (!p.enabled || taken.has(p.name)) continue
      out.push(p)
    }
    return out.sort((a, b) => {
      const ap = (a.hook as PolicyHook) === hook ? 0 : 1
      const bp = (b.hook as PolicyHook) === hook ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.name.localeCompare(b.name)
    })
  }

  const hookLabel = (h: PolicyHook) => {
    if (h === 'preTool') return t('agent.policyColumn.preTool')
    if (h === 'postTool') return t('agent.policyColumn.postTool')
    return t('agent.policyColumn.preFinalize')
  }

  const hookAccent: Record<PolicyHook, string> = {
    preTool: '#5b8af7',
    postTool: '#d4912e',
    preFinalize: '#2ea04a',
  }

  const moveWithin = (hook: PolicyHook, index: number, dir: -1 | 1) => {
    const list = [...hooks[hook]]
    const ni = index + dir
    if (ni < 0 || ni >= list.length) return
    ;[list[index], list[ni]] = [list[ni], list[index]]
    mutate({ ...hooks, [hook]: list })
  }

  const removeAt = (hook: PolicyHook, index: number) => {
    const list = hooks[hook].filter((_, i) => i !== index)
    mutate({ ...hooks, [hook]: list })
  }

  const addNamed = (hook: PolicyHook, name: string) => {
    if (!name || hooks[hook].includes(name)) return
    mutate({ ...hooks, [hook]: [...hooks[hook], name] })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {loadErr && (
        <p className="text-[11px] text-vermillion shrink-0">{t('agent.policyCatalogLoadFail')}</p>
      )}
      <div className="flex flex-wrap gap-2 shrink-0">
        <Link
          href="/admin/guardrails"
          className="inline-flex items-center gap-1 text-[11px] text-indigo hover:underline"
        >
          {t('agent.policyOpenLibrary')}
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div className="flex-1 min-h-0 space-y-3 pt-4 pb-2">
        {HOOK_ORDER.map((hook) => (
          <div
            key={hook}
            className="rounded-xl border border-black/[0.08] bg-white/[0.45] overflow-hidden shadow-[0_1px_12px_rgba(0,0,0,0.04)]"
          >
            <div
              className="flex items-center gap-2 px-3 py-2 border-b border-black/[0.05]"
              style={{ backgroundColor: `${hookAccent[hook]}10` }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: hookAccent[hook] }}
              />
              <span className="text-[13px] font-semibold text-[var(--mist)]">{hookLabel(hook)}</span>
              <span className="text-[10px] text-[var(--fog)]/70 font-mono">{hook}</span>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex flex-wrap gap-2 min-h-[36px]">
                {hooks[hook].length === 0 ? (
                  <span className="text-[11px] text-[var(--fog)]/55 italic">{t('agent.policyNoneYet')}</span>
                ) : (
                  hooks[hook].map((name, idx) => {
                    const meta = byName.get(name)
                    const unknown = !meta
                    const hookMismatch = meta && (meta.hook as PolicyHook) !== hook
                    const ruleDesc = summarizeRule(meta?.rule)
                    return (
                      <div
                        key={`${hook}-${name}-${idx}`}
                        className="group inline-flex items-stretch rounded-lg border border-black/[0.08] bg-white/80 shadow-sm overflow-hidden"
                      >
                        <div className="px-2.5 py-1.5 min-w-0 max-w-[280px]">
                          <div className="flex items-center gap-1.5">
                            <a
                              href="/admin/guardrails"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] font-mono text-indigo hover:underline truncate cursor-pointer"
                              title={`Edit ${name}`}
                            >
                              {name}
                            </a>
                            {hookMismatch && (
                              <span
                                className="shrink-0 text-[12px] leading-none cursor-help"
                                title={`Original hook: ${meta!.hook}. Assigned here to ${hook}.`}
                              >
                                ⚠
                              </span>
                            )}
                          </div>
                          {unknown ? (
                            <div className="text-[10px] text-amber-700/80">{t('agent.policyOrphan')}</div>
                          ) : ruleDesc ? (
                            <div className="text-[10px] text-[var(--fog)]/60 truncate mt-0.5" title={ruleDesc}>{ruleDesc}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-col border-l border-black/[0.06] bg-black/[0.02]">
                          <button
                            type="button"
                            className="p-1 hover:bg-black/[0.06] disabled:opacity-25"
                            disabled={idx === 0}
                            onClick={() => moveWithin(hook, idx, -1)}
                            aria-label="Move up"
                          >
                            <ArrowUp className="w-3.5 h-3.5 text-[var(--fog)]" />
                          </button>
                          <button
                            type="button"
                            className="p-1 hover:bg-black/[0.06] disabled:opacity-25"
                            disabled={idx === hooks[hook].length - 1}
                            onClick={() => moveWithin(hook, idx, 1)}
                            aria-label="Move down"
                          >
                            <ArrowDown className="w-3.5 h-3.5 text-[var(--fog)]" />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="px-2 border-l border-black/[0.06] hover:bg-vermillion/10 text-[var(--fog)] hover:text-vermillion transition-colors"
                          onClick={() => removeAt(hook, idx)}
                          aria-label="Remove policy"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="glass-input-console text-[12px] font-mono flex-1 min-w-0 rounded-lg py-2"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) addNamed(hook, v)
                    e.target.value = ''
                  }}
                >
                  <option value="">{t('agent.policyPickAdd')}</option>
                  {(() => {
                    const eligible = eligibleToAdd(hook)
                    const matching = eligible.filter(p => (p.hook as PolicyHook) === hook)
                    const other = eligible.filter(p => (p.hook as PolicyHook) !== hook)
                    return (
                      <>
                        {matching.length > 0 && (
                          <optgroup label={`— ${hookLabel(hook)} —`}>
                            {matching.map((p) => (
                              <option key={p.id} value={p.name}>{p.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {other.length > 0 && (
                          <optgroup label="— Other hooks —">
                            {other.map((p) => (
                              <option key={p.id} value={p.name}>{p.name} ({p.hook})</option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )
                  })()}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
