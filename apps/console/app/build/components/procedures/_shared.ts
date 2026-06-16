export const NEW_PROCEDURE_SENTINEL = '__new__'

export function toStableProcedureType(value: string, fallback = '') {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/[_.-]+$/g, '')
  return cleaned || fallback
}
