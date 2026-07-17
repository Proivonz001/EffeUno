import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // la build demo va su GitHub Pages sotto /EffeUno/
  base: process.env.VITE_DEMO === '1' ? '/EffeUno/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      // il backend FastAPI gira su :8000 (vedi backend/app/main.py)
      '/api': 'http://localhost:8000',
    },
  },
})
