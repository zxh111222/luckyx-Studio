import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: 'public',
  plugins: [vue()],
  server: {
    host: '127.0.0.1', port: 4173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4180' }
  },
  build: { outDir: resolve('out/renderer'), emptyOutDir: true }
})
