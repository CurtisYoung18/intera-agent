'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  values: string[]
  onChange: (v: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

export default function ChipInput({ values, onChange, suggestions = [], placeholder = 'Type and press Enter' }: Props) {
  const [input, setInput] = useState('')

  const add = (val: string) => {
    const trimmed = val.trim()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
    }
    setInput('')
  }

  const remove = (val: string) => onChange(values.filter((v) => v !== val))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-indigo/[0.06] border border-indigo/10 text-indigo group"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="opacity-40 hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input) } }}
          placeholder={placeholder}
          className="glass-input-console text-[12px] py-1 flex-1"
        />
        {suggestions.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) add(e.target.value) }}
            className="glass-input-console text-[12px] py-1 w-1/3"
          >
            <option value="" disabled>+ add</option>
            {suggestions.filter((s) => !values.includes(s)).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}
