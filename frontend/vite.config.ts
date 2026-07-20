import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // le build pubblicate (demo o sito con catalogo) vanno su Pages sotto /EffeUno/
  base: process.env.VITE_DEMO === '1' || process.env.VITE_DATA_BASE ? '/EffeUno/' : '/',
  plugins: [react()],
  server: {
    // PORT dall'ambiente: consente piu' dev server in parallelo
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // il backend FastAPI gira su :8000 (vedi backend/app/main.py)
      '/api': 'http://localhost:8000',
    },
  },
})
