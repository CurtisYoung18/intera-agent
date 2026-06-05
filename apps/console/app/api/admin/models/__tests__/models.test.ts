import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dotenv so the side-effect env loader in @intera/shared/prisma
// does not overwrite vi.stubEnv overrides from .env.local files.
vi.mock('dotenv', () => ({
  config: vi.fn(() => ({})),
}))

const API_KEY_ENV_VARS = [
  'MINIMAX_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENROUTER_API_KEY',
]

describe('buildModelList', () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear any API key env vars that may be set from the shell.
    for (const key of API_KEY_ENV_VARS) {
      delete process.env[key]
    }
  })

  it('sets supportsVision:true for Gemini models', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const gemini = models.find(m => m.id === 'google/gemini-3.5-flash')
    expect(gemini!.supportsVision).toBe(true)
  })

  it('sets supportsVision:true for GPT-4o', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const gpt4o = models.find(m => m.id === 'openai/gpt-4o')
    expect(gpt4o!.supportsVision).toBe(true)
  })

  it('sets supportsVision:true for Anthropic direct Claude models', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'mock-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const sonnet = models.find(m => m.id === 'claude-sonnet-4-20250514')
    expect(sonnet!.supportsVision).toBe(true)
    const haiku = models.find(m => m.id === 'claude-haiku-4-5-20251001')
    expect(haiku!.supportsVision).toBe(true)
  })

  it('sets supportsVision:true for OpenRouter Claude models', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const haiku = models.find(m => m.id === 'anthropic/claude-haiku-4.5')
    expect(haiku!.supportsVision).toBe(true)
    const sonnet = models.find(m => m.id === 'anthropic/claude-sonnet-4.6')
    expect(sonnet!.supportsVision).toBe(true)
    const opus = models.find(m => m.id === 'anthropic/claude-opus-4.7')
    expect(opus!.supportsVision).toBe(true)
  })

  it('sets supportsVision:false for MiniMax models', async () => {
    vi.stubEnv('MINIMAX_API_KEY', 'mock-key')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const mm = models.find(m => m.id === 'MiniMax-M3')
    expect(mm!.supportsVision).toBe(false)
  })

  it('sets supportsVision:false for DeepSeek models', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'mock-key')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    const ds = models.find(m => m.id === 'deepseek-v4-pro')
    expect(ds!.supportsVision).toBe(false)
  })

  it('does not include MiniMax models if env var is not set', async () => {
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    expect(models.some(m => m.provider === 'minimax')).toBe(false)
  })

  it('does not include Direct Anthropic models when ANTHROPIC_BASE_URL contains minimaxi', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'mock-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.minimaxi.com')
    const { buildModelList } = await import('@/lib/agent/build-model-list')
    const models = buildModelList()
    expect(models.some(m => m.provider === 'anthropic')).toBe(false)
  })
})
