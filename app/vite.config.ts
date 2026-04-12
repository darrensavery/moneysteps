import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'

const gitSha = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
})()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(gitSha),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/',
  build: {
    // Output to repo root /dist so Cloudflare Pages finds it
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: false, // don't wipe other files in /dist
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8787',
      '/api':  'http://localhost:8787',
    },
  },
})
