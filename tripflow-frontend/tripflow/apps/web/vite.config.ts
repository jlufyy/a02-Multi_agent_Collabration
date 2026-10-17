import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时可把 /api 代理到本地 FastAPI（B 的服务），与 Cloudflare Tunnel 同源方案保持一致。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': { target: process.env.TRIPFLOW_API_PROXY ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
