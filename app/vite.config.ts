import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/register/',
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
