import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Resolve against this script, so the caller's working directory cannot change the targets.
const root = new URL('../', import.meta.url)
const generated = [
  'out/',
  'dist/',
  'release/',
  'coverage/',
  'desktop/native/bin/',
  'frontend/dist/',
  'frontend/coverage/',
  'frontend/tsconfig.tsbuildinfo',
  'node_modules/.vite/',
  'frontend/node_modules/.vite/',
]

for (const path of generated) {
  rmSync(fileURLToPath(new URL(path, root)), { recursive: true, force: true })
}
console.log('Removed generated builds, installers and caches.')
