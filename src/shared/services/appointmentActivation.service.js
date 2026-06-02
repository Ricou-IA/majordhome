/**
 * appointmentActivation.service.js - Majord'home Artisan
 * ============================================================================
 * Bloc A — Geste d'« activation » de prise de RDV.
 *
 * Résout la carte (work item) à laquelle rattacher un RDV, déterminée par son TYPE :
 *   - maintenance / service -> intervention entretien/SAV (matérialise si absente)
 *   - rdv_technical / rdv_agency (Visite Technique) -> lead pipeline (réutilise la carte
 *     « en sommeil » du client en dédup, jamais de doublon ; pas de formulaire prospect)
 *   - installation -> rien ici (la carte chantier pré-existe, rattachée en passthrough
 *     depuis le Kanban Chantier ; interdite depuis la fiche client)
 *   - other -> aucun work item (créneau calendrier pur)
 *
 * Ne crée JAMAIS de prospect : ce cas (walk-in inconnu sans fiche) est géré en amont
 * dans EventModal, seul endroit où un vrai lead prospect est créé.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { ensureEntretienCard } from '@services/entretiens.service';
import { leadsService } from '@services/leads.service';

const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';
const STATUS_GAGNE = 'c717780c-0ba7-4bf1-9e1e-5f014c1e9e2f';
const STATUS_PERDU = 'e0419cea-d0fe-4be5-aba4-56197b2fd4fb';

/**
 * @param {Object} p
 * @param {string} p.orgId - core org_id
 * @param {string} [p.userId]
 * @param {string} p.type - appointment_type
 * @param {string|null} [p.clientId]
 * @param {string|null} [p.leadId] - rattachement explicite (depuis un kanban)
 * @param {string|null} [p.interventionId] - rattachement explicite (depuis le kanban entretien)
 * @returns {Promise<{ lead_id?: string|null, intervention_id?: string|null, error?: string }>}
 */
export async function resolveCardForAppointment({
  orgId,
  userId = null,
  type,
  clientId = null,
  leadId = null,
  interventionId = null,
}) {
  // 1. Rattachement explicite (depuis un kanban) -> passthrough
  if (leadId) return { lead_id: leadId };
  if (interventionId) return { intervention_id: interventionId };

  // 2. Type calendaire pur
  if (type === 'other') return {};

  // 3. Entretien / SAV -> intervention (matérialise si absente)
  if (type === 'maintenance' || type === 'service') {
    if (!clientId) return { error: 'client_requis_entretien' };
    const { data: contract } = await supabase
      .from('majordhome_contracts')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .maybeSingle();
    const interventionType = type === 'service' ? 'sav' : 'entretien';
    const { interventionId: iid, error } = await ensureEntretienCard({
      clientId,
      contractId: contract?.id || null,
      userId,
      interventionType,
    });
    if (error) return { error };
    return { intervention_id: iid };
  }

  // 4. Visite Technique -> lead pipeline (dédup carte « en sommeil » du client)
  if (type === 'rdv_technical' || type === 'rdv_agency') {
    // Walk-in inconnu sans fiche : géré en amont (création prospect explicite)
    if (!clientId) return {};

    // Réutiliser un lead ACTIF du client (ni Gagné ni Perdu) -> jamais de doublon
    const { data: activeLead } = await supabase
      .from('majordhome_leads')
      .select('id')
      .eq('client_id', clientId)
      .eq('is_deleted', false)
      .not('status_id', 'in', `(${STATUS_GAGNE},${STATUS_PERDU})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeLead?.id) return { lead_id: activeLead.id };

    // Sinon matérialiser UNE carte liée au client (pas de formulaire prospect)
    const { data, error } = await leadsService.createLead({
      orgId,
      userId,
      client_id: clientId,
      status_id: RDV_PLANIFIE_STATUS_ID,
      notes: 'Carte client activée via prise de RDV',
    });
    if (error) return { error: 'lead_create_failed' };
    return { lead_id: data?.id };
  }

  // 5. installation (sans rattachement explicite) ou type inconnu -> aucun work item.
  //    L'installation ne se prend que depuis le Kanban Chantier (passthrough leadId).
  return {};
}

export default { resolveCardForAppointment };
