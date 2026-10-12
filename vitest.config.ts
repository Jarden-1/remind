import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['desktop/**/*.test.ts'], environment: 'node' } })
