import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('desktop/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('desktop/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    root: resolve('frontend'), base: './', plugins: [react(), {
      name: 'desktop-csp', apply: 'build',
      transformIndexHtml(html) {
        return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`)
      },
    }],
    server: { port: 5174, strictPort: true },
    build: { minify: true, rollupOptions: { input: resolve('frontend/index.html') } },
  },
})
