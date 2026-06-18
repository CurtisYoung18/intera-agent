'use client'

import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { WidgetFormField, WidgetLocale } from '@/lib/livechat/form-widget'
import { getWidgetCopy } from '@/lib/livechat/form-widget'
import { closeMomentIfPossible, ensureMomentsSdk } from '@/lib/livechat/moments-sdk'

type LiveChatFormWidgetProps = {
  title: string
  description: string
  fields: WidgetFormField[]
  caseId?: string
  chatId?: string
  toolCallId?: string
  preview?: boolean
  locale: WidgetLocale
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'submitted' }
  | { kind: 'error'; message: string }

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function defaultValueForField(field: WidgetFormField): string {
  const value = field.defaultValue ?? ''
  if (field.type !== 'date' || !value) return value

  const isoLike = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/)
  if (isoLike) return isoLike[1]

  const slashDate = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashDate) {
    const [, day, month, year] = slashDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  return value
}

function selectOptionsForField(field: WidgetFormField): string[] {
  const options = field.options ?? []
  const defaultValue = field.defaultValue?.trim()
  if (!defaultValue || options.includes(defaultValue)) return options
  return [defaultValue, ...options]
}

export default function LiveChatFormWidget({
  title,
  description,
  fields,
  caseId,
  chatId,
  toolCallId,
  preview = false,
  locale,
}: LiveChatFormWidgetProps) {
  const copy = useMemo(() => getWidgetCopy(locale), [locale])
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' })
  const [previewValues, setPreviewValues] = useState<Record<string, string> | null>(null)

  const hasFileField = fields.some((field) => field.type === 'file')
  const canSubmit = preview || Boolean(chatId)

  useEffect(() => {
    if (preview) return
    void ensureMomentsSdk({ title }).catch(() => null)
  }, [preview, title])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      setSubmitState({ kind: 'error', message: copy.missingChat })
      return
    }

    const formData = new FormData(event.currentTarget)
    const values: Record<string, string> = {}
    for (const field of fields) {
      const raw = formData.get(field.key)
      if (raw instanceof File) {
        values[field.key] = raw.name || ''
      } else if (typeof raw === 'string') {
        values[field.key] = raw
      } else {
        values[field.key] = ''
      }
    }

    if (preview) {
      setPreviewValues(values)
      setSubmitState({ kind: 'submitted' })
      return
    }

    setSubmitState({ kind: 'submitting' })
    try {
      const response = await fetch('/api/livechat/form-submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          caseId,
          toolCallId,
          title,
          description,
          fields: fields.map((field) => ({
            id: field.key,
            type: field.type,
            label: field.label,
            required: field.required,
            options: field.options,
            placeholder: field.placeholder,
            validation: field.validation,
            defaultValue: field.defaultValue,
          })),
          answers: values,
        }),
      })
      if (!response.ok) {
        let message = copy.submitFailed
        try {
          const payload = await response.json() as { error?: string }
          if (payload?.error) message = payload.error
        } catch {}
        throw new Error(message)
      }
      setSubmitState({ kind: 'submitted' })
      if (!preview) {
        void closeMomentIfPossible({ title }).catch(() => null)
      }
    } catch (error) {
      setSubmitState({ kind: 'error', message: readErrorMessage(error, copy.submitFailed) })
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f7fb] text-[#17181c]">
      <div className="mx-auto flex min-h-screen max-w-2xl items-start justify-center px-4 py-6 sm:px-6">
        <section className="w-full overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_18px_50px_rgba(16,24,40,0.08)]">
          <header className="border-b border-black/8 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              {preview ? (
                <span className="inline-flex items-center rounded-full bg-[rgba(36,99,235,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[#2458d3]">
                  {copy.previewBadge}
                </span>
              ) : null}
              <span className="inline-flex items-center rounded-full bg-[rgba(15,23,42,0.05)] px-2.5 py-1 text-[11px] font-medium text-[#4b5563]">
                {copy.formBadge}
              </span>
            </div>
            <h1 className="mt-3 text-[22px] font-semibold leading-tight text-[#111827]">
              {title}
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-[#5b6474]">
              {description}
            </p>
            <p className="mt-3 text-[11px] leading-5 text-[#7b8190]">
              {preview ? copy.previewDescription : copy.closeHint}
            </p>
          </header>

          <div className="px-5 py-5 sm:px-6">
            {submitState.kind === 'submitted' ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
                <p className="text-[15px] font-semibold text-emerald-900">{copy.submittedTitle}</p>
                <p className="mt-1 text-[13px] leading-6 text-emerald-800">{copy.submittedDescription}</p>
                {previewValues ? (
                  <pre className="mt-4 overflow-x-auto rounded-md bg-white/80 p-3 text-[12px] leading-5 text-[#334155]">
                    {JSON.stringify(previewValues, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/10 bg-[#fafbff] px-4 py-5 text-[13px] text-[#667085]">
                {copy.noFields}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {fields.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <label htmlFor={field.key} className="block text-[12px] font-semibold text-[#374151]">
                      {field.label}
                      {field.required ? <span className="ml-1 text-[#c2410c]">*</span> : null}
                    </label>

                    {field.type === 'textarea' ? (
                      <textarea
                        id={field.key}
                        name={field.key}
                        required={field.required}
                        placeholder={field.placeholder}
                        defaultValue={defaultValueForField(field)}
                        rows={4}
                        className="w-full resize-y rounded-md border border-black/10 bg-white px-3 py-2.5 text-[14px] text-[#111827] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        id={field.key}
                        name={field.key}
                        required={field.required}
                        defaultValue={defaultValueForField(field)}
                        className="w-full rounded-md border border-black/10 bg-white px-3 py-2.5 text-[14px] text-[#111827] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
                      >
                        <option value="">{locale === 'zh' ? '请选择' : 'Select'}</option>
                        {selectOptionsForField(field).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === 'file' ? (
                      <div className="rounded-md border border-dashed border-black/15 bg-[#fafbff] px-3 py-3">
                        <input
                          id={field.key}
                          name={field.key}
                          type="file"
                          required={field.required}
                          className="block w-full text-[13px] text-[#111827] file:mr-3 file:rounded-md file:border-0 file:bg-[#e8eefc] file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-[#1d4ed8]"
                        />
                        <p className="mt-2 text-[11px] leading-5 text-[#6b7280]">{copy.fileFieldHint}</p>
                      </div>
                    ) : (
                      <input
                        id={field.key}
                        name={field.key}
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        required={field.required}
                        placeholder={field.placeholder}
                        defaultValue={defaultValueForField(field)}
                        className="w-full rounded-md border border-black/10 bg-white px-3 py-2.5 text-[14px] text-[#111827] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                    )}
                  </div>
                ))}

                {hasFileField ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-900">
                    {copy.fileFieldHint}
                  </div>
                ) : null}

                {submitState.kind === 'error' ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] leading-5 text-rose-800">
                    {submitState.message}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-black/8 pt-4">
                  <button
                    type="submit"
                    disabled={submitState.kind === 'submitting' || !canSubmit}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-[#2563eb]/25 bg-[#2563eb] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {submitState.kind === 'submitting' ? copy.submitting : copy.submit}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
