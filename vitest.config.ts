import { defineConfig } from 'vitest/config'
import path from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@intera/runtime-core', replacement: path.resolve(__dirname, 'packages/runtime-core/src') },
      { find: '@', replacement: path.resolve(__dirname, 'apps/console') },
    ],
  },
  test: {
    setupFiles: ['./apps/console/lib/agent/__tests__/vitest-setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '**/.next/**', 'claude-code-source-code-ref-only', '**/.claude/worktrees/**'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      lines: 80,
      branches: 75,
      functions: 80,
      statements: 80,
      include: [
        'apps/console/lib/livechat/**/*.ts',
        'apps/console/channels/livechat/**/*.ts',
      ],
    },
  },
})
