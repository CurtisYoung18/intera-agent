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
  title = 'Live Version vs Draft Changes',
  subtitle = 'Grouped release changes across the Agent configuration package.',
  groups,
  emptyLabel = 'No diff data available yet.',
}: ConfigDiffViewerProps) {
  const hasGroups = groups.length > 0

  return (
    <section className="intera-q2-panel overflow-hidden bg-[rgba(255,255,255,0.84)] shadow-[0_16px_36px_rgba(21,23,25,0.05)]">
      <div className="border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.42)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-text-secondary)]">{subtitle}</p>
      </div>
      {!hasGroups ? (
        <div className="px-5 py-8 text-[13px] text-[var(--color-text-secondary)]">{emptyLabel}</div>
      ) : (
        <div>
          <div className="hidden grid-cols-[minmax(150px,1fr)_80px_80px_minmax(140px,0.8fr)] gap-4 border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.46)] px-5 py-3 text-[12px] font-semibold text-[var(--color-text-tertiary)] lg:grid">
            <span>Component</span>
            <span>Live</span>
            <span>Draft</span>
            <span>Change</span>
          </div>
          {groups.map((group) => {
            const status = groupStatus(group)
            const summary = group.summary ?? summarize(group.items)
            const liveRows = group.items.filter((item) => item.before).length
            const draftRows = group.items.filter((item) => item.after).length
            return (
              <details key={group.id} open={status !== 'unchanged'} className="group border-b border-[var(--color-border-subtle)] last:border-b-0">
                <summary className="grid cursor-pointer list-none gap-3 px-5 py-4 transition hover:bg-[rgba(255,255,255,0.6)] group-open:bg-[rgba(255,255,255,0.42)] lg:grid-cols-[minmax(150px,1fr)_80px_80px_minmax(140px,0.8fr)] lg:gap-4">
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{group.title}</h3>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">{group.description}</p>
                  </div>
                  <div className="min-w-0 text-[13px] leading-5 text-[var(--color-text-secondary)] lg:whitespace-nowrap">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] lg:hidden">Live</p>
                    {group.placeholder ? 'Placeholder' : `${liveRows} ${liveRows === 1 ? 'row' : 'rows'}`}
                  </div>
                  <div className="min-w-0 text-[13px] leading-5 text-[var(--color-text-secondary)] lg:whitespace-nowrap">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] lg:hidden">Draft</p>
                    {group.placeholder ? 'N/A' : `${draftRows} ${draftRows === 1 ? 'row' : 'rows'}`}
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-start">
                    <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold ${STATUS_CLASS[status]}`}>{summary}</span>
                    {group.action}
                  </div>
                </summary>
                <div className="border-t border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.32)] px-5 py-4">
                  {group.placeholder ? (
                    <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">{group.placeholder}</div>
                  ) : group.items.length === 0 ? (
                    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/82 px-4 py-3 text-[12px] text-[var(--color-text-tertiary)]">No rows in this group.</div>
                  ) : (
                    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/82">
                      <div className="hidden grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.48)] px-4 py-2 text-[11px] font-semibold text-[var(--color-text-tertiary)] lg:grid">
                        <span>Change</span>
                        <span>Live</span>
                        <span>Draft</span>
                      </div>
                      {group.items.map((item) => (
                        <div key={item.key} className="grid gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
                          <div>
                            <span className={`inline-flex rounded-[var(--radius-control)] border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                            <p className="mt-2 text-[13px] font-semibold text-[var(--color-text-primary)]">{item.label}</p>
                            {item.detail ? <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-tertiary)]">{item.detail}</p> : null}
                          </div>
                          <div className="min-w-0 lg:border-l lg:border-[var(--color-border-subtle)] lg:pl-4">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] lg:hidden">Live</p>
                            <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">{item.before ?? 'Not present'}</p>
                          </div>
                          <div className="min-w-0 rounded-[var(--radius-control)] bg-[color:color-mix(in_srgb,var(--color-accent-primary)_5%,white)] px-3 py-2 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-0">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] lg:hidden">Draft</p>
                            <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">{item.after ?? 'Not present'}</p>
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
