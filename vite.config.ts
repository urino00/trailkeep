import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` keeps every URL relative, so the same build works at
// https://<user>.github.io/<repo>/, on Cloudflare Pages, or on localhost.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  plugins: [
    react(),
    VitePWA({
      // Never update silently: a new shell is only activated when the user taps "Update" (PLAN §10).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'TrailKeep',
        short_name: 'TrailKeep',
        description: 'Offline GPX trail maps: import a trail, download its map, see where you are with no signal.',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        theme_color: '#1f5d3a',
        background_color: '#f4f1ea',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell, including the bundled map fonts and sprites,
        // so a cold launch in airplane mode renders labels and icons.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,json,pbf,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
