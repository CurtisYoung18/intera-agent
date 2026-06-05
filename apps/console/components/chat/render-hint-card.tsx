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

// ── Styles (Warm Craft) ─────────────────────────────────────────────────────

const WC_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif"
const WC_SERIF = "'Literata', Georgia, serif"

const styles = {
  card: {
    padding: 24,
    borderRadius: 16,
    background: '#fffcf9',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 2px rgba(60,40,20,0.04), 0 4px 12px rgba(60,40,20,0.03)',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#2d2926',
    marginBottom: 4,
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  cardSubtitle: {
    fontSize: 13.5,
    fontWeight: 400,
    color: '#8a7e74',
    marginBottom: 4,
    lineHeight: 1.55,
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  cardImage: {
    width: '100%',
    maxWidth: 280,
    borderRadius: 12,
    marginBottom: 4,
    display: 'block',
  } as React.CSSProperties,
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  } as React.CSSProperties,
  button: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: 'transparent',
    color: '#8a7e74',
    cursor: 'pointer',
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  buttonPrimary: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    background: '#3d3833',
    color: '#fffcf9',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(60,40,20,0.15)',
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  buttonDanger: {
    padding: '9px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    border: '1.5px solid rgba(212,118,78,0.2)',
    background: 'rgba(212,118,78,0.06)',
    color: '#b87347',
    cursor: 'pointer',
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  pill: {
    padding: '7px 16px',
    borderRadius: 999,
    background: '#faf8f5',
    border: '1.5px solid rgba(0,0,0,0.06)',
    fontSize: 13,
    fontWeight: 500,
    color: '#6b5e54',
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  formField: {
    marginBottom: 14,
  } as React.CSSProperties,
  formLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#8a7e74',
    marginBottom: 6,
    letterSpacing: '0.02em',
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  formInput: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
  },
  formSelect: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
    appearance: 'none' as const,
    cursor: 'pointer',
  },
  formTextarea: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1.5px solid rgba(0,0,0,0.08)',
    background: '#faf8f5',
    fontSize: 14,
    color: '#3d3833',
    outline: 'none',
    minHeight: 80,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    fontFamily: WC_SANS,
    transition: 'all 0.25s ease',
  },
  submitButton: {
    padding: '11px 28px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    background: 'linear-gradient(135deg, #d4764e, #c9884a)',
    color: '#fff',
    cursor: 'pointer',
    marginTop: 8,
    fontFamily: WC_SANS,
    boxShadow: '0 1px 2px rgba(212,118,78,0.25)',
    transition: 'all 0.25s ease',
  } as React.CSSProperties,
  blockquote: {
    borderLeft: '3px solid #d4764e',
    paddingLeft: 16,
    paddingTop: 12,
    paddingBottom: 12,
    margin: 0,
    fontSize: 14,
    fontFamily: WC_SERIF,
    fontStyle: 'italic' as const,
    color: '#8a7e74',
    lineHeight: 1.65,
  } as React.CSSProperties,
  pre: {
    padding: '16px 18px',
    borderRadius: 12,
    background: '#f5f0eb',
    border: '1px solid rgba(0,0,0,0.05)',
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: '#5a524b',
    overflowX: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.6,
  } as React.CSSProperties,
  list: {
    paddingLeft: 0,
    margin: 0,
    listStyle: 'none',
    fontSize: 14,
    color: '#3d3833',
  } as React.CSSProperties,
  listItem: {
    padding: '12px 18px',
    borderBottom: '1px solid rgba(0,0,0,0.04)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,
  plainText: {
    fontSize: 14,
    color: '#5a524b',
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.6,
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  imageDisplay: {
    maxWidth: '100%',
    borderRadius: 12,
    display: 'block',
  } as React.CSSProperties,
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  } as React.CSSProperties,
  checkboxLabel: {
    fontSize: 13.5,
    color: '#5a524b',
    fontFamily: WC_SANS,
  } as React.CSSProperties,
  listItemNum: {
    width: 24,
    height: 24,
    borderRadius: 8,
    background: 'rgba(212,118,78,0.08)',
    color: '#b87347',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as React.CSSProperties,
  listItemDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#d4764e',
    opacity: 0.5,
    flexShrink: 0,
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
        <div style={styles.list}>
          {items.map((item, i) => (
            <div key={i} style={styles.listItem}>
              <span style={styles.listItemNum}>{i + 1}</span>
              <span>{typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}</span>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div style={styles.list}>
        {items.map((item, i) => (
          <div key={i} style={styles.listItem}>
            <span style={styles.listItemDot} />
            <span>{typeof item === 'string' ? item : String(item.label ?? item.title ?? item)}</span>
          </div>
        ))}
      </div>
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
