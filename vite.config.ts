import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4179,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4182' },
  },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
})
