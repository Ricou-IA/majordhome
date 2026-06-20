import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { Toaster } from '@components/ui/sonner';
import { initDeviceViewport } from '@lib/deviceViewport';
import './index.css';

// Adapte le viewport selon l'appareil (dézoom sur tablette, PC inchangé).
// Appelé avant le render pour éviter tout flash de re-layout.
initDeviceViewport();

// Récupération auto post-déploiement : si un chunk hashé de l'ancienne version
// a disparu de Vercel (le rewrite SPA renvoie index.html → erreur MIME sur le
// module), Vite émet 'vite:preloadError'. On recharge UNE fois pour récupérer la
// nouvelle build. Garde anti-boucle (si le rechargement échoue aussi = vrai offline).
window.addEventListener('vite:preloadError', () => {
  const KEY = 'mdh:chunk-reload-at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

// Configuration TanStack React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000, // 30s par défaut
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  </BrowserRouter>
);
