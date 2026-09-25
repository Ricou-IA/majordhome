// src/apps/maintenance/lib/useEnLigne.js
// État réseau de la borne : `navigator.onLine` + évènements online/offline. Combiné par
// l'appelant avec l'échec des requêtes (le Wi-Fi peut être « connecté » sans Internet).
import { useEffect, useState } from 'react';

export function useEnLigne() {
  const [enLigne, setEnLigne] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setEnLigne(true);
    const off = () => setEnLigne(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return enLigne;
}

/** Heure courante rafraîchie toutes les `ms` (horloge de la borne, bascule de jour à minuit). */
export function useMaintenant(ms = 30_000) {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return maintenant;
}
