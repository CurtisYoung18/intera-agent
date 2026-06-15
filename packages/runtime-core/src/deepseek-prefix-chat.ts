/**
 * DeepSeek 「对话前缀续写」— OpenAI-compatible Chat Completions on the **beta** host.
 * Last message must be `{ role: 'assistant', content, prefix: true }`.
 * Used only for **customer-facing composer hints** on the Chat app — not for the agent loop.
 * @see https://api-docs.deepseek.com — beta Chat base URL.
 */

export function appendAssistantPrefixRow(
  messages: Record<string, unknown>[],
  assistantPrefixRaw: string,
): Record<string, unknown>[] {
  const content = assistantPrefixRaw.length > 0 ? assistantPrefixRaw : ' '
  return [...messages, { role: 'assistant', content, prefix: true }]
}

/** Non-streaming Chat Completion (Beta) — customer composer continuation */
export async function completeDeepseekPrefixChat(opts: {
  baseUrl: string
  apiKey: string
  model: string
  messages: Record<string, unknown>[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}): Promise<{ content: string; error?: string }> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    temperature = 0.35,
    maxTokens = 128,
    stop,
    signal,
  } = opts

  const url = `${baseUrl.replace(/\/?$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature,
    max_tokens: maxTokens,
  }
  if (stop && stop.length > 0) body.stop = stop

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    const raw = await res.text()
    if (!res.ok) {
      return {
        content: '',
        error: `DeepSeek ${res.status}: ${raw.slice(0, 480)}`,
      }
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return { content: '', error: 'Invalid JSON from DeepSeek' }
    }
    const j = json as {
      choices?: Array<{ message?: { content?: string | null } | null }>
    }
    const text = typeof j.choices?.[0]?.message?.content === 'string' ? j.choices[0]!.message!.content!.trim() : ''
    return { content: text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: '', error: msg }
  }
}
