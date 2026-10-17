import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 开发时可把 /api 代理到本地 FastAPI（B 的服务），与 Cloudflare Tunnel 同源方案保持一致。
export default defineConfig(({ mode }) => {
  // The shared repository .env also contains the browser's public JS API key.
  // Keep app-local overrides and expose only these explicit browser settings;
  // backend map/model/search credentials must never enter the browser bundle.
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('../../../../', import.meta.url)), 'VITE_');
  const localEnv = loadEnv(mode, fileURLToPath(new URL('./', import.meta.url)), 'VITE_');
  const mapKeys = ['VITE_AMAP_KEY', 'VITE_AMAP_SERVICE_HOST', 'VITE_AMAP_SECURITY_CODE'] as const;
  return {
  define: Object.fromEntries(mapKeys.map((key) => [`import.meta.env.${key}`, JSON.stringify(process.env[key] ?? localEnv[key] ?? rootEnv[key] ?? '')])),
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
  };
});
