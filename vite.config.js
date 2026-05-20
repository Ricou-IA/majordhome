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
      manifest: {
        id: '/voice/',
        scope: '/voice/',
        start_url: '/voice/',
        name: 'Mayer — Compte-rendu vocal',
        short_name: 'Mayer Voice',
        description: 'Enregistrement vocal post-RDV pour Mayer Énergie',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'fr-FR',
        icons: [
          { src: '/voice/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/voice/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/voice/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: '/voice/',
        navigateFallbackDenylist: [/^\/(?!voice)/],
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
