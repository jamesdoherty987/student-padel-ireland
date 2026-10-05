import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Absolute base so nested routes (/t/..., /players/...) load JS/CSS correctly on mobile.
  // Capacitor uses https + hostname, so '/' works in the native WebView too.
  base: '/',
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\')) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('axios')) return 'http'
          if (id.includes('date-fns')) return 'date'
          if (id.includes('cobe')) return 'globe'
          if (id.includes('@capacitor')) return 'capacitor'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
