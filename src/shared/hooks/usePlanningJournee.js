/**
 * usePlanningJournee.js - Majord'home Artisan
 * ============================================================================
 * Journée d'un technicien ouverte depuis le Planning : clic sur sa ligne de
 * charge, ou lien direct du tableau de bord des entretiens
 * (`/planning?journee=&tech=`, cf. lienJourneePlanning).
 *   - journée que le moteur planifie → panneau de remplissage (RemplirJourneePanel) ;
 *   - journée qu'il ne juge pas (hors tournées, jour passé) → feuille de route seule.
 * Règles : panneauDeLigne / sortJourneeDemandee (src/lib/planningCharge.js, testées).
 *
 * On garde la CLÉ de la journée, pas l'objet : la journée affichée est dérivée en
 * direct de l'horizon, pour qu'un nouvel essai après une pose voie la charge à
 * jour et non l'état capturé au clic.
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { panneauDeLigne, sortJourneeDemandee } from '@/lib/planningCharge';
import { jourDOuverture } from '@/lib/planningGestes';

/**
 * @param {object} p
 * @param {Array<{ date: string, technicienId: string }>|null|undefined} p.journeesHorizon  journées du moteur (usePlanningCharge)
 * @param {boolean} p.etatsLoading
 * @param {Error|null} p.etatsError
 * @param {string|null} p.finPlage  borne exclusive de la plage affichée
 * @returns {{ dateInitiale: string|undefined, journeeSelectionnee: object|null, feuilleOuverte: object|null,
 *   ouvrirJournee: (ligne: object) => void, fermerJournee: () => void, fermerFeuille: () => void }}
 *   `dateInitiale` : date du lien direct, sinon le lundi suivant quand on ouvre un
 *   week-end (jourDOuverture), à donner au calendrier à son montage.
 */
export function usePlanningJournee({ journeesHorizon, etatsLoading, etatsError, finPlage }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [journeeOuverte, setJourneeOuverte] = useState(() => {
    const date = searchParams.get('journee');
    const technicienId = searchParams.get('tech');
    return date && technicienId ? { date, technicienId } : null;
  });
  const [dateInitiale] = useState(() => searchParams.get('journee') || jourDOuverture());
  const [feuilleOuverte, setFeuilleOuverte] = useState(null);

  const ouvrirJournee = useCallback((ligne) => {
    if (panneauDeLigne(ligne) === 'feuille') {
      setFeuilleOuverte(ligne);
      return;
    }
    setJourneeOuverte({ date: ligne.date, technicienId: ligne.technicienId });
  }, []);

  const fermerJournee = useCallback(() => {
    setJourneeOuverte(null);
    // Le lien direct a servi : sans ce nettoyage, un rechargement rouvrirait le panneau.
    if (searchParams.has('journee') || searchParams.has('tech')) {
      const next = new URLSearchParams(searchParams);
      next.delete('journee');
      next.delete('tech');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fermerFeuille = useCallback(() => setFeuilleOuverte(null), []);

  const journeeSelectionnee = useMemo(() => {
    if (!journeeOuverte || !journeesHorizon) return null;
    return journeesHorizon.find(
      (j) => j.date === journeeOuverte.date && j.technicienId === journeeOuverte.technicienId,
    ) || null;
  }, [journeeOuverte, journeesHorizon]);

  // Journée demandée mais absente de l'horizon chargé : on le dit, plutôt qu'un
  // lien qui n'ouvre rien.
  useEffect(() => {
    const sort = sortJourneeDemandee({
      demandee: journeeOuverte,
      trouvee: journeeSelectionnee,
      erreur: etatsError,
      enChargement: etatsLoading,
      horizonConnu: !!journeesHorizon,
      finPlage,
    });
    if (sort === 'erreur') {
      toast.error(`Journée indisponible — chargement des tournées en échec (${etatsError.message || 'échec inconnu'})`);
      fermerJournee();
    } else if (sort === 'absente') {
      toast.info('Cette journée n’est pas planifiée par la machine (jour passé, non travaillé, ou technicien planifié à la main).');
      fermerJournee();
    }
  }, [journeeOuverte, journeeSelectionnee, etatsError, etatsLoading, journeesHorizon, finPlage, fermerJournee]);

  return { dateInitiale, journeeSelectionnee, feuilleOuverte, ouvrirJournee, fermerJournee, fermerFeuille };
}
