import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'mapbox-gl': ['mapbox-gl'],
          'turf': ['@turf/turf'],
        },
      },
    },
  },
});
