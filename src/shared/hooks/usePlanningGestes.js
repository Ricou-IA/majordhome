/**
 * usePlanningGestes.js - Majord'home Artisan
 * ============================================================================
 * Gestes sur le calendrier du Planning (FullCalendar) :
 *   - clic dans le vide → fenêtre « Nouveau RDV » sur ce créneau ;
 *   - clic sur un RDV → sa fenêtre ;
 *   - RDV glissé ou étiré → nouvel horaire enregistré, bloc remis en place si
 *     l'écriture échoue.
 * Ce que chaque geste veut dire en données : src/lib/planningGestes.js (pur, testé).
 * ============================================================================
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { logger } from '@lib/logger';
import { creneauDeSelection, idDuRdv, horaireDeBloc } from '@/lib/planningGestes';

/**
 * @param {object} p
 * @param {{ current: { getApi: () => object }|null }} p.calendarRef  réf. du composant FullCalendar
 * @param {(id: string, horaire: object) => Promise<unknown>} p.moveAppointment  mutation de useAppointments (rejette sur un refus)
 * @param {(creneau: { defaultDate: string, defaultTime: string }) => void} p.ouvrirCreation  usePlanningFenetreRdv
 * @param {(rdv: object) => void} p.ouvrirEdition
 * @returns {{ surSelection: Function, surClic: Function, surDeplacement: Function, surEtirement: Function }}
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

  // RDV glissé.
  const surDeplacement = useCallback(async (info) => {
    try {
      await moveAppointment(idDuRdv(info.event), horaireDeBloc(info.event));
      toast.success('RDV déplacé');
    } catch (err) {
      logger.error('[Planning] moveAppointment error:', err);
      info.revert();
      toast.error('Erreur lors du déplacement');
    }
  }, [moveAppointment]);

  // RDV étiré ou raccourci.
  const surEtirement = useCallback(async (info) => {
    try {
      await moveAppointment(idDuRdv(info.event), horaireDeBloc(info.event));
    } catch (err) {
      logger.error('[Planning] resize error:', err);
      info.revert();
      toast.error('Erreur lors du redimensionnement');
    }
  }, [moveAppointment]);

  return { surSelection, surClic, surDeplacement, surEtirement };
}
