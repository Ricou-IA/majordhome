/**
 * usePlanningFenetreRdv.js - Majord'home Artisan
 * ============================================================================
 * Fenêtre de RDV du Planning (EventModal) : ouverte en création sur un créneau,
 * ou en édition sur un RDV ; enregistrer, supprimer, annuler. Chaque geste dit
 * son résultat (toast) et ne ferme la fenêtre que s'il a réussi.
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { logger } from '@lib/logger';

const FERMEE = Object.freeze({ open: false, mode: 'create', appointment: null, defaultDate: null, defaultTime: null });

/**
 * @param {object} p  mutations de useAppointments (elles rejettent sur un refus)
 * @param {(data: object) => Promise<unknown>} p.createAppointment
 * @param {(id: string, data: object) => Promise<unknown>} p.updateAppointment
 * @param {(id: string) => Promise<unknown>} p.deleteAppointment
 * @param {(id: string, reason?: string) => Promise<unknown>} p.cancelAppointment
 * @returns {{ fenetre: { open: boolean, mode: 'create'|'edit', appointment: object|null, defaultDate: string|null, defaultTime: string|null },
 *   ouvrirCreation: (creneau: { defaultDate: string, defaultTime: string }) => void, ouvrirEdition: (rdv: object) => void,
 *   fermer: () => void, enregistrer: (formData: object) => Promise<boolean>, supprimer: () => Promise<void>,
 *   annuler: (reason?: string) => Promise<void> }}
 */
export function usePlanningFenetreRdv({ createAppointment, updateAppointment, deleteAppointment, cancelAppointment }) {
  const [fenetre, setFenetre] = useState(FERMEE);

  const ouvrirCreation = useCallback((creneau) => {
    setFenetre({ ...FERMEE, open: true, mode: 'create', defaultDate: creneau.defaultDate, defaultTime: creneau.defaultTime });
  }, []);
  const ouvrirEdition = useCallback((rdv) => {
    setFenetre({ ...FERMEE, open: true, mode: 'edit', appointment: rdv });
  }, []);
  const fermer = useCallback(() => setFenetre(FERMEE), []);

  const enregistrer = useCallback(async (formData) => {
    const creation = fenetre.mode === 'create';
    try {
      if (creation) {
        await createAppointment(formData);
        toast.success('RDV créé avec succès');
      } else {
        await updateAppointment(fenetre.appointment.id, formData);
        toast.success('RDV modifié avec succès');
      }
      fermer();
      return true;
    } catch (err) {
      logger.error('[Planning] save appointment error:', err);
      toast.error(creation ? 'Erreur lors de la création du RDV' : 'Erreur lors de la modification du RDV');
      return false;
    }
  }, [fenetre, createAppointment, updateAppointment, fermer]);

  const supprimer = useCallback(async () => {
    if (!fenetre.appointment?.id) return;
    try {
      await deleteAppointment(fenetre.appointment.id);
      toast.success('RDV supprimé');
      fermer();
    } catch (err) {
      logger.error('[Planning] deleteAppointment error:', err);
      toast.error('Erreur lors de la suppression');
    }
  }, [fenetre, deleteAppointment, fermer]);

  const annuler = useCallback(async (reason) => {
    if (!fenetre.appointment?.id) return;
    try {
      await cancelAppointment(fenetre.appointment.id, reason);
      toast.success('RDV annulé');
      fermer();
    } catch (err) {
      logger.error('[Planning] cancelAppointment error:', err);
      toast.error('Erreur lors de l\'annulation');
    }
  }, [fenetre, cancelAppointment, fermer]);

  return { fenetre, ouvrirCreation, ouvrirEdition, fermer, enregistrer, supprimer, annuler };
}
