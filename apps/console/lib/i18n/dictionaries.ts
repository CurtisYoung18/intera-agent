import type { ConsoleLocale, TranslateFn } from './types'
import { en } from './messages/en'
import { zh } from './messages/zh'

export { en, zh }

export const DICTS: Record<ConsoleLocale, Record<string, string>> = {
  en,
  zh,
}

export function translate(
  locale: ConsoleLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = DICTS[locale] ?? en
  let s = table[key] ?? en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}

export function caseStatusI18nKey(status: string): string {
  return status === 'waiting_human' ? 'cases.status.waiting' : `cases.status.${status}`
}

/** Fallback: spaced snake_case when no dictionary entry exists. */
export function translatedCaseStatus(t: TranslateFn, status: string): string {
  const key = caseStatusI18nKey(status)
  const label = t(key)
  if (label === key || /^cases\.status\.[a-z0-9_]+$/i.test(label)) return status.replace(/_/g, ' ')
  return label
}

export function translatedMsgRole(t: TranslateFn, role: string): string {
  const key = `caseDetail.role.${role}`
  const label = t(key)
  return label === key ? role : label
}
