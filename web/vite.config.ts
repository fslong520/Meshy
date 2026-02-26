import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // 开发模式下代理 WebSocket 到后端 DaemonServer
      '/ws': {
        target: 'ws://localhost:9120',
        ws: true,
      },
    },
  },
})
