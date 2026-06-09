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
 * Custom fetch for OpenRouter that rewrites Anthropic SDK auth header
 * and converts Anthropic-format image blocks to OpenAI format.
 *
 * OpenRouter's Anthropic-compatible endpoint doesn't reliably handle
 * image content blocks for non-Anthropic models (e.g. GPT-4.1 Mini).
 * This interceptor converts:
 *   { type: "image", source: { type: "base64", media_type, data } }
 * → { type: "image_url", image_url: { url: "data:<media_type>;base64,<data>" } }
 */
function createOpenRouterFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('HTTP-Referer', 'https://intera.app')
    headers.set('X-Title', 'Intera')

    // Convert Anthropic image blocks → OpenAI image_url format
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        if (parsed.messages) {
          let modified = false
          for (const msg of parsed.messages) {
            if (Array.isArray(msg.content)) {
              const newContent = msg.content.map((block: any) => {
                if (block.type === 'image' && block.source?.type === 'base64') {
                  modified = true
                  return {
                    type: 'image_url',
                    image_url: {
                      url: `data:${block.source.media_type};base64,${block.source.data}`,
                    },
                  }
                }
                return block
              })
              if (modified) msg.content = newContent
            }
          }
          if (modified) {
            init = { ...init, body: JSON.stringify(parsed) }
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
      authToken: null,
      baseURL: config.baseURL,
      fetch: createOpenRouterFetch(config.apiKey),
    })
  }

  return new Anthropic({
    apiKey: config.apiKey,
    authToken: null,
    baseURL: config.baseURL,
  })
}
