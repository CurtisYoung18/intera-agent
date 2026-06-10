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

function imageUrlToAnthropicBlock(block: any): any {
  if (block?.type !== 'image_url') return block
  const url = typeof block.image_url?.url === 'string' ? block.image_url.url : ''
  const match = url.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return block
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: match[1],
      data: match[2],
    },
  }
}

export function normalizeOpenRouterAnthropicBody(body: string): string {
  try {
    const parsed = JSON.parse(body)
    if (!parsed.messages) return body
    let modified = false
    for (const msg of parsed.messages) {
      if (!Array.isArray(msg.content)) continue
      const newContent = msg.content.map((block: any) => {
        const normalized = imageUrlToAnthropicBlock(block)
        if (normalized !== block) {
          modified = true
          return normalized
        }
        return block
      })
      if (modified) msg.content = newContent
    }
    return modified ? JSON.stringify(parsed) : body
  } catch {
    return body
  }
}

export const convertAnthropicImagesForOpenRouterBody = normalizeOpenRouterAnthropicBody

/**
 * Custom fetch for OpenRouter that rewrites Anthropic SDK auth header
 * and keeps request bodies in Anthropic Messages format.
 */
function createOpenRouterFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('HTTP-Referer', 'https://intera.app')
    headers.set('X-Title', 'Intera')

    // OpenRouter's Anthropic-compatible endpoint expects Anthropic content
    // block discriminators. Normalize legacy image_url blocks back if any
    // caller provides them, but do not rewrite valid Anthropic image blocks.
    if (init?.body && typeof init.body === 'string') {
      init = { ...init, body: normalizeOpenRouterAnthropicBody(init.body) }
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
