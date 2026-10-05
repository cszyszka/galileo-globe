import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  // satellite.js v7 ships an optional WASM worker runtime that uses top-level await
  build: {
    target: 'es2022',
    rollupOptions: {
      // The About page is a plain static page next to the app.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        about: resolve(import.meta.dirname, 'about/index.html'),
      },
    },
  },
  worker: { format: 'es' },
})
