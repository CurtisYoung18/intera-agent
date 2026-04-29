'use client'

// FormCard — floating glass form triggered by collect_customer_info skill
// Animated entrance, dynamic fields, premium Void aesthetic

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
    onSubmit(answers)
  }, [answers, onSubmit])

  const allRequiredFilled = fields
    .filter((f) => f.required)
    .every((f) => answers[f.key]?.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/60 backdrop-blur-sm" />

      {/* Card */}
      <div
        className={`
          relative z-10 w-full max-w-[480px] max-h-[85vh] overflow-y-auto scroll-thin
          glass-admin p-6
          ${submitted ? 'animate-tool-done pointer-events-none' : 'animate-message-in'}
        `}
      >
        {/* Title */}
        <h2 className="font-serif text-[24px] text-mist mb-1 text-balance">
          {title}
        </h2>
        {description && (
          <p className="text-[14px] text-fog/70 mb-6 leading-relaxed">{description}</p>
        )}

        {/* Fields */}
        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-[13px] font-medium text-fog mb-1.5">
                {field.label}
                {field.required && <span className="text-vermillion ml-0.5">*</span>}
              </label>

              {field.type === 'select' ? (
                <select
                  value={answers[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 outline-none focus:border-vermillion/30 transition-all duration-200 appearance-none cursor-pointer hover:bg-white/[0.05]"
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
                  rows={3}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05] resize-none"
                />
              ) : field.type === 'file' ? (
                <div className="w-full bg-white/[0.03] border border-dashed border-white/[0.08] rounded-lg p-8 text-center cursor-pointer hover:bg-white/[0.05] transition-all duration-200">
                  <p className="text-[14px] text-fog/50">
                    {field.placeholder || 'Click or drag to upload'}
                  </p>
                  <p className="text-[12px] text-fog/30 mt-1">Screenshot, receipt, or document</p>
                  {/* [MOCK] File upload not implemented — placeholder */}
                </div>
              ) : (
                <input
                  type={field.type}
                  value={answers[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05]"
                />
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-[14px] text-fog/50 hover:text-fog border border-white/[0.06] hover:border-white/[0.1] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allRequiredFilled || submitted}
            className="flex-1 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-300
              bg-vermillion/80 hover:bg-vermillion text-white
              disabled:bg-white/[0.03] disabled:text-fog/20 disabled:cursor-not-allowed
              shadow-[0_0_20px_rgba(230,69,57,0.1)] hover:shadow-[0_0_30px_rgba(230,69,57,0.2)]"
          >
            {submitted ? 'Submitted' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}
