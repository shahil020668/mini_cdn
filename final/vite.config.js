import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Traffic Manager proxy
      '/api/tm': {
        target: 'http://10.134.61.117:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tm/, ''),
      },
      // Edge Server: India (runs on the TM machine, port 3000)
      '/api/edge-india': {
        target: 'http://10.134.61.94:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/edge-india/, ''),
      },
      // Edge Server: US
      '/api/edge-us': {
        target: 'http://10.134.61.162:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/edge-us/, ''),
      },
      // Edge Server: Asia
      '/api/edge-asia': {
        target: 'http://10.134.61.78:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/edge-asia/, ''),
      },
      // Origin Server (main server with movies)
      '/api/origin': {
        target: 'http://10.134.61.94:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/origin/, ''),
      },
    }
  }
})
