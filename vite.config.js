import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Ensure dev server is reachable via both localhost and 127.0.0.1 on macOS (avoid IPv6-only bind to ::1)
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT || 3001}`,
        changeOrigin: true,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
})
