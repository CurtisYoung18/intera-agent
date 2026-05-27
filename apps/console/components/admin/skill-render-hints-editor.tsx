'use client'

import { useState } from 'react'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

interface Props {
  value: LivechatRenderHint | undefined
  onChange: (hint: LivechatRenderHint | undefined) => void
  mockFixture?: unknown
}

const KINDS = [
  { id: 'card', label: 'Card' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'quick_replies', label: 'Quick Replies' },
  { id: 'plain', label: 'Plain Text' },
] as const

export default function SkillRenderHintsEditor({ value, onChange, mockFixture }: Props) {
  const [kind, setKind] = useState<string>(value?.kind ?? '')

  const handleKindChange = (newKind: string) => {
    setKind(newKind)
    if (!newKind) { onChange(undefined); return }

    switch (newKind) {
      case 'card':
        onChange({ kind: 'card', titleField: '', subtitleField: '', imageUrlField: '', buttons: [] })
        break
      case 'carousel':
        onChange({ kind: 'carousel', itemsField: '', idField: '$.id', itemTemplate: { titleField: '', subtitleField: '', imageUrlField: '', buttons: [] } })
        break
      case 'quick_replies':
        onChange({ kind: 'quick_replies', optionsField: '', optionIdField: '$.id', optionLabelField: '$.label', titleStatic: '' })
        break
      case 'plain':
        onChange({ kind: 'plain' })
        break
    }
  }

  const hint = value
  const inputCls = 'w-full px-2.5 py-1.5 text-[12px] border border-black/[0.08] rounded-lg bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[11px] font-semibold text-[var(--mist)] mb-1'

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Render as</label>
        <select
          value={kind}
          onChange={e => handleKindChange(e.target.value)}
          className={inputCls}
        >
          <option value="">(not configured - use status track)</option>
          {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>

      {hint?.kind === 'card' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Title (JSONPath in skill output)</label>
            <input className={inputCls} value={hint.titleField} onChange={e => onChange({ ...hint, titleField: e.target.value })} placeholder="$.order.id" />
          </div>
          <div>
            <label className={labelCls}>Subtitle (optional)</label>
            <input className={inputCls} value={hint.subtitleField ?? ''} onChange={e => onChange({ ...hint, subtitleField: e.target.value })} placeholder="$.order.status" />
          </div>
          <div>
            <label className={labelCls}>Image URL (optional)</label>
            <input className={inputCls} value={hint.imageUrlField ?? ''} onChange={e => onChange({ ...hint, imageUrlField: e.target.value })} placeholder="$.order.thumbnailUrl" />
          </div>

          <div>
            <label className={labelCls}>Buttons</label>
            {(hint.buttons ?? []).map((btn, i) => (
              <div key={i} className="flex gap-2 mt-1.5">
                <input className={inputCls} value={btn.postback} onChange={e => {
                  const buttons = [...(hint.buttons ?? [])]
                  buttons[i] = { ...buttons[i], postback: e.target.value }
                  onChange({ ...hint, buttons })
                }} placeholder="postback_id" />
                <input className={inputCls} value={btn.labelStatic ?? ''} onChange={e => {
                  const buttons = [...(hint.buttons ?? [])]
                  buttons[i] = { ...buttons[i], labelStatic: e.target.value }
                  onChange({ ...hint, buttons })
                }} placeholder="Label" />
                <button onClick={() => {
                  const buttons = (hint.buttons ?? []).filter((_, j) => j !== i)
                  onChange({ ...hint, buttons })
                }} className="text-[10px] text-red-500 px-1">Remove</button>
              </div>
            ))}
            <button
              onClick={() => onChange({ ...hint, buttons: [...(hint.buttons ?? []), { id: `btn-${Date.now()}`, postback: '', labelStatic: '' }] })}
              className="mt-1.5 text-[11px] text-indigo hover:text-indigo/80"
            >
              + Add button
            </button>
          </div>
        </div>
      )}

      {hint?.kind === 'carousel' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Items field (JSONPath to array)</label>
            <input className={inputCls} value={hint.itemsField} onChange={e => onChange({ ...hint, itemsField: e.target.value })} placeholder="$.results" />
          </div>
          <div>
            <label className={labelCls}>ID field per item</label>
            <input className={inputCls} value={hint.idField ?? ''} onChange={e => onChange({ ...hint, idField: e.target.value })} placeholder="$.id" />
          </div>
          <p className="text-[11px] font-semibold text-[var(--fog)] mt-3">Item template</p>
          <div>
            <label className={labelCls}>Title field</label>
            <input className={inputCls} value={hint.itemTemplate.titleField} onChange={e => onChange({ ...hint, itemTemplate: { ...hint.itemTemplate, titleField: e.target.value } })} placeholder="$.title" />
          </div>
          <div>
            <label className={labelCls}>Subtitle field (optional)</label>
            <input className={inputCls} value={hint.itemTemplate.subtitleField ?? ''} onChange={e => onChange({ ...hint, itemTemplate: { ...hint.itemTemplate, subtitleField: e.target.value } })} placeholder="$.description" />
          </div>
          <div>
            <label className={labelCls}>Image URL field (optional)</label>
            <input className={inputCls} value={hint.itemTemplate.imageUrlField ?? ''} onChange={e => onChange({ ...hint, itemTemplate: { ...hint.itemTemplate, imageUrlField: e.target.value } })} placeholder="$.imageUrl" />
          </div>
        </div>
      )}

      {hint?.kind === 'quick_replies' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Options field (JSONPath to array)</label>
            <input className={inputCls} value={hint.optionsField} onChange={e => onChange({ ...hint, optionsField: e.target.value })} placeholder="$.choices" />
          </div>
          <div>
            <label className={labelCls}>Option ID field</label>
            <input className={inputCls} value={hint.optionIdField ?? ''} onChange={e => onChange({ ...hint, optionIdField: e.target.value })} placeholder="$.id" />
          </div>
          <div>
            <label className={labelCls}>Option label field</label>
            <input className={inputCls} value={hint.optionLabelField ?? ''} onChange={e => onChange({ ...hint, optionLabelField: e.target.value })} placeholder="$.label" />
          </div>
          <div>
            <label className={labelCls}>Title text</label>
            <input className={inputCls} value={hint.titleStatic ?? ''} onChange={e => onChange({ ...hint, titleStatic: e.target.value })} placeholder="Please select:" />
          </div>
        </div>
      )}

      {hint?.kind === 'plain' && (
        <p className="text-[11px] text-[var(--fog)]">Output will be sent as plain text.</p>
      )}

      {mockFixture && hint && (
        <div className="mt-4 p-3 bg-black/[0.02] rounded-lg border border-black/[0.04]">
          <p className="text-[10px] font-semibold text-[var(--fog)]/60 mb-1">Preview</p>
          <pre className="text-[10px] text-[var(--mist)] overflow-x-auto">
            {JSON.stringify(hint, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
