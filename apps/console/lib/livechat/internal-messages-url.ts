export function resolveInternalMessagesBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.INTERNAL_CHAT_API_URL) return env.INTERNAL_CHAT_API_URL

  const port = env.PORT ?? (env.NODE_ENV === 'development' ? '3001' : '3000')
  return `http://127.0.0.1:${port}`
}

export function getInternalMessagesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${resolveInternalMessagesBaseUrl(env)}/api/messages`
}
