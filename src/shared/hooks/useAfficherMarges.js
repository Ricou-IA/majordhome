/**
 * useAfficherMarges.js — interrupteur « Afficher les marges » de l'éditeur de devis.
 * ============================================================================
 * Le devis se fait souvent devant le client (tablette chez lui) : les prix d'achat et la
 * marge sont masqués par défaut. Peut les afficher qui a le droit `devis · marges`
 * (Réglages → Droits d'accès ; défaut : administrateur et responsable), et le choix reste sur
 * l'appareil (`localStorage`, clé suffixée par l'utilisateur). Tous les écrans du devis
 * (catalogue, lignes, pied) lisent le même état : basculer à un endroit change partout.
 * ============================================================================
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';

const abonnes = new Set();
const cle = (userId) => `mdh-devis-marges:${userId}`;

function lire(userId) {
  if (!userId) return false;
  try { return window.localStorage.getItem(cle(userId)) === '1'; } catch { return false; }
}

/** @returns {{ peut: boolean, visibles: boolean, basculer: () => void }} */
export function useAfficherMarges() {
  const { user } = useAuth();
  const { can } = useCanAccess();
  const userId = user?.id || null;
  const choix = useSyncExternalStore(
    (f) => { abonnes.add(f); return () => abonnes.delete(f); },
    () => lire(userId),
  );
  const peut = can('devis', 'marges');
  const basculer = useCallback(() => {
    if (!userId) return;
    try { window.localStorage.setItem(cle(userId), lire(userId) ? '0' : '1'); } catch { /* stockage indisponible : rien */ }
    abonnes.forEach((f) => f());
  }, [userId]);
  return { peut, visibles: peut && choix, basculer };
}
