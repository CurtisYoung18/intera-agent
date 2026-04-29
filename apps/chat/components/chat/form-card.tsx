'use client'

// FormCard — inline form bubble with floating/vibration animation
// Renders INSIDE the message flow, not as a modal overlay

import { useState, useCallback } from 'react'

interface FormField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'file'
  required?: boolean
  placeholder?: string
  options?: string[]
}

interface FormCardProps {
  title: string
  description?: string
  fields: FormField[]
  onSubmit: (answers: Record<string, string>) => void
  onCancel: () => void
}

export default function FormCard({ title, description, fields, onSubmit, onCancel }: FormCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleChange = useCallback((key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = useCallback(() => {
    setSubmitted(true)
    setTimeout(() => onSubmit(answers), 400)
  }, [answers, onSubmit])

  const allRequiredFilled = fields
    .filter((f) => f.required)
    .every((f) => answers[f.key]?.trim())

  return (
    <div className={`w-full max-w-[95%] mx-auto ${submitted ? 'animate-tool-done' : 'animate-form-float'}`}>
      <div className="glass-chat-assistant px-5 py-4">
        {/* Title — serif, compact */}
        <h3 className="font-serif text-[18px] text-mist mb-1">{title}</h3>
        {description && (
          <p className="text-[12px] text-fog/60 mb-4 leading-relaxed">{description}</p>
        )}

        {/* Fields — compact inline */}
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-[11px] font-sans tracking-[0.03em] uppercase text-fog/50 mb-1">
                {field.label}
                {field.required && <span className="text-vermillion ml-0.5">*</span>}
              </label>

              {field.type === 'select' ? (
                <select
                  value={answers[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="" className="bg-abyss">{field.placeholder || 'Select…'}</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt} className="bg-abyss">{opt}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={answers[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={2}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 resize-none"
                />
              ) : field.type === 'file' ? (
                <div className="w-full bg-white/[0.03] border border-dashed border-white/[0.06] rounded-md p-4 text-center cursor-pointer hover:bg-white/[0.05] transition-all duration-200">
                  <p className="text-[12px] text-fog/40">{field.placeholder || 'Click or drag to upload'}</p>
                </div>
              ) : (
                <input
                  type={field.type}
                  value={answers[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20"
                />
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-1.5 rounded-md text-[12px] text-fog/40 hover:text-fog border border-white/[0.04] hover:border-white/[0.08] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allRequiredFilled || submitted}
            className="flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all duration-300
              bg-vermillion/80 hover:bg-vermillion text-white
              disabled:bg-white/[0.03] disabled:text-fog/20 disabled:cursor-not-allowed
              shadow-[0_0_12px_rgba(230,69,57,0.08)]"
          >
            {submitted ? 'Submitted' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}
