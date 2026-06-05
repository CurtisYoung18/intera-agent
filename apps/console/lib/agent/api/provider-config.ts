// Centralized provider configuration for Anthropic-compatible LLM endpoints.
// Routes models to the correct API key + base URL based on model name prefix.
//
// Provider routing:
//   deepseek-*  → DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL
//   MiniMax-*   → MINIMAX_API_KEY / MINIMAX_BASE_URL
//   provider/*   → OPENROUTER_API_KEY / https://openrouter.ai/api (e.g. openai/gpt-4o)
//   default      → ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL

import Anthropic from '@anthropic-ai/sdk'

export interface ProviderConfig {
  apiKey: string | undefined
  baseURL: string | undefined
  provider: string
}

/** Determine the API provider for a model based on naming conventions. */
export function getProviderConfig(model?: string): ProviderConfig {
  if (model?.startsWith('deepseek-')) {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/anthropic',
      provider: 'deepseek',
    }
  }
  if (model?.startsWith('MiniMax-')) {
    return {
      apiKey: process.env.MINIMAX_API_KEY,
      baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/anthropic',
      provider: 'minimax',
    }
  }
  // OpenRouter models use "provider/model" convention (e.g. openai/gpt-4o, google/gemini-pro)
  if (model?.includes('/')) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api',
      provider: 'openrouter',
    }
  }
  // Claude models route through OpenRouter (not Anthropic direct)
  if (model?.startsWith('claude-')) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api',
      provider: 'openrouter',
    }
  }
  // Default: DeepSeek (same key as DEFAULT_MEMORY_MODEL).
  // All known model prefixes (claude-, deepseek-, MiniMax-, provider/) are
  // matched above. This fallback only catches unknown/unprefixed models.
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/anthropic',
    provider: 'deepseek',
  }
}

/**
 * Custom fetch for OpenRouter that rewrites Anthropic SDK auth header.
 * The SDK sends `x-api-key`; OpenRouter expects `Authorization: Bearer`.
 */
function createOpenRouterFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('HTTP-Referer', 'https://intera.app')
    headers.set('X-Title', 'Intera')
    // Debug: log request body to check if image blocks are included
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        if (parsed.messages) {
          const imageMsgs = parsed.messages.filter((m: any) =>
            Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image')
          )
          if (imageMsgs.length > 0) {
            console.log(`[OpenRouter] Request has ${imageMsgs.length} message(s) with image blocks`)
            for (const msg of imageMsgs) {
              const imgBlocks = msg.content.filter((c: any) => c.type === 'image')
              console.log(`[OpenRouter] Image blocks: ${imgBlocks.map((b: any) => `${b.source?.media_type}(${b.source?.data?.length || 0} chars)`).join(', ')}`)
            }
          }
        }
      } catch { /* not JSON, skip */ }
    }
    return fetch(input, { ...init, headers })
  }
}

/**
 * Create an Anthropic-compatible client, routing to the correct provider
 * based on the model name. For OpenRouter models, a custom fetch is used
 * to rewrite the auth header.
 */
export function createAgentClient(model?: string): Anthropic {
  const config = getProviderConfig(model)

  if (!config.apiKey) {
    throw new Error(`API key not configured for provider "${config.provider}" (model: ${model ?? 'default'})`)
  }
  if (!config.baseURL) {
    throw new Error(`Base URL not configured for provider "${config.provider}" (model: ${model ?? 'default'})`)
  }

  if (config.provider === 'openrouter') {
    return new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: createOpenRouterFetch(config.apiKey),
    })
  }

  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
}
