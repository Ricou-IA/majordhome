/**
 * savCloture.service.js — « Intervention faite » : clôture d'un SAV traité sans planification.
 *
 * Deux écritures, dans cet ordre :
 *   1. la carte passe en Réalisé (date d'intervention + ce qui a été fait) ;
 *   2. un RDV « service » TERMINÉ est inscrit au planning à la date et pour la personne saisies.
 * La carte d'abord : `appointmentsService.createAppointment` avance en « Planifié » toute carte
 * non clôturée (syncCardStateOnCreate) — sur une carte déjà Réalisé il ne touche à rien, donc
 * pas d'aller-retour Planifié → Réalisé ni de trigger de déplanification.
 * Si le RDV échoue, la carte est remise dans son état d'origine : jamais un SAV « Réalisé »
 * sans trace au planning (c'est précisément ce que ce geste vient corriger).
 *
 * Règles pures (validation, forme du RDV) : src/lib/savCloture.js.
 */

import { supabase } from '@/lib/supabaseClient';
import { logger } from '@lib/logger';
import { appointmentsService } from './appointments.service';
import { peutCloturerSansPlanifier, validerCloture, construireRdvCloture, dateLocale } from '@/lib/savCloture';

export const savClotureService = {
  /**
   * @param {object} p
   * @param {object} p.card carte SAV (ligne de `majordhome_entretien_sav`)
   * @param {string} p.coreOrgId org CORE (celle de `useAuth().organization.id`)
   * @param {{ date: string, startTime: string, durationMinutes: number, technicianIds: string[], workPerformed?: string }} p.saisie
   * @returns {Promise<{ data: { appointmentId: string } | null, error: any }>}
   */
  async cloturerSansPlanifier({ card, coreOrgId, saisie }) {
    try {
      if (!card?.id || !coreOrgId) return { data: null, error: new Error('Carte ou organisation manquante') };
      if (!peutCloturerSansPlanifier(card)) {
        return { data: null, error: new Error('Cette carte ne peut pas être clôturée sans planification') };
      }
      const erreurs = validerCloture(saisie, { aujourdhui: dateLocale(new Date()) });
      if (erreurs.length > 0) return { data: null, error: new Error(erreurs[0]) };

      const fait = (saisie.workPerformed || '').trim();
      const avant = {
        workflow_status: card.workflow_status,
        status: card.status || 'scheduled',
        scheduled_date: card.scheduled_date || null,
        work_performed: card.work_performed || null,
      };

      // 1. Carte en Réalisé. Le filtre sur le statut d'origine refuse une carte qu'un autre
      //    poste aurait déjà déplacée entre l'ouverture de la fiche et la validation.
      const { data: cloturee, error: carteError } = await supabase
        .from('majordhome_interventions')
        .update({
          workflow_status: 'realise',
          status: 'completed',
          scheduled_date: saisie.date,
          ...(fait ? { work_performed: fait } : {}),
        })
        .eq('id', card.id)
        .eq('workflow_status', card.workflow_status)
        .select('id')
        .maybeSingle();
      if (carteError) return { data: null, error: carteError };
      if (!cloturee) {
        return { data: null, error: new Error('La carte a changé d’état entre-temps : rouvrez-la avant de la clôturer') };
      }

      // 2. RDV terminé au planning (techniciens, Google Calendar : même voie que tout RDV).
      const { data: rdv, error: rdvError } = await appointmentsService.createAppointment({
        coreOrgId,
        technicianIds: saisie.technicianIds,
        ...construireRdvCloture(card, saisie),
      });
      if (rdvError || !rdv?.id) {
        const { error: retourError } = await supabase
          .from('majordhome_interventions')
          .update(avant)
          .eq('id', card.id);
        if (retourError) {
          logger.error('[savCloture] retour de la carte impossible:', retourError);
          return { data: null, error: new Error('Le RDV n’a pas pu être inscrit au planning, et la carte est restée en Réalisé : remettez-la à la main') };
        }
        logger.error('[savCloture] inscription au planning refusée:', rdvError);
        return { data: null, error: new Error('Le RDV n’a pas pu être inscrit au planning : la carte n’a pas été clôturée') };
      }

      return { data: { appointmentId: rdv.id }, error: null };
    } catch (err) {
      logger.error('[savCloture] cloturerSansPlanifier error:', err);
      return { data: null, error: err };
    }
  },
};

export default savClotureService;
