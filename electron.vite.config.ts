import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: {
    root: resolve('src/renderer'),
    publicDir: 'public',
    plugins: [vue()],
    server: { host: '127.0.0.1' },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
