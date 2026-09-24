import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'logo.png',
          'logomobile.png',
          'apple-touch-icon.png',
          'manifest.json',
        ],
        manifest: {
          id: '/',
          name: 'ETS PROJECTS',
          short_name: 'ETS PROJECTS',
          description:
            'Автоматизована система обліку та аналізу проектів, OCR-розпізнавання рахунків постачальників, контролю маржинальності та синхронізації з Google Таблицями.',
          theme_color: '#4f46e5',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/logomobile.png',
              sizes: '192x192 512x512 645x616',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/logomobile.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/logomobile.png',
              sizes: '180x180',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
