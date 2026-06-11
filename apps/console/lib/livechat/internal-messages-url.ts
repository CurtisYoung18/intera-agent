export function resolveInternalMessagesBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT ?? (env.NODE_ENV === 'development' ? '3001' : '3000')

  if (env.INTERNAL_CHAT_API_URL) {
    try {
      const candidate = new URL(env.INTERNAL_CHAT_API_URL)
      const isLoopback = candidate.hostname === 'localhost' || candidate.hostname === '127.0.0.1'
      const candidatePort = candidate.port || (candidate.protocol === 'https:' ? '443' : '80')

      if (env.NODE_ENV === 'production' && isLoopback && candidatePort !== port) {
        return `http://127.0.0.1:${port}`
      }
    } catch {
      return env.INTERNAL_CHAT_API_URL
    }

    return env.INTERNAL_CHAT_API_URL
  }

  return `http://127.0.0.1:${port}`
}

export function getInternalMessagesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${resolveInternalMessagesBaseUrl(env)}/api/messages`
}
