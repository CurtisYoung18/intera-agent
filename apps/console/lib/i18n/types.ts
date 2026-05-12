export type ConsoleLocale = 'en' | 'zh'

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string
