/**
 * AppUpdateWatcher.jsx — mise à jour de l'application sans geste technique
 * ============================================================================
 * Monté dans la coque connectée (AppLayout). Cherche une nouvelle version au
 * retour au premier plan et toutes les heures (src/lib/appUpdate.js), puis,
 * quand elle a pris la main :
 *   - affiche « Nouvelle version disponible » avec un bouton « Mettre à jour » ;
 *   - recharge au prochain changement de page, moment où l'on quitte de toute
 *     façon ce qu'on faisait.
 * Jamais de rechargement en pleine saisie : un certificat ou un devis en cours
 * n'est pas interrompu par un déploiement.
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { creerSuiviMiseAJour } from '@/lib/appUpdate';

const UNE_HEURE_MS = 60 * 60 * 1000;

export function AppUpdateWatcher() {
  const { pathname } = useLocation();
  const prete = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const suivi = creerSuiviMiseAJour({
      serviceWorker: navigator.serviceWorker,
      onPrete: () => {
        prete.current = true;
        toast('Nouvelle version disponible', {
          id: 'mdh-app-update',
          description: 'Elle se chargera au prochain changement de page.',
          duration: Infinity,
          action: { label: 'Mettre à jour', onClick: () => window.location.reload() },
        });
      },
    });
    const surRetour = () => {
      if (document.visibilityState === 'visible') suivi.verifier();
    };
    document.addEventListener('visibilitychange', surRetour);
    const horloge = setInterval(() => suivi.verifier(), UNE_HEURE_MS);
    return () => {
      document.removeEventListener('visibilitychange', surRetour);
      clearInterval(horloge);
      suivi.arreter();
    };
  }, []);

  // Changement de page avec une version en attente : on charge la nouvelle
  // (l'adresse est déjà celle de la page demandée).
  const cheminCharge = useRef(pathname);
  useEffect(() => {
    if (cheminCharge.current === pathname) return;
    cheminCharge.current = pathname;
    if (prete.current) window.location.reload();
  }, [pathname]);

  return null;
}
