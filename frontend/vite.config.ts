import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
      __API_BASE__: JSON.stringify(env.VITE_API_BASE ?? 'http://localhost:8787')
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/chat': {
          target: env.VITE_API_BASE ?? 'http://localhost:8787',
          changeOrigin: true
        },
        '/health': {
          target: env.VITE_API_BASE ?? 'http://localhost:8787',
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    },
    test: {
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts'
    }
  };
});
