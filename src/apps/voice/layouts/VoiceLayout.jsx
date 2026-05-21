import { Outlet } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import VoiceAccessGate from '../components/VoiceAccessGate';

/**
 * Layout fullscreen mobile-first pour la PWA Voice.
 * - Pas de sidebar (contrairement à AppLayout)
 * - Fond sombre branding Mayer
 * - Whitelist via VoiceAccessGate (Philippe + Eric pour M1)
 */
export default function VoiceLayout() {
  const { loading, initialized } = useAuth();

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
