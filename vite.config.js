import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      includeAssets: ['voice/icons/*'],
      // Le manifeste est volontairement servi en statique (public/voice/manifest.webmanifest)
      // et lié au <head> uniquement depuis VoiceLayout (routes /voice). Sinon le plugin
      // injecterait le <link rel="manifest"> dans l'index.html unique de la SPA, donc sur
      // TOUTES les pages — un utilisateur installant l'app depuis le dashboard récupérait
      // alors un raccourci dont le start_url est /voice et restait bloqué sur le gate voice.
      manifest: false,
      workbox: {
        // Fallback SPA réservé aux navigations /voice (offline PWA terrain). Les autres
        // routes ne passent pas par le fallback. index.html est bien précaché par generateSW.
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/voice/],
        // Gros chunks data du module Thermique (communes ~3.6 Mo, pac-catalogue ~4 Mo source),
        // chargés en import() dynamique à la demande : exclus du precache SW (limite workbox
        // 2 MiB, et inutile de les pousser à tous les users) — ils restent servis/cachés en HTTP.
        globIgnores: ['**/communes-*.js', '**/pac-catalogue-*.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/n8n\..*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  define: {
    'global': 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@layouts': path.resolve(__dirname, './src/layouts'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@services': path.resolve(__dirname, './src/shared/services'),
      '@hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@hooksPipeline': path.resolve(__dirname, './src/hooks/pipeline'),
      '@apps': path.resolve(__dirname, './src/apps'),
    },
  },
  server: {
    port: 5173,
    open: true,
    hmr: {
      overlay: false,      // Désactive l'overlay d'erreur
      timeout: 60000,      // Timeout plus long (60s)
    },
    watch: {
      usePolling: false,   // Désactive le polling agressif
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'mapbox-gl': ['mapbox-gl'],
          'turf': ['@turf/turf'],
          'fullcalendar': [
            '@fullcalendar/core',
            '@fullcalendar/react',
            '@fullcalendar/daygrid',
            '@fullcalendar/timegrid',
            '@fullcalendar/interaction',
          ],
          'radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'pdf': ['@react-pdf/renderer'],
          'recharts': ['recharts'],
        },
      },
    },
  },
});
