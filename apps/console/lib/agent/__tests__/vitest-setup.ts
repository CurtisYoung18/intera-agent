// Global vitest setup — runs before every test file.
// Mocks the LLM provider so NO test can hit a live API.
// Tests that specifically need to verify provider behaviour can
// unmock + re-mock in-file.

import { vi } from 'vitest'

vi.mock('@/lib/agent/api/provider-config', () => ({
  getProviderConfig: vi.fn(() => ({
    apiKey: 'mock-key',
    baseURL: 'http://localhost:9999',
    provider: 'mock',
  })),
  createAgentClient: vi.fn(() => ({
    messages: {
      create: vi.fn(async () => ({
        id: 'msg_mock_setup',
        model: 'mock',
        content: [{ type: 'text' as const, text: 'OK' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    },
  })),
}))
