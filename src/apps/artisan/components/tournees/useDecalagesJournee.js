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
import { appointmentsService } from '@services/appointments.service';
import { logger } from '@lib/logger';
import { messageErreur } from './tourneesPanelUtils';

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

/**
 * Écrit en base les décalages en attente. SEULE implémentation de cette
 * écriture : elle sert au panneau de remplissage (avant la pose des nouveaux
 * RDV) comme à la carte de la liste (déplacement seul). Deux copies finiraient
 * par diverger sur exactement ce qui compte — quelle heure part en base.
 *
 * S'arrête au PREMIER échec et remonte ce qui a déjà été écrit : dans le
 * contexte de la pose, les créneaux des nouveaux RDV supposent que les anciens
 * ont bougé, poursuivre écrirait un chevauchement réel. L'état partiel n'est
 * jamais tu.
 *
 * @param {Array<object>} rdvsAjustes  `journeeAjustee.rdvs` — `scheduled_start`
 *   y porte DÉJÀ l'heure décalée, celle qui a été montrée à l'écran. On écrit
 *   ce qui a été montré, on ne le recalcule pas ici.
 * @param {Map<string, number>} decalages
 * @returns {Promise<{ ids: string[], echec: {nom: string, message: string}|null }>}
 */
export async function ecrireDecalages(rdvsAjustes, decalages) {
  if (!decalages || decalages.size === 0) return { ids: [], echec: null };
  const ids = [];
  for (const id of decalages.keys()) {
    const rdv = (rdvsAjustes || []).find((r) => r.id === id);
    if (!rdv) continue;
    try {
      const { error } = await appointmentsService.updateAppointment(id, {
        scheduled_start: rdv.scheduled_start,
        scheduled_end: rdv.scheduled_end,
      });
      if (error) {
        return { ids, echec: { nom: rdv.client_name || 'RDV', message: messageErreur(error, 'déplacement refusé') } };
      }
      ids.push(id);
    } catch (err) {
      logger.error('[tournees] ecrireDecalages', err);
      return { ids, echec: { nom: rdv.client_name || 'RDV', message: err?.message || 'exception inattendue' } };
    }
  }
  return { ids, echec: null };
}
