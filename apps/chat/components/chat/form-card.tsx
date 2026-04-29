'use client'

// FormCard — inline form bubble with flowing gradient border + smooth float animation
// Renders INSIDE the message flow
//
// Entrance: slides up from below with staggered field reveals (CC-inspired)
// Exit: fades out + slides down on cancel, then notifies the agent

import { useState, useCallback, useRef, useEffect } from 'react'

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
  const [dismissing, setDismissing] = useState(false)
  const [entered, setEntered] = useState(false)
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // Trigger entrance animation after mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleChange = useCallback((key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleFileClick = useCallback((key: string) => {
    const input = fileInputRefs.current.get(key)
    input?.click()
  }, [])

  const handleFileChange = useCallback((key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleChange(key, file.name)
    }
  }, [handleChange])

  const handleSubmit = useCallback(() => {
    setSubmitted(true)
    setTimeout(() => onSubmit(answers), 400)
  }, [answers, onSubmit])

  const handleDismiss = useCallback(() => {
    setDismissing(true)
    // Wait for exit animation before removing
    setTimeout(() => onCancel(), 350)
  }, [onCancel])

  const setFileRef = useCallback((key: string, el: HTMLInputElement | null) => {
    if (el) fileInputRefs.current.set(key, el)
  }, [])

  const allRequiredFilled = fields
    .filter((f) => f.required)
    .every((f) => answers[f.key]?.trim())

  return (
    <div
      className={`w-full max-w-[95%] mx-auto transition-all duration-500 ease-out ${
        dismissing
          ? 'opacity-0 translate-y-4 scale-[0.97]'
          : entered
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-6 scale-[0.96]'
      } ${submitted ? 'animate-tool-done' : ''}`}
    >
      {/* Flowing gradient border wrapper */}
      <div className="relative rounded-2xl p-[1px] will-change-transform">
        {/* Animated gradient border — fades in after entrance */}
        <div
          className={`absolute inset-0 rounded-2xl overflow-hidden transition-opacity duration-700 delay-300 ${
            entered && !dismissing ? 'opacity-50' : 'opacity-0'
          }`}
        >
          <div
            className="absolute inset-[-50%] animate-border-flow"
            style={{
              background: 'conic-gradient(from 0deg, transparent, rgba(230,69,57,0.4), rgba(91,110,245,0.3), rgba(212,145,46,0.3), transparent)',
            }}
          />
        </div>

        {/* Card body */}
        <div className="relative rounded-2xl bg-[#0f0f12]/95 backdrop-blur-xl px-5 py-4 border border-white/[0.04]">
          {/* Title — fades in first */}
          <h3
            className="font-serif text-[18px] text-mist mb-1 transition-all duration-500 delay-75"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? 'translateY(0)' : 'translateY(6px)',
            }}
          >
            {title}
          </h3>

          {/* Description — fades in after title */}
          {description && (
            <p
              className="text-[12px] text-fog/60 mb-4 leading-relaxed transition-all duration-500 delay-150"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? 'translateY(0)' : 'translateY(6px)',
              }}
            >
              {description}
            </p>
          )}

          {/* Fields — stagger in one by one */}
          <div className="space-y-3">
            {fields.map((field, i) => (
              <div
                key={field.key}
                className="transition-all duration-500 ease-out"
                style={{
                  opacity: entered ? 1 : 0,
                  transform: entered ? 'translateY(0)' : 'translateY(8px)',
                  transitionDelay: `${200 + i * 60}ms`,
                }}
              >
                <label className="block text-[11px] font-sans tracking-[0.03em] uppercase text-fog/50 mb-1">
                  {field.label}
                  {field.required && <span className="text-vermillion ml-0.5">*</span>}
                </label>

                {field.type === 'select' ? (
                  <select
                    value={answers[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 appearance-none cursor-pointer hover:bg-white/[0.05]"
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
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05] resize-none"
                  />
                ) : field.type === 'file' ? (
                  <>
                    <input
                      type="file"
                      ref={(el) => setFileRef(field.key, el)}
                      onChange={(e) => handleFileChange(field.key, e)}
                      className="hidden"
                      accept="image/*"
                    />
                    <button
                      type="button"
                      onClick={() => handleFileClick(field.key)}
                      className="w-full bg-white/[0.03] border border-dashed border-white/[0.08] rounded-md p-4 text-center cursor-pointer hover:bg-white/[0.05] hover:border-vermillion/20 transition-all duration-200"
                    >
                      {answers[field.key] ? (
                        <p className="text-[12px] text-malachite">{answers[field.key]}</p>
                      ) : (
                        <>
                          <p className="text-[12px] text-fog/40">{field.placeholder || 'Click to upload'}</p>
                          <p className="text-[10px] text-fog/20 mt-0.5">Screenshot or receipt</p>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <input
                    type={field.type}
                    value={answers[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md text-[13px] text-mist py-1.5 px-2.5 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05]"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Actions — fade in last */}
          <div
            className="flex gap-2 mt-4 transition-all duration-500"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? 'translateY(0)' : 'translateY(4px)',
              transitionDelay: `${200 + fields.length * 60}ms`,
            }}
          >
            <button
              onClick={handleDismiss}
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
    </div>
  )
}
