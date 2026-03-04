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
      // SSE 事件流代理到后端 DaemonServer
      '/events': {
        target: 'http://localhost:9120',
        changeOrigin: true,
      },
      // JSON-RPC over HTTP POST 代理到后端
      '/rpc': {
        target: 'http://localhost:9120',
        changeOrigin: true,
      },
      // 开发模式下代理 WebSocket 到后端 DaemonServer（仅用于 RPC 发送）
      '/ws': {
        target: 'ws://localhost:9120',
        ws: true,
      },
    },
  },
})
