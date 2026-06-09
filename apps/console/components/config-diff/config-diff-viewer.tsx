'use client'

import type { ReactNode } from 'react'

export type ConfigDiffStatus = 'added' | 'changed' | 'removed' | 'unchanged' | 'placeholder'

export interface ConfigDiffItem {
  key: string
  label: string
  detail?: string
  status: ConfigDiffStatus
  before?: string
  after?: string
}

export interface ConfigDiffGroup {
  id: string
  title: string
  description: string
  status?: ConfigDiffStatus
  summary?: string
  items: ConfigDiffItem[]
  placeholder?: string
  action?: ReactNode
}

interface ConfigDiffViewerProps {
  title?: string
  subtitle?: string
  groups: ConfigDiffGroup[]
  emptyLabel?: string
}

const STATUS_LABEL: Record<ConfigDiffStatus, string> = {
  added: 'Added',
  changed: 'Changed',
  removed: 'Removed',
  unchanged: 'No change',
  placeholder: 'Placeholder',
}

const STATUS_CLASS: Record<ConfigDiffStatus, string> = {
  added: 'border-[color:color-mix(in_srgb,var(--color-signal-success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-success)_12%,white)] text-[var(--color-text-primary)]',
  changed: 'border-[color:color-mix(in_srgb,var(--color-signal-warning)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-warning)_13%,white)] text-[var(--color-text-primary)]',
  removed: 'border-[color:color-mix(in_srgb,var(--color-signal-danger)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_10%,white)] text-[var(--color-text-primary)]',
  unchanged: 'border-[var(--color-border-subtle)] bg-white/65 text-[var(--color-text-tertiary)]',
  placeholder: 'border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]',
}

function summarize(items: ConfigDiffItem[]) {
  const counts = items.reduce<Record<ConfigDiffStatus, number>>((acc, item) => {
    acc[item.status] += 1
    return acc
  }, { added: 0, changed: 0, removed: 0, unchanged: 0, placeholder: 0 })
  const parts = [
    counts.added ? `${counts.added} added` : '',
    counts.changed ? `${counts.changed} changed` : '',
    counts.removed ? `${counts.removed} removed` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'No material changes'
}

function groupStatus(group: ConfigDiffGroup): ConfigDiffStatus {
  if (group.status) return group.status
  if (group.placeholder) return 'placeholder'
  if (group.items.some((item) => item.status === 'removed')) return 'removed'
  if (group.items.some((item) => item.status === 'changed')) return 'changed'
  if (group.items.some((item) => item.status === 'added')) return 'added'
  return 'unchanged'
}

export default function ConfigDiffViewer({
  title = 'Config Diff Viewer',
  subtitle = 'Grouped release changes across the Agent configuration package.',
  groups,
  emptyLabel = 'No diff data available yet.',
}: ConfigDiffViewerProps) {
  const hasGroups = groups.length > 0

  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-raised)]">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Release diff</p>
        <div className="mt-1 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-text-secondary)]">{subtitle}</p>
          </div>
        </div>
      </div>
      {!hasGroups ? (
        <div className="px-5 py-8 text-[13px] text-[var(--color-text-secondary)]">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {groups.map((group) => {
            const status = groupStatus(group)
            const summary = group.summary ?? summarize(group.items)
            return (
              <details key={group.id} open className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{group.title}</h3>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">{group.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[12px] font-medium text-[var(--color-text-primary)]">{summary}</p>
                    {group.action}
                  </div>
                </summary>
                <div className="px-5 pb-5">
                  {group.placeholder ? (
                    <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">{group.placeholder}</div>
                  ) : group.items.length === 0 ? (
                    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/60 px-4 py-3 text-[12px] text-[var(--color-text-tertiary)]">No rows in this group.</div>
                  ) : (
                    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70">
                      {group.items.map((item) => (
                        <div key={item.key} className="grid gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-b-0 lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1fr)]">
                          <div>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                            <p className="mt-2 text-[13px] font-medium text-[var(--color-text-primary)]">{item.label}</p>
                            {item.detail ? <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">{item.detail}</p> : null}
                          </div>
                          <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-surface-muted)] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Live</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">{item.before ?? 'Not present'}</p>
                          </div>
                          <div className="rounded-[var(--radius-control)] bg-[color:color-mix(in_srgb,var(--color-accent-primary)_7%,white)] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">Draft</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">{item.after ?? 'Not present'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
