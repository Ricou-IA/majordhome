// useDecalagesJournee.js - Majord'home Artisan
// ============================================================================
// Décalages manuels des RDV déjà posés d'une journée, EN MÉMOIRE.
//
// Le planning existant reste une contrainte absolue pour le moteur : il ne
// déplace jamais rien de lui-même. Ce hook ouvre l'autre voie — un humain qui
// décide de pousser un rendez-vous pour faire rentrer un entretien.
//
// ⚠️ Rien n'est écrit ici. Un décalage vit à l'écran jusqu'à la pose, et n'est
// envoyé en base qu'avec les RDV qu'il servait à caser (cf. useJourneePose) :
// une heure de RDV est une heure annoncée à un client, elle ne part pas en
// base parce qu'un doigt a glissé. Fermer le panneau annule tout.
//
// ⚠️ Ce hook doit être appelé AVANT `usePropositions`, et c'est sa
// `journeeAjustee` qu'il faut lui passer — pas la journée d'origine. Le
// classement des candidats (détour, faisabilité, horaires proposés) est calculé
// à partir des arrêts existants : sur la journée d'origine, il classerait pour
// un planning que l'utilisateur vient précisément de changer sous ses yeux.
// ============================================================================

import { useCallback, useMemo, useState } from 'react';
import { appliquerDecalages } from '@/lib/tournee/timeline.js';

/**
 * @param {object|null} journee  Journee (cf. tournees.service.js)
 * @returns {{
 *   decalages: Map<string, number>,
 *   journeeAjustee: object|null,
 *   decaler: (rdvId: string, deltaMinutes: number) => void,
 *   reinitialiser: () => void,
 *   retirerDecalages: (ids: string[]) => void,
 * }}
 */
export function useDecalagesJournee(journee) {
  const [decalages, setDecalages] = useState(() => new Map());

  // `decaler` reçoit le déplacement DE CE GESTE et le cumule : la barre ne
  // connaît pas l'historique, elle ne sait que « ce bloc vient de bouger de
  // +30 min ». Un décalage qui revient à zéro est retiré de la Map, pour que
  // « y a-t-il des décalages ? » reste une question à laquelle `size` répond
  // juste (sinon un aller-retour laisserait une entrée à 0 et déclencherait
  // une confirmation de déplacement pour un RDV qui n'a pas bougé).
  const decaler = useCallback((rdvId, deltaMinutes) => {
    if (!rdvId || !deltaMinutes) return;
    setDecalages((prev) => {
      const next = new Map(prev);
      const cumul = (next.get(rdvId) || 0) + deltaMinutes;
      if (cumul === 0) next.delete(rdvId); else next.set(rdvId, cumul);
      return next;
    });
  }, []);

  const reinitialiser = useCallback(() => setDecalages(new Map()), []);

  // Un décalage ÉCRIT en base doit sortir de la Map, exactement comme un
  // candidat posé sort de la sélection : après l'écriture, le rafraîchissement
  // des caches renvoie le RDV à sa nouvelle heure. Le laisser ici le
  // re-décalerait par-dessus — +30 min affiché deviendrait +60, et un second
  // essai l'écrirait pour de bon.
  const retirerDecalages = useCallback((ids) => {
    if (!ids?.length) return;
    setDecalages((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const journeeAjustee = useMemo(() => {
    if (!journee) return null;
    if (decalages.size === 0) return journee;
    const rdvs = appliquerDecalages(journee.rdvs, decalages);
    // `chargeMinutes` n'est PAS recalculée : décaler un RDV ne change pas sa
    // durée, donc pas la charge de la journée. Seuls les créneaux bougent.
    return { ...journee, rdvs };
  }, [journee, decalages]);

  return { decalages, journeeAjustee, decaler, reinitialiser, retirerDecalages };
}

export default useDecalagesJournee;
