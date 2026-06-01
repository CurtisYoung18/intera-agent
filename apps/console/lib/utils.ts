export function generateCaseId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = now.toISOString().slice(11, 19).replace(/:/g, '')
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).slice(2, 10)
  return `case_${date}_${time}_${rand}`
}
