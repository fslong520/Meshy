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
      // http-proxy 默认会缓冲小数据包，通过禁用 buffer 和设置 flush 解决
      '/events': {
        target: 'http://localhost:9120',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 禁用代理响应缓冲，确保 SSE 事件即时转发
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
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
