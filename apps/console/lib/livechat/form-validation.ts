type FormFieldLike = {
  id?: string
  key?: string
  type?: string
  label?: string
  validation?: {
    dateRange?: {
      pairId?: string
      role?: 'start' | 'end'
    }
  }
}

type DateRangePair = {
  startId: string
  endId: string
  startLabel: string
  endLabel: string
}

export type FormValidationResult =
  | { ok: true }
  | { ok: false; error: string }

const LEGACY_DATE_RANGE_PAIRS = [
  ['from_date', 'to_date'],
  ['from_time', 'to_time'],
  ['from_at', 'to_at'],
  ['start_date', 'end_date'],
  ['start_time', 'end_time'],
  ['start_at', 'end_at'],
  ['begin_date', 'end_date'],
  ['begin_time', 'end_time'],
] as const

function fieldId(field: FormFieldLike): string {
  return (field.id ?? field.key ?? '').trim()
}

function displayLabel(field: FormFieldLike | undefined, fallback: string): string {
  const label = field?.label?.trim()
  return label || fallback
}

function isDateField(field: FormFieldLike | undefined): boolean {
  return field?.type === 'date'
}

function appendPair(
  pairs: DateRangePair[],
  seen: Set<string>,
  startField: FormFieldLike | undefined,
  endField: FormFieldLike | undefined,
  startId: string,
  endId: string,
): void {
  if (!isDateField(startField) || !isDateField(endField)) return
  const key = `${startId}->${endId}`
  if (seen.has(key)) return
  seen.add(key)
  pairs.push({
    startId,
    endId,
    startLabel: displayLabel(startField, startId),
    endLabel: displayLabel(endField, endId),
  })
}

function discoverConfiguredDateRangePairs(
  fields: FormFieldLike[],
  byId: Map<string, FormFieldLike>,
  pairs: DateRangePair[],
  seen: Set<string>,
): void {
  const grouped = new Map<string, { start?: string; end?: string }>()
  for (const field of fields) {
    const id = fieldId(field)
    if (!id) continue
    const dateRange = field.validation?.dateRange
    if (!dateRange?.role) continue
    const pairId = dateRange.pairId?.trim() || 'default'
    const current = grouped.get(pairId) ?? {}
    current[dateRange.role] = id
    grouped.set(pairId, current)
  }

  for (const group of grouped.values()) {
    if (!group.start || !group.end) continue
    appendPair(pairs, seen, byId.get(group.start), byId.get(group.end), group.start, group.end)
  }
}

function discoverLegacyDateRangePairs(
  byId: Map<string, FormFieldLike>,
  pairs: DateRangePair[],
  seen: Set<string>,
): void {
  for (const [startId, endId] of LEGACY_DATE_RANGE_PAIRS) {
    appendPair(pairs, seen, byId.get(startId), byId.get(endId), startId, endId)
  }
}

function discoverDateRangePairs(fields: FormFieldLike[]): DateRangePair[] {
  const byId = new Map<string, FormFieldLike>()
  for (const field of fields) {
    const id = fieldId(field)
    if (id) byId.set(id, field)
  }

  const pairs: DateRangePair[] = []
  const seen = new Set<string>()
  discoverConfiguredDateRangePairs(fields, byId, pairs, seen)
  discoverLegacyDateRangePairs(byId, pairs, seen)

  return pairs
}

function parseDateInput(value: string, boundary: 'start' | 'end'): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'
    const time = Date.parse(`${year}-${month}-${day}${suffix}`)
    return Number.isNaN(time) ? null : time
  }

  const normalized = trimmed.includes('T')
    ? trimmed
    : trimmed.replace(' ', 'T')
  const time = Date.parse(normalized)
  return Number.isNaN(time) ? null : time
}

export function validateFormAnswers(
  fields: FormFieldLike[] | undefined,
  answers: Record<string, string>,
): FormValidationResult {
  for (const pair of discoverDateRangePairs(fields ?? [])) {
    const startValue = answers[pair.startId]?.trim() ?? ''
    const endValue = answers[pair.endId]?.trim() ?? ''
    if (!startValue || !endValue) continue

    const startTime = parseDateInput(startValue, 'start')
    const endTime = parseDateInput(endValue, 'end')
    if (startTime == null || endTime == null) {
      return {
        ok: false,
        error: `${pair.startLabel} and ${pair.endLabel} must use YYYY-MM-DD or YYYY-MM-DD HH:mm:ss format.`,
      }
    }

    if (startTime >= endTime) {
      return {
        ok: false,
        error: `${pair.startLabel} must be earlier than ${pair.endLabel}.`,
      }
    }
  }

  return { ok: true }
}
