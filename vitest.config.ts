import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/chat'),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '**/.next/**', 'claude-code-source-code-ref-only'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      lines: 80,
      branches: 75,
      functions: 80,
      statements: 80,
      include: [
        'apps/chat/lib/livechat/**/*.ts',
        'apps/chat/channels/livechat/**/*.ts',
      ],
    },
  },
})
