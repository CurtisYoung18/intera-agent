// Chat API base URL — used by console (B端) to call chat app (C端) endpoints.
// In dev the chat app runs on port 3000; in production both apps share a domain.
const CHAT_API_BASE = process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3000'

export function chatApiUrl(path: string): string {
  return `${CHAT_API_BASE}${path}`
}
