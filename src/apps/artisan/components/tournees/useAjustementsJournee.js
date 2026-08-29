// useAjustementsJournee.js - Majord'home Artisan
// ============================================================================
// Ajustements manuels des RDV déjà posés d'une journée, EN MÉMOIRE :
// déplacement dans le temps ET raccourcissement de la durée. Les deux servent
// la même chose — faire de la place — et se cumulent sur un même RDV.
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
import { appliquerAjustements } from '@/lib/tournee/timeline.js';
import { appointmentsService } from '@services/appointments.service';
import { logger } from '@lib/logger';
import { messageErreur } from './tourneesPanelUtils';

/**
 * @param {object|null} journee  Journee (cf. tournees.service.js)
 * @returns {{
 *   decalages: Map<string, number>,
 *   durees: Map<string, number>,
 *   nbAjustements: number,
 *   journeeAjustee: object|null,
 *   ajuster: (rdvId: string, { deltaMinutes?: number, dureeMinutes?: number }) => void,
 *   reinitialiser: () => void,
 *   retirerAjustements: (ids: string[]) => void,
 * }}
 */
export function useAjustementsJournee(journee) {
  const [decalages, setDecalages] = useState(() => new Map());
  const [durees, setDurees] = useState(() => new Map());

  // `decaler` reçoit le déplacement DE CE GESTE et le cumule : la barre ne
  // connaît pas l'historique, elle ne sait que « ce bloc vient de bouger de
  // +30 min ». Un décalage qui revient à zéro est retiré de la Map, pour que
  // « y a-t-il des décalages ? » reste une question à laquelle `size` répond
  // juste (sinon un aller-retour laisserait une entrée à 0 et déclencherait
  // une confirmation de déplacement pour un RDV qui n'a pas bougé).
  const ajuster = useCallback((rdvId, { deltaMinutes, dureeMinutes } = {}) => {
    if (!rdvId) return;
    if (deltaMinutes) {
      setDecalages((prev) => {
        const next = new Map(prev);
        const cumul = (next.get(rdvId) || 0) + deltaMinutes;
        if (cumul === 0) next.delete(rdvId); else next.set(rdvId, cumul);
        return next;
      });
    }
    if (dureeMinutes != null) {
      // La durée est ABSOLUE (elle remplace), là où le décalage se cumule : la
      // barre envoie « ce bloc mesure maintenant 60 min », pas « −30 ».
      setDurees((prev) => {
        const next = new Map(prev);
        const initiale = (journee?.rdvs || []).find((r) => r.id === rdvId)?.duration_minutes;
        if (dureeMinutes === initiale) next.delete(rdvId);
        else next.set(rdvId, dureeMinutes);
        return next;
      });
    }
  }, [journee]);

  const reinitialiser = useCallback(() => {
    setDecalages(new Map());
    setDurees(new Map());
  }, []);

  // Un décalage ÉCRIT en base doit sortir de la Map, exactement comme un
  // candidat posé sort de la sélection : après l'écriture, le rafraîchissement
  // des caches renvoie le RDV à sa nouvelle heure. Le laisser ici le
  // re-décalerait par-dessus — +30 min affiché deviendrait +60, et un second
  // essai l'écrirait pour de bon.
  const retirerAjustements = useCallback((ids) => {
    if (!ids?.length) return;
    const purger = (prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    };
    setDecalages(purger);
    setDurees(purger);
  }, []);

  const journeeAjustee = useMemo(() => {
    if (!journee) return null;
    if (decalages.size === 0 && durees.size === 0) return journee;
    const rdvs = appliquerAjustements(journee.rdvs, decalages, durees);
    // `chargeMinutes` EST recalculée quand une durée change : raccourcir une
    // intervention libère du temps de travail, et c'est justement le but du
    // geste. Un décalage seul ne la touche pas (mêmes durées, autres créneaux).
    const chargeMinutes = durees.size === 0
      ? journee.chargeMinutes
      : rdvs.reduce((s2, r) => s2 + (r.duration_minutes || 60), 0);
    return { ...journee, rdvs, chargeMinutes };
  }, [journee, decalages, durees]);

  // Deux Maps, un seul compteur : l'écran parle d'« ajustements en attente »,
  // pas de la mécanique interne. Un RDV à la fois décalé ET raccourci compte
  // pour un.
  const nbAjustements = useMemo(
    () => new Set([...decalages.keys(), ...durees.keys()]).size,
    [decalages, durees],
  );

  return {
    decalages, durees, nbAjustements, journeeAjustee, ajuster, reinitialiser, retirerAjustements,
  };
}

export default useAjustementsJournee;

/**
 * Écrit en base les ajustements en attente (heure et/ou durée). SEULE
 * implémentation de cette écriture : elle sert au panneau de remplissage (avant la pose des nouveaux
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
export async function ecrireAjustements(rdvsAjustes, decalages, durees) {
  const cibles = new Set([...(decalages?.keys() || []), ...(durees?.keys() || [])]);
  if (cibles.size === 0) return { ids: [], echec: null };
  const ids = [];
  for (const id of cibles) {
    const rdv = (rdvsAjustes || []).find((r) => r.id === id);
    if (!rdv) continue;
    try {
      const { error } = await appointmentsService.updateAppointment(id, {
        scheduled_start: rdv.scheduled_start,
        scheduled_end: rdv.scheduled_end,
        duration_minutes: rdv.duration_minutes,
      });
      if (error) {
        return { ids, echec: { nom: rdv.client_name || 'RDV', message: messageErreur(error, 'déplacement refusé') } };
      }
      ids.push(id);
    } catch (err) {
      logger.error('[tournees] ecrireAjustements', err);
      return { ids, echec: { nom: rdv.client_name || 'RDV', message: err?.message || 'exception inattendue' } };
    }
  }
  return { ids, echec: null };
}
