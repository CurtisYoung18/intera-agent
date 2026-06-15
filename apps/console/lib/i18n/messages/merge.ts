export type LocaleMessageSurface = Record<string, string>

export function mergeLocaleMessages(
  locale: string,
  surfaces: Record<string, LocaleMessageSurface>,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [surface, messages] of Object.entries(surfaces)) {
    for (const [key, value] of Object.entries(messages)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        throw new Error(`Duplicate i18n key "${key}" in locale "${locale}" while merging surface "${surface}".`)
      }
      merged[key] = value
    }
  }
  return merged
}
