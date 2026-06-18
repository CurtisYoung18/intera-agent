export function resolveLiveChatWidgetUrl(): string {
  const explicit = process.env.LIVECHAT_WIDGET_URL?.trim()
  if (explicit) return explicit

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim()
  if (appUrl) return new URL('/livechat-widget', appUrl).toString()

  if (process.env.NODE_ENV === 'production') {
    throw new Error('LIVECHAT_WIDGET_URL or NEXT_PUBLIC_APP_URL is required to render LiveChat forms in production')
  }

  return 'http://localhost:3000/livechat-widget'
}
