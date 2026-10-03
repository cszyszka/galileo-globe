import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // satellite.js v7 ships an optional WASM worker runtime that uses top-level await
  build: { target: 'es2022' },
  worker: { format: 'es' },
})
