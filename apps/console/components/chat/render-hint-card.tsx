'use client'

import type { RenderHint } from '@intera/shared/channels/render-hints'

interface RenderHintCardProps {
  hint: RenderHint
  result?: any
  onSubmit?: (values: Record<string, string>) => void
}

// ── JSONPath helper ──────────────────────────────────────────────────────────

function resolveJsonPath(data: any, path: string): any {
  if (!path.startsWith('$.')) return undefined
  const parts = path.slice(2).split('.')
  let current = data
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  card: {
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(91,138,247,0.05)',
    border: '1px solid rgba(91,138,247,0.12)',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--indigo, #5b8af7)',
    marginBottom: 4,
  } as React.CSSProperties,
  cardSubtitle: {
    fontSize: 10,
    color: 'var(--fog, #8b8b8b)',
    marginBottom: 4,
  } as React.CSSProperties,
  cardImage: {
    width: '100%',
    maxWidth: 200,
    borderRadius: 6,
    marginBottom: 4,
    display: 'block',
  } as React.CSSProperties,
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  } as React.CSSProperties,
  button: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 500,
    border: '1px solid rgba(91,138,247,0.2)',
    background: 'rgba(91,138,247,0.08)',
    color: 'var(--indigo, #5b8af7)',
    cursor: 'pointer',
  } as React.CSSProperties,
  buttonPrimary: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 500,
    border: '1px solid rgba(91,138,247,0.3)',
    background: 'rgba(91,138,247,0.15)',
    color: 'var(--indigo, #5b8af7)',
    cursor: 'pointer',
  } as React.CSSProperties,
  buttonDanger: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 500,
    border: '1px solid rgba(230,69,57,0.2)',
    background: 'rgba(230,69,57,0.08)',
    color: '#e64539',
    cursor: 'pointer',
  } as React.CSSProperties,
  pill: {
    padding: '3px 8px',
    borderRadius: 999,
    background: 'rgba(139,111,245,0.08)',
    border: '1px solid rgba(139,111,245,0.15)',
    fontSize: 10,
    color: 'var(--lavender, #8b6ff5)',
  } as React.CSSProperties,
  formField: {
    marginBottom: 8,
  } as React.CSSProperties,
  formLabel: {
    display: 'block',
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--fog, #8b8b8b)',
    marginBottom: 2,
  } as React.CSSProperties,
  formInput: {
    width: '100%',
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid rgba(91,138,247,0.15)',
    background: 'rgba(91,138,247,0.04)',
    fontSize: 12,
    color: 'var(--ink, #1a1a1a)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  formSelect: {
    width: '100%',
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid rgba(91,138,247,0.15)',
    background: 'rgba(91,138,247,0.04)',
    fontSize: 12,
    color: 'var(--ink, #1a1a1a)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  formTextarea: {
    width: '100%',
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid rgba(91,138,247,0.15)',
    background: 'rgba(91,138,247,0.04)',
    fontSize: 12,
    color: 'var(--ink, #1a1a1a)',
    outline: 'none',
    minHeight: 60,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  submitButton: {
    padding: '5px 14px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    border: 'none',
    background: 'linear-gradient(135deg, #5b8af7, #8b6ff5)',
    color: '#fff',
    cursor: 'pointer',
    marginTop: 4,
  } as React.CSSProperties,
  blockquote: {
    borderLeft: '2px solid rgba(91,138,247,0.25)',
    paddingLeft: 10,
    margin: '4px 0',
    fontSize: 11,
    color: 'var(--fog, #8b8b8b)',
    fontStyle: 'italic',
  } as React.CSSProperties,
  pre: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'rgba(139,111,245,0.06)',
    border: '1px solid rgba(139,111,245,0.1)',
    fontSize: 11,
    fontFamily: 'monospace',
    color: 'var(--ink, #1a1a1a)',
    overflowX: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties,
  list: {
    paddingLeft: 18,
    margin: '4px 0',
    fontSize: 11,
    color: 'var(--ink, #1a1a1a)',
  } as React.CSSProperties,
  listItem: {
    marginBottom: 2,
  } as React.CSSProperties,
  plainText: {
    fontSize: 11,
    color: 'var(--ink, #1a1a1a)',
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties,
  imageDisplay: {
    maxWidth: '100%',
    borderRadius: 8,
    display: 'block',
  } as React.CSSProperties,
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  } as React.CSSProperties,
  checkboxLabel: {
    fontSize: 11,
    color: 'var(--ink, #1a1a1a)',
  } as React.CSSProperties,
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RenderHintCard({ hint, result, onSubmit }: RenderHintCardProps) {
  // ── Legacy quick_replies (not in the main RenderHint union but still emitted) ──

  if ((hint as any).kind === 'quick_replies') {
    const options = result?.options as Array<Record<string, unknown>> | undefined
    if (!options || options.length === 0) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {options.map((opt, i) => (
          <span key={i} style={styles.pill}>
            {String(opt.label ?? opt.id ?? '')}
          </span>
        ))}
      </div>
    )
  }

  // ── Form ──

  if (hint.kind === 'form') {
    const fields: Array<{
      key: string
      label: string
      type: string
      required?: boolean
      placeholder?: string
      options?: string[]
    }> = result?.fields ?? []

    if (fields.length === 0) return null

    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault()
      const form = e.currentTarget
      const formData = new FormData(form)
      const values: Record<string, string> = {}
      formData.forEach((val, key) => {
        values[key] = val.toString()
      })
      // Ensure checkboxes that are unchecked still appear as "false"
      for (const field of fields) {
        if (!(field.key in values)) {
          values[field.key] = ''
        }
      }
      onSubmit?.(values)
    }

    return (
      <form onSubmit={handleSubmit} style={{ marginTop: 2 }}>
        {fields.map((field) => {
          if (field.type === 'checkbox') {
            return (
              <div key={field.key} style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  id={`field-${field.key}`}
                  name={field.key}
                  required={field.required}
                />
                <label htmlFor={`field-${field.key}`} style={styles.checkboxLabel}>
                  {field.label}
                </label>
              </div>
            )
          }
          return (
            <div key={field.key} style={styles.formField}>
              <label style={styles.formLabel}>
                {field.label}{field.required ? ' *' : ''}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  name={field.key}
                  placeholder={field.placeholder}
                  required={field.required}
                  style={styles.formTextarea}
                  rows={3}
                />
              ) : field.type === 'select' ? (
                <select
                  name={field.key}
                  required={field.required}
                  style={styles.formSelect}
                >
                  <option value="">--</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  name={field.key}
                  placeholder={field.placeholder}
                  required={field.required}
                  style={styles.formInput}
                />
              )}
            </div>
          )
        })}
        <button type="submit" style={styles.submitButton}>
          {hint.submitLabel ?? 'Submit'}
        </button>
      </form>
    )
  }

  // ── Card ──

  if (hint.kind === 'card') {
    const data = result ?? {}
    const title = hint.titleOverride ?? data.title
    if (!title && !data.subtitle && !data.imageUrl && !data.buttons) return null

    return (
      <div style={styles.card}>
        {title && <div style={styles.cardTitle}>{String(title)}</div>}
        {data.subtitle && <div style={styles.cardSubtitle}>{String(data.subtitle)}</div>}
        {data.imageUrl && (
          <img
            src={String(data.imageUrl)}
            alt={String(data.title ?? '')}
            style={styles.cardImage}
          />
        )}
        {data.buttons && data.buttons.length > 0 && (
          <div style={styles.buttonRow}>
            {data.buttons.map((btn: any, i: number) => {
              const accent = hint.buttonAccent?.[btn.action ?? btn.label ?? String(i)]
              const btnStyle =
                accent === 'primary' ? styles.buttonPrimary
                : accent === 'danger' ? styles.buttonDanger
                : styles.button
              return (
                <button key={i} type="button" style={btnStyle}>
                  {btn.label ?? btn.action ?? ''}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Plain ──

  if (hint.kind === 'plain') {
    const text = typeof result === 'string' ? result : result?.text
    if (text == null) return null

    const wrap = hint.wrap ?? 'none'

    if (wrap === 'quote') {
      return <blockquote style={styles.blockquote}>{String(text)}</blockquote>
    }

    if (wrap === 'code') {
      return (
        <pre style={styles.pre}>
          <code>{String(text)}</code>
        </pre>
      )
    }

    return <div style={styles.plainText}>{String(text)}</div>
  }

  // ── List ──

  if (hint.kind === 'list') {
    const items: any[] = result?.items ?? []
    if (items.length === 0) return null

    if (hint.showIndex) {
      return (
        <ol style={styles.list}>
          {items.map((item, i) => (
            <li key={i} style={styles.listItem}>
              {typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}
            </li>
          ))}
        </ol>
      )
    }

    return (
      <ul style={styles.list}>
        {items.map((item, i) => (
          <li key={i} style={styles.listItem}>
            {typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}
          </li>
        ))}
      </ul>
    )
  }

  // ── Image ──

  if (hint.kind === 'image') {
    const url = resolveJsonPath(result, hint.urlPath)
    if (!url) return null
    const alt = hint.altPath ? resolveJsonPath(result, hint.altPath) : undefined
    return (
      <img
        src={String(url)}
        alt={alt ? String(alt) : ''}
        style={styles.imageDisplay}
      />
    )
  }

  return null
}
