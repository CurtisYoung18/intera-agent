// Thin structured logger. Wraps console with timestamps and level tags.
// Use instead of raw console.* for operational visibility.
// Future: swap the transport to write to file / send to external service.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  ctx?: Record<string, unknown>
}

function fmt(entry: LogEntry): string {
  const ctx = entry.ctx ? ' ' + JSON.stringify(entry.ctx) : ''
  return `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.msg}${ctx}`
}

function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ctx }
  const line = fmt(entry)
  switch (level) {
    case 'error': console.error(line); break
    case 'warn': console.warn(line); break
    case 'debug': console.debug(line); break
    default: console.log(line)
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
}
