/**
 * eventActivation.js — activation déduppée de la carte d'un RDV (sortie d'EventModal).
 * SOURCE UNIQUE partagée par le chemin classique (édition / « Autre ») et le chemin
 * assistant (VT/entretien/SAV/install). Plus d'auto-lead silencieux : le seul prospect
 * créé est le walk-in inconnu (Planning, ni client ni lead, type commercial R1).
 */
import { toast } from 'sonner';
import { COMMERCIAL_TYPES } from '@services/appointments.service';
import { leadsService } from '@services/leads.service';
import { resolveCardForAppointment } from '@services/appointmentActivation.service';
import { logger } from '@lib/logger';

// ID du statut "RDV planifié" (table majordhome.statuses)
const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';
// ID source par défaut pour les walk-in
const DEFAULT_SOURCE_BOUCHE_A_OREILLE = '3d945733-475a-46ee-891b-50acf9e2151d';

/**
 * @returns {Promise<{ leadId: string|null, interventionId: string|null, error: string|null, candidates?: Array }>}
 *   error ∈ null | 'duplicate' (candidates fournis) | 'prospect' | 'activation' |
 *   'client_sans_projet' | 'contrat_requis_entretien'
 */
export async function resolveEventActivation({
  orgId, userId, formData, selectedClient, selectedLead, attachContext, rdvDate, dupDecision,
}) {
  const fallbackInterventionId = attachContext?.interventionId || null;
  const isClosing = formData.appointment_type === 'rdv_closing';

  // Décision du filet anti-doublon : « lier » désamorce le walk-in, la carte du
  // lead existant est résolue par le chemin standard resolveCardForAppointment.
  const linkLeadId = dupDecision?.action === 'link' ? dupDecision.leadId : null;

  // Walk-in inconnu (Planning, ni client ni lead, type commercial) -> vrai prospect.
  // Restreint au R1 (rdv_technical/rdv_agency) : un Bouclage R2 ne fabrique JAMAIS
  // de prospect (il exige une carte existante, cf. isClosing).
  const isWalkInProspect = !linkLeadId && !selectedClient && !selectedLead && !attachContext
    && COMMERCIAL_TYPES.includes(formData.appointment_type)
    && !isClosing;

  if (isWalkInProspect) {
    // Filet anti-doublon : pas de création silencieuse si un lead actif partage
    // téléphone / email / nom+prénom — le choix (lier / créer) revient à l'humain.
    // Best-effort : une erreur de la recherche ne bloque pas la création.
    if (dupDecision?.action !== 'create') {
      const dup = await leadsService.findPotentialDuplicates({
        orgId,
        phone: formData.client_phone,
        email: formData.client_email,
        firstName: formData.client_first_name,
        lastName: formData.client_name,
      });
      if (dup.data?.length) {
        return { leadId: null, interventionId: null, error: 'duplicate', candidates: dup.data };
      }
    }
    const result = await leadsService.createLead({
      orgId,
      userId,
      first_name: formData.client_first_name || null,
      last_name: formData.client_name || null,
      email: formData.client_email || null,
      phone: formData.client_phone || null,
      address: formData.client_address || null,
      postal_code: formData.client_postal_code || null,
      city: formData.client_city || null,
      source_id: DEFAULT_SOURCE_BOUCHE_A_OREILLE,
      status_id: RDV_PLANIFIE_STATUS_ID,
      notes: `Prospect créé depuis le Planning — RDV du ${rdvDate || ''}`.trim(),
    });
    if (result.error) {
      logger.error('[EventModal] create prospect error:', result.error);
      return { leadId: null, interventionId: null, error: 'prospect' };
    }
    const leadId = result.data?.id || null;
    if (leadId) toast.success('Prospect créé dans le pipeline');
    return { leadId, interventionId: fallbackInterventionId, error: null };
  }

  // Rattache / matérialise la carte du client selon le type (entretien/SAV/VT).
  const resolved = await resolveCardForAppointment({
    orgId,
    userId,
    type: formData.appointment_type,
    clientId: selectedClient?.id || null,
    leadId: linkLeadId || selectedLead?.id || attachContext?.leadId || null,
    interventionId: fallbackInterventionId,
  });
  if (resolved.error) {
    const expected = ['client_sans_projet', 'contrat_requis_entretien'].includes(resolved.error);
    if (!expected) {
      logger.error('[EventModal] activation error:', resolved.error);
    }
    return {
      leadId: null,
      interventionId: null,
      error: expected ? resolved.error : 'activation',
    };
  }
  return {
    leadId: resolved.lead_id || null,
    interventionId: resolved.intervention_id || null,
    error: null,
  };
}

/** Mappe le code d'erreur d'activation -> toast. Renvoie true si erreur (= stop). */
export function reportActivationError(error) {
  if (!error) return false;
  if (error === 'client_sans_projet') {
    toast.error("Ce client n'a pas de fiche projet — impossible de créer l'entretien.");
  } else if (error === 'contrat_requis_entretien') {
    toast.error("Ce client n'a pas de contrat d'entretien actif : créez d'abord le contrat, ou choisissez un autre type de RDV (SAV, Autre…).");
  } else if (error === 'bouclage_requiert_carte') {
    toast.error('Sélectionnez la carte du pipeline à boucler.');
  } else if (error === 'prospect') {
    toast.error('Erreur lors de la création du prospect');
  } else {
    toast.error("Erreur lors de l'activation de la carte");
  }
  return true;
}
