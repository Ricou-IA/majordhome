/**
 * usePlanningGestes.js - Majord'home Artisan
 * ============================================================================
 * Gestes sur le calendrier du Planning (FullCalendar) :
 *   - clic dans le vide → fenêtre « Nouveau RDV » sur ce créneau ;
 *   - clic sur un RDV → sa fenêtre ;
 *   - RDV glissé ou étiré → nouvel horaire enregistré, bloc remis en place si
 *     l'écriture échoue ; un RDV CONFIRMÉ au client demande d'abord un accord
 *     (Eric 2026-11-23 : « éviter de déplacer un RDV confirmé ») — la base retire
 *     alors la confirmation (src/lib/confirmationRdv.js, migration 20261123_1).
 * Ce que chaque geste veut dire en données : src/lib/planningGestes.js (pur, testé).
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '@lib/logger';
import { creneauDeSelection, idDuRdv, horaireDeBloc } from '@/lib/planningGestes';
import { deplacementDemandeAccord } from '@/lib/confirmationRdv';

/**
 * @param {object} p
 * @param {{ current: { getApi: () => object }|null }} p.calendarRef  réf. du composant FullCalendar
 * @param {(id: string, horaire: object) => Promise<unknown>} p.moveAppointment  mutation de useAppointments (rejette sur un refus)
 * @param {(creneau: { defaultDate: string, defaultTime: string }) => void} p.ouvrirCreation  usePlanningFenetreRdv
 * @param {(rdv: object) => void} p.ouvrirEdition
 * @returns {{ surSelection: Function, surClic: Function, surDeplacement: Function, surEtirement: Function,
 *   deplacementEnAttente: (object|null), confirmerDeplacement: Function, annulerDeplacement: Function }}
 *   `deplacementEnAttente` : geste sur un RDV confirmé au client, en attente d'accord (fenêtre de la page).
 */
export function usePlanningGestes({ calendarRef, moveAppointment, ouvrirCreation, ouvrirEdition }) {
  // Clic dans le vide → créer un RDV sur ce créneau.
  const surSelection = useCallback((selection) => {
    ouvrirCreation(creneauDeSelection(selection));
    calendarRef.current?.getApi().unselect();
  }, [calendarRef, ouvrirCreation]);

  // Clic sur un RDV → sa fenêtre.
  const surClic = useCallback((clic) => {
    ouvrirEdition(clic.event.extendedProps);
  }, [ouvrirEdition]);

  const enregistrer = useCallback(async (info, { etirement = false } = {}) => {
    try {
      await moveAppointment(idDuRdv(info.event), horaireDeBloc(info.event));
      if (!etirement) toast.success('RDV déplacé');
    } catch (err) {
      logger.error('[Planning] moveAppointment error:', err);
      info.revert();
      toast.error(etirement ? 'Erreur lors du redimensionnement' : 'Erreur lors du déplacement');
    }
  }, [moveAppointment]);

  // Geste sur un RDV confirmé au client : on attend l'accord (le bloc reste à sa nouvelle place
  // jusqu'à la réponse, « Annuler » le remet).
  const [deplacementEnAttente, setDeplacementEnAttente] = useState(null);

  const geste = useCallback((info, options) => {
    if (deplacementDemandeAccord(info.event.extendedProps)) {
      setDeplacementEnAttente({ info, options, rdv: info.event.extendedProps });
      return;
    }
    enregistrer(info, options);
  }, [enregistrer]);

  const surDeplacement = useCallback((info) => geste(info), [geste]);
  const surEtirement = useCallback((info) => geste(info, { etirement: true }), [geste]);

  const confirmerDeplacement = useCallback(async () => {
    const attente = deplacementEnAttente;
    setDeplacementEnAttente(null);
    if (!attente) return;
    await enregistrer(attente.info, attente.options);
    toast.info('Le client avait eu cette heure : pensez à le prévenir, puis à reconfirmer le RDV.');
  }, [deplacementEnAttente, enregistrer]);

  const annulerDeplacement = useCallback(() => {
    deplacementEnAttente?.info.revert();
    setDeplacementEnAttente(null);
  }, [deplacementEnAttente]);

  return { surSelection, surClic, surDeplacement, surEtirement, deplacementEnAttente, confirmerDeplacement, annulerDeplacement };
}
