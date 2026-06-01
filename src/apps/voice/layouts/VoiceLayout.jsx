import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import VoiceAccessGate from '../components/VoiceAccessGate';

/**
 * Layout fullscreen mobile-first pour la PWA Voice.
 * - Pas de sidebar (contrairement à AppLayout)
 * - Fond sombre branding Mayer
 * - Whitelist via VoiceAccessGate (permission voice_recorder.use)
 *
 * Le manifeste PWA est lié au <head> uniquement ici (routes /voice) plutôt
 * qu'injecté globalement dans l'index.html de la SPA. Sinon le navigateur
 * proposerait d'installer « Mayer Voice » (start_url=/voice) depuis n'importe
 * quelle page de l'app principale, et l'utilisateur se retrouverait coincé sur
 * le gate voice en croyant ouvrir l'app Majord'home.
 */
export default function VoiceLayout() {
  const { loading, initialized } = useAuth();

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/voice/manifest.webmanifest';
    link.dataset.voicePwa = 'true';
    document.head.appendChild(link);

    const previousThemeColor = document
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute('content');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', '#1e3a5f');

    return () => {
      link.remove();
      if (themeMeta && previousThemeColor) {
        themeMeta.setAttribute('content', previousThemeColor);
      }
    };
  }, []);

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-900">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-900 via-secondary-800 to-secondary-900 text-white flex flex-col">
      <VoiceAccessGate>
        <Outlet />
      </VoiceAccessGate>
    </div>
  );
}
