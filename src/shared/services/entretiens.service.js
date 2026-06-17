/**
 * entretiens.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion de la page Entretiens :
 * liste contrats enrichis (client info), stats dashboard, vue secteurs, visites.
 *
 * Utilise les vues publiques :
 * - majordhome_contracts (enrichie avec client_name, client_address, etc.)
 * - majordhome_maintenance_visits (visites de maintenance)
 *
 * Écritures :
 * - .schema('majordhome').from('contracts') pour les contrats (updateContract)
 * - majordhome_maintenance_visits (vue publique auto-updatable) pour les visites
 *
 * @version 2.0.0 - Reconnexion au nouveau modèle contracts (remplace pending_contracts)
 * @version 1.0.0 - Sprint 5 (ancien système pending_contracts — supprimé)
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { getMajordhomeOrgId } from '@/lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@/lib/postgrestUtils';
import { CONTRACT_STATUSES, CONTRACT_FREQUENCIES } from '@services/contracts.service';
import { clusterSectorsByProximity } from '@/lib/sectorClustering';

// ============================================================================
// RÉEXPORT DES CONSTANTES (pour backward-compat des imports)
// ============================================================================

export { CONTRACT_STATUSES, CONTRACT_FREQUENCIES };

// ============================================================================
// HELPER INTERNE — Synchronisation Kanban + Planning depuis recordVisit
// ============================================================================

/**
 * Garantit qu'une carte Kanban entretien (parent en `planifie`) et un RDV Planning
 * existent pour le contrat à la date saisie. Crée ou met à jour selon le cas.
 *
 * Cas d'usage : le client appelle pour planifier (ou décaler) sa visite annuelle
 * et l'utilisateur saisit la date directement depuis la fiche contrat.
 *
 * - Pas de carte → CREATE entretien parent (workflow_status='planifie') + appointment
 * - Carte en planifie/a_planifier → UPDATE scheduled_date du parent + UPDATE/CREATE appointment
 * - Carte en realise/facture → no-op (visite déjà clôturée, recordVisit fait juste l'UPSERT maintenance_visits)
 */
async function ensureKanbanAndAppointmentForVisit({ contractId, coreOrgId, visitDate, notes, userId }) {
  // Charger le contrat → client_id + estimated_time pour la durée du RDV
  const { data: contract } = await supabase
    .from('majordhome_contracts')
    .select('client_id, estimated_time')
    .eq('id', contractId)
    .single();

  if (!contract?.client_id) return;

  // Charger les infos client (project_id obligatoire pour intervention)
  const { data: client } = await supabase
    .from('majordhome_clients')
    .select('project_id, display_name, first_name, last_name, address, postal_code, city, phone, email')
    .eq('id', contract.client_id)
    .single();

  if (!client?.project_id) return;

  // 1) Entretien parent (carte Kanban)
  const { data: existingParent } = await supabase
    .from('majordhome_interventions')
    .select('id, workflow_status, scheduled_date')
    .eq('contract_id', contractId)
    .eq('intervention_type', 'entretien')
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const parentClosed = existingParent?.workflow_status === 'realise'
    || existingParent?.workflow_status === 'facture';

  let parentId = existingParent?.id || null;

  if (!existingParent) {
    // CREATE entretien parent en planifie
    const { data: createdParent, error: insertErr } = await supabase
      .from('majordhome_interventions')
      .insert({
        project_id: client.project_id,
        client_id: contract.client_id,
        contract_id: contractId,
        intervention_type: 'entretien',
        workflow_status: 'planifie',
        scheduled_date: visitDate,
        status: 'scheduled',
        report_notes: notes || null,
        created_by: userId || null,
        tags: ['Contrat'],
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[entretiensService] CREATE entretien parent error:', insertErr);
    } else {
      parentId = createdParent.id;
    }
  } else if (!parentClosed && existingParent.scheduled_date !== visitDate) {
    // UPDATE date du parent (cas : client décale son RDV)
    const { error: updateErr } = await supabase
      .from('majordhome_interventions')
      .update({
        scheduled_date: visitDate,
        workflow_status: 'planifie',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingParent.id);

    if (updateErr) {
      console.error('[entretiensService] UPDATE entretien parent error:', updateErr);
    }
  }

  // 2) Appointment Planning — uniquement si la carte n'est pas clôturée
  if (parentClosed) return;

  const visitYear = new Date(visitDate).getFullYear();
  const yearStart = `${visitYear}-01-01`;
  const yearEnd = `${visitYear}-12-31`;

  // Cherche un RDV maintenance existant pour ce client sur l'année (anti-doublon décalage)
  const { data: existingAppt } = await supabase
    .from('majordhome_appointments')
    .select('id, scheduled_date')
    .eq('client_id', contract.client_id)
    .eq('appointment_type', 'maintenance')
    .gte('scheduled_date', yearStart)
    .lte('scheduled_date', yearEnd)
    .in('status', ['scheduled', 'confirmed'])
    .order('scheduled_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingAppt?.id) {
    const apptUpdates = { intervention_id: parentId, updated_at: new Date().toISOString() };
    if (existingAppt.scheduled_date !== visitDate) apptUpdates.scheduled_date = visitDate;
    const { error: updateApptErr } = await supabase
      .from('majordhome_appointments')
      .update(apptUpdates)
      .eq('id', existingAppt.id);

    if (updateApptErr) {
      console.error('[entretiensService] UPDATE appointment error:', updateApptErr);
    }
    return;
  }

  // CREATE appointment
  const majordhomeOrgId = await getMajordhomeOrgId(coreOrgId);
  if (!majordhomeOrgId) {
    console.warn('[entretiensService] majordhome org_id introuvable, skip appointment');
    return;
  }

  const clientName = client.display_name
    || [client.last_name, client.first_name].filter(Boolean).join(' ').trim()
    || 'Client';

  const { error: insertApptErr } = await supabase
    .from('majordhome_appointments')
    .insert({
      org_id: majordhomeOrgId,
      scheduled_date: visitDate,
      scheduled_start: '09:00:00',
      duration_minutes: contract.estimated_time || 60,
      appointment_type: 'maintenance',
      status: 'scheduled',
      subject: `Entretien annuel — ${clientName}`,
      client_id: contract.client_id,
      intervention_id: parentId,
      client_name: clientName,
      client_first_name: client.first_name || null,
      client_phone: client.phone || null,
      client_email: client.email || null,
      address: client.address || null,
      postal_code: client.postal_code || null,
      city: client.city || null,
      description: notes || null,
      source: 'manual',
    });

  if (insertApptErr) {
    console.error('[entretiensService] CREATE appointment error:', insertApptErr);
  }
}

// ============================================================================
// HELPER EXPORTÉ — Matérialisation carte entretien (sans appointment)
// ============================================================================

/**
 * Matérialise (ou réutilise) la carte Kanban entretien/SAV d'un client, SANS créer
 * d'appointment (le RDV est créé à part par le flux d'activation de prise de RDV).
 *
 * Idempotent : réutilise la carte parent non terminale existante du client + type.
 * Bloc A — consommé par `resolveCardForAppointment` (appointmentActivation.service).
 *
 * @param {Object} p
 * @param {string} p.clientId
 * @param {string|null} [p.contractId] - lié au contrat actif si présent (sinon carte dégradée)
 * @param {string|null} [p.visitDate] - pré-remplit interventions.scheduled_date (compat legacy ; la date d'affichage est dérivée du RDV)
 * @param {string|null} [p.userId]
 * @param {'entretien'|'sav'} [p.interventionType]
 * @returns {Promise<{ interventionId: string|null, error: any }>}
 */
export async function ensureEntretienCard({
  clientId,
  contractId = null,
  visitDate = null,
  userId = null,
  interventionType = 'entretien',
}) {
  if (!clientId) return { interventionId: null, error: 'client_requis' };

  // project_id obligatoire pour une intervention (INNER JOIN core.projects dans la vue)
  const { data: client } = await supabase
    .from('majordhome_clients')
    .select('project_id')
    .eq('id', clientId)
    .maybeSingle();
  if (!client?.project_id) return { interventionId: null, error: 'client_sans_projet' };

  // Anti-doublon : carte parent non terminale déjà existante pour ce client + type
  const { data: existing } = await supabase
    .from('majordhome_interventions')
    .select('id')
    .eq('client_id', clientId)
    .eq('intervention_type', interventionType)
    .is('parent_id', null)
    .not('workflow_status', 'in', '(realise,facture)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { interventionId: existing.id, error: null };

  const { data: created, error } = await supabase
    .from('majordhome_interventions')
    .insert({
      project_id: client.project_id,
      client_id: clientId,
      contract_id: contractId,
      intervention_type: interventionType,
      workflow_status: 'planifie',
      scheduled_date: visitDate,
      status: 'scheduled',
      created_by: userId,
      tags: contractId ? ['Contrat'] : [],
    })
    .select('id')
    .single();

  if (error) {
    console.error('[entretiensService] ensureEntretienCard insert error:', error);
    return { interventionId: null, error };
  }
  return { interventionId: created.id, error: null };
}

// ============================================================================
// SERVICE
// ============================================================================

export const entretiensService = {
  // ==========================================================================
  // CONTRATS — LECTURE (vue enrichie majordhome_contracts)
  // ==========================================================================

  /**
   * Liste paginée des contrats avec filtres + infos client
   * @param {Object} params
   * @param {string} params.orgId - ID organisation
   * @param {Object} params.filters - Filtres (search, status, frequency)
   * @param {number} params.limit - Nombre max de résultats
   * @param {number} params.offset - Offset pour pagination
   * @returns {{ data, count, error }}
   */
  async getContracts({ orgId, filters = {}, limit = 50, offset = 0 }) {
    try {

      let query = supabase
        .from('majordhome_contracts')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .order('client_name', { ascending: true, nullsFirst: false });

      // Filtre statut visite (PRIORITAIRE — implique status='active')
      // 'remaining' = actifs SANS visite (completed/scheduled) pour l'année en cours
      // 'done' = actifs AVEC visite completed pour l'année en cours
      if (filters.visitStatus === 'remaining') {
        query = query.eq('status', 'active');
        query = query.is('current_year_visit_status', null);
      } else if (filters.visitStatus === 'done') {
        query = query.eq('status', 'active');
        query = query.eq('current_year_visit_status', 'completed');
      } else if (filters.status) {
        // Filtre statut contrat (seulement quand visitStatus n'est pas actif)
        query = query.eq('status', filters.status);
      }

      // Exclure les archivés par défaut (quand aucun filtre statut explicite)
      // Les archivés ne s'affichent QUE si filters.status === 'archived'
      if (!filters.visitStatus && !filters.status) {
        query = query.neq('status', 'archived');
      }

      // Filtre recherche textuelle (nom client, commune, code postal)
      // P0.26 : escape pour eviter injection PostgREST via virgule/parentheses.
      if (filters.search && filters.search.trim()) {
        const safe = escapePostgrestSearchTerm(filters.search);
        if (safe) {
          const term = `%${safe}%`;
          query = query.or(`client_name.ilike.${term},client_city.ilike.${term},client_postal_code.ilike.${term}`);
        }
      }

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;

      if (error) {
        console.error('[entretiensService] getContracts error:', error);
        return { data: [], count: 0, error };
      }

      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      console.error('[entretiensService] getContracts exception:', error);
      return { data: [], count: 0, error };
    }
  },

  /**
   * Détail d'un contrat par ID (enrichi avec infos client)
   */
  async getContractById(contractId) {
    try {

      const { data, error } = await supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('id', contractId)
        .single();

      if (error) {
        console.error('[entretiensService] getContractById error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('[entretiensService] getContractById exception:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // CONTRATS — ÉCRITURE
  // ==========================================================================

  /**
   * Mise à jour d'un contrat
   */
  async updateContract(contractId, updates) {
    try {

      const updateData = {};
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.frequency !== undefined) updateData.frequency = updates.frequency;
      if (updates.startDate !== undefined) updateData.start_date = updates.startDate || null;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate || null;
      if (updates.nextMaintenanceDate !== undefined) updateData.next_maintenance_date = updates.nextMaintenanceDate || null;
      if (updates.maintenanceMonth !== undefined) updateData.maintenance_month = updates.maintenanceMonth ? parseInt(updates.maintenanceMonth) : null;
      if (updates.amount !== undefined) updateData.amount = updates.amount ? parseFloat(updates.amount) : null;
      if (updates.estimatedTime !== undefined) updateData.estimated_time = updates.estimatedTime ? parseFloat(updates.estimatedTime) : null;
      if (updates.notes !== undefined) updateData.notes = updates.notes || null;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update(updateData)
        .eq('id', contractId)
        .select()
        .single();

      if (error) {
        console.error('[entretiensService] updateContract error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('[entretiensService] updateContract exception:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // STATISTIQUES
  // ==========================================================================

  /**
   * Stats agrégées pour le dashboard entretiens
   */
  async getStats(orgId, year) {
    try {

      // Tous les contrats de l'org SAUF archivés (vue enrichie avec current_year_visit_status)
      const { data: contracts, error: contractsError } = await supabase
        .from('majordhome_contracts')
        .select('id, status, frequency, amount, current_year_visit_status')
        .eq('org_id', orgId)
        .neq('status', 'archived');

      if (contractsError) throw contractsError;

      const allContracts = contracts || [];
      const activeContracts = allContracts.filter((c) => c.status === 'active');
      const cancelledContracts = allContracts.filter((c) => c.status === 'cancelled');

      // Comptages visites basés sur current_year_visit_status (colonne calculée de la vue)
      const visitsDone = activeContracts.filter((c) => c.current_year_visit_status === 'completed').length;
      const visitsScheduled = activeContracts.filter((c) => c.current_year_visit_status === 'scheduled').length;
      const visitesRestantes = Math.max(0, activeContracts.length - visitsDone - visitsScheduled);

      const totalRevenue = activeContracts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

      // Stats par fréquence
      const byType = {};
      for (const c of activeContracts) {
        const freq = c.frequency || 'annuel';
        const label = CONTRACT_FREQUENCIES.find(f => f.value === freq)?.label || freq;
        if (!byType[label]) byType[label] = { type: label, count: 0, revenue: 0, visitsDone: 0 };
        byType[label].count++;
        byType[label].revenue += Number(c.amount) || 0;
        if (c.current_year_visit_status === 'completed') {
          byType[label].visitsDone++;
        }
      }

      return {
        data: {
          totalContracts: allContracts.length,
          openContracts: activeContracts.length,
          closedContracts: cancelledContracts.length,
          totalRevenue,
          visitsDone,
          visitesRestantes,
          completionRate: activeContracts.length > 0 ? Math.round((visitsDone / activeContracts.length) * 100) : 0,
          byType: Object.values(byType).sort((a, b) => b.count - a.count),
        },
        error: null,
      };
    } catch (error) {
      console.error('[entretiensService] getStats error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // SECTEURS (vue groupée par code postal)
  // ==========================================================================

  /**
   * Contrats groupés par code postal client pour vue secteurs
   */
  async getContractsBySector(orgId, { status = 'active' } = {}) {
    try {
      let query = supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('org_id', orgId)
        .order('client_postal_code', { ascending: true, nullsFirst: false })
        .order('client_name', { ascending: true, nullsFirst: false });

      if (status) {
        query = query.eq('status', status);
      } else {
        query = query.neq('status', 'archived');
      }

      const { data, error } = await query;

      if (error) {
        console.error('[entretiensService] getContractsBySector error:', error);
        return { data: [], error };
      }

      const contracts = data || [];

      // Rattacher les coordonnées client (la vue majordhome_contracts ne les expose
      // pas). Les ids sont déjà scopés à l'org via la requête contrats ci-dessus ;
      // la lecture clients est en plus scopée par RLS (security_invoker).
      const clientIds = [...new Set(contracts.map((c) => c.client_id).filter(Boolean))];
      const coordsMap = new Map();
      if (clientIds.length) {
        const { data: coordRows } = await supabase
          .from('majordhome_clients')
          .select('id, latitude, longitude')
          .in('id', clientIds);
        for (const r of coordRows || []) coordsMap.set(r.id, r);
      }

      // Grouper par code postal client
      const sectors = {};
      for (const contract of contracts) {
        const cp = contract.client_postal_code || 'Inconnu';
        const city = contract.client_city || '';
        const co = coordsMap.get(contract.client_id);
        contract.client_latitude = co?.latitude ?? null;
        contract.client_longitude = co?.longitude ?? null;

        if (!sectors[cp]) {
          sectors[cp] = {
            codePostal: cp,
            commune: city,
            contracts: [],
            totalContracts: 0,
            visitsDone: 0,
            visitsPending: 0,
          };
        }

        sectors[cp].contracts.push(contract);
        sectors[cp].totalContracts++;

        // Basé sur current_year_visit_status : visite enregistrée cette année = fait
        if (contract.current_year_visit_status === 'completed') {
          sectors[cp].visitsDone++;
        } else {
          sectors[cp].visitsPending++;
        }
      }

      // Trier par visites à faire (décroissant)
      const sortedSectors = Object.values(sectors).sort(
        (a, b) => b.visitsPending - a.visitsPending || a.codePostal.localeCompare(b.codePostal),
      );

      // Regroupement en grands secteurs géographiques (partition par CP, rayon 15 km).
      // On annote chaque secteur CP avec son grand secteur ; la forme de retour
      // (tableau de secteurs CP) reste inchangée pour le hook/la page.
      const groups = clusterSectorsByProximity(sortedSectors, { radiusKm: 15 });
      const cpToGroup = new Map();
      groups.forEach((g, idx) => {
        for (const cp of g.codePostals) cpToGroup.set(cp, { id: g.id, name: g.name, order: idx });
      });
      for (const sector of sortedSectors) {
        const g = cpToGroup.get(sector.codePostal) || {
          id: 'non-localise', name: 'Non localisé', order: groups.length,
        };
        sector.grandSecteurId = g.id;
        sector.grandSecteurName = g.name;
        sector.grandSecteurOrder = g.order;
      }

      return { data: sortedSectors, error: null };
    } catch (error) {
      console.error('[entretiensService] getContractsBySector exception:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // VISITES — LECTURE
  // ==========================================================================

  /**
   * Historique des visites pour un contrat
   */
  async getVisitsForContract(contractId) {
    try {

      const { data, error } = await supabase
        .from('majordhome_maintenance_visits')
        .select('*')
        .eq('contract_id', contractId)
        .order('visit_year', { ascending: false });

      if (error) {
        console.error('[entretiensService] getVisitsForContract error:', error);
        return { data: [], error };
      }

      return { data: data || [], error: null };
    } catch (error) {
      console.error('[entretiensService] getVisitsForContract exception:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // VISITES — ÉCRITURE
  // ==========================================================================

  /**
   * Enregistrer / marquer une visite comme effectuée
   * Check existing + insert ou update (upsert non supporté sur les vues PostgreSQL)
   */
  async recordVisit({ contractId, orgId, year, visitDate, status, technicianId, technicianName, notes, userId }) {
    try {

      // Vérifier si une visite existe déjà pour ce contrat + année
      const { data: existing } = await supabase
        .from('majordhome_maintenance_visits')
        .select('id')
        .eq('contract_id', contractId)
        .eq('visit_year', year)
        .maybeSingle();

      const visitData = {
        contract_id: contractId,
        org_id: orgId,
        visit_year: year,
        visit_date: visitDate || new Date().toISOString().split('T')[0],
        status: status || 'completed',
        technician_id: technicianId || null,
        technician_name: technicianName || null,
        notes: notes || null,
        created_by: userId || null,
        updated_at: new Date().toISOString(),
      };

      let data, error;

      if (existing?.id) {
        // Mise à jour de la visite existante
        ({ data, error } = await supabase
          .from('majordhome_maintenance_visits')
          .update(visitData)
          .eq('id', existing.id)
          .select()
          .single());
      } else {
        // Création nouvelle visite
        ({ data, error } = await supabase
          .from('majordhome_maintenance_visits')
          .insert(visitData)
          .select()
          .single());
      }

      if (error) {
        console.error('[entretiensService] recordVisit error:', error);
        return { data: null, error };
      }

      // Année courante + Passage réalisé → garnir le Kanban (carte planifie)
      // et le Planning (RDV maintenance) pour récupérer le workflow normal.
      // Année passée : pas de Kanban (chaînage annuel via maintenance_visits suffit).
      const currentYear = new Date().getFullYear();
      if (status === 'completed' && year === currentYear && data) {
        try {
          await ensureKanbanAndAppointmentForVisit({
            contractId,
            coreOrgId: orgId,
            visitDate: visitData.visit_date,
            notes,
            userId,
          });
        } catch (cascadeErr) {
          console.error('[entretiensService] Kanban/Planning sync error:', cascadeErr);
        }
      }

      return { data, error: null };
    } catch (error) {
      console.error('[entretiensService] recordVisit exception:', error);
      return { data: null, error };
    }
  },

  /**
   * Mettre à jour le statut d'une visite
   */
  async updateVisitStatus(visitId, status, notes) {
    try {

      const { data, error } = await supabase
        .from('majordhome_maintenance_visits')
        .update({
          status,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', visitId)
        .select()
        .single();

      if (error) {
        console.error('[entretiensService] updateVisitStatus error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('[entretiensService] updateVisitStatus exception:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // CONTRAT PDF — Génération via N8N
  // ==========================================================================

  /**
   * Déclenche l'email de confirmation du contrat signé via l'edge function
   * Supabase `contract-signed-notify` (remplace l'ancien workflow N8N
   * "Mayer - Entretien Contrat", désactivé 2026-05-21).
   *
   * L'edge function charge contract + org settings + template `contrat_signature_confirm`
   * depuis la DB, télécharge le PDF, et envoie via Resend avec PDF en pièce jointe.
   * Logue dans mailing_logs. Multi-tenant via core.organizations.settings.
   *
   * @param {Object} contractData - Objet contrat (au minimum { id })
   * @returns {{ success, error }}
   */
  async triggerContractPdf(contractData) {
    if (!contractData?.id) throw new Error('[entretiensService] contractData requis');

    try {
      const { data, error } = await supabase.functions.invoke('contract-signed-notify', {
        body: { contract_id: contractData.id },
      });

      if (error) {
        console.error('[entretiensService] contract-signed-notify error:', error);
        return { success: false, error };
      }
      if (data?.success === false) {
        console.error('[entretiensService] contract-signed-notify failed:', data?.error);
        return { success: false, error: new Error(data?.error || 'Edge function échec') };
      }
      return { success: true, error: null, providerId: data?.provider_id, sentTo: data?.sent_to };
    } catch (err) {
      console.error('[entretiensService] triggerContractPdf error:', err);
      return { success: false, error: err };
    }
  },

  // Ancien code N8N — remplacé par contract-signed-notify (commenté pour rollback)
  // si la migration vers l'edge function pose problème.
  async _legacyTriggerContractPdfN8n(contractData) {
    if (!contractData?.id) throw new Error('[entretiensService] contractData requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_CONTRACT_PDF;
    if (!webhookUrl) {
      console.error('[entretiensService] VITE_N8N_WEBHOOK_CONTRACT_PDF non configuré');
      return { success: false, error: new Error('Webhook contrat PDF non configuré') };
    }

    try {
      const { data: links } = await supabase
        .from('majordhome_contract_equipments')
        .select('equipment_id')
        .eq('contract_id', contractData.id);

      let details = [];
      if (links?.length > 0) {
        const equipmentIds = links.map((l) => l.equipment_id);
        const { data: equipments } = await supabase
          .from('majordhome_equipments')
          .select('equipment_type_id')
          .in('id', equipmentIds);

        const { data: equipTypes } = await supabase
          .from('majordhome_pricing_equipment_types')
          .select('id, label, has_unit_pricing, included_units, unit_label')
          .eq('is_active', true);

        const zoneId = contractData.zone_id;
        let rateMap = {};
        if (zoneId) {
          const { data: rates } = await supabase
            .from('majordhome_pricing_rates')
            .select('equipment_type_id, price, unit_price')
            .eq('zone_id', zoneId);
          for (const r of rates || []) {
            rateMap[r.equipment_type_id] = r;
          }
        }

        const typeMap = {};
        for (const et of equipTypes || []) typeMap[et.id] = et;

        const grouped = {};
        for (const eq of equipments || []) {
          const etId = eq.equipment_type_id;
          if (!etId) continue;
          if (!grouped[etId]) grouped[etId] = { typeId: etId, quantity: 0 };
          grouped[etId].quantity += 1;
        }

        details = Object.values(grouped).map((g) => {
          const et = typeMap[g.typeId];
          const rate = rateMap[g.typeId];
          const basePrice = rate ? parseFloat(rate.price) || 0 : 0;
          const unitPrice = rate ? parseFloat(rate.unit_price) || 0 : 0;
          const pricePerUnit = basePrice > 0 ? basePrice : unitPrice;
          const lineTotal = g.quantity * pricePerUnit;
          return {
            label: et?.label || 'Équipement',
            price: lineTotal,
            quantity: g.quantity,
          };
        });
      }

      const nameParts = (contractData.client_name || '').trim().split(/\s+/);
      const prenom = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
      const nom = nameParts.length > 0 ? nameParts[nameParts.length - 1] : '';

      const discountPct = parseFloat(contractData.discount_percent) || 0;
      const discountLabel = discountPct > 0
        ? `Remise multi-équipements (-${discountPct}%)`
        : '';

      const payload = {
        nom,
        prenom,
        email: contractData.client_email || '',
        telephone: contractData.client_phone || '',
        adresse: contractData.client_address || '',
        codePostal: contractData.client_postal_code || '',
        ville: contractData.client_city || '',
        details,
        estimationTTC: parseFloat(contractData.amount) || 0,
        zone: '',
        discountLabel,
        message: contractData.notes || '',
        service: "Contrat d'entretien",
        requestType: 'entretien',
        contract_id: contractData.id,
        source: contractData.source || 'app',
      };


      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[entretiensService] triggerContractPdf HTTP error:', response.status, errorText);
        return { success: false, error: new Error(`HTTP ${response.status}: ${errorText}`) };
      }

      const result = await response.json();
      return { success: result.success !== false, error: null };
    } catch (err) {
      console.error('[entretiensService] triggerContractPdf error:', err);
      return { success: false, error: err };
    }
  },

  /**
   * Récupère l'URL signée du PDF contrat depuis Supabase Storage
   * @param {string} pdfPath - Chemin dans le bucket 'contracts'
   * @returns {{ url, error }}
   */
  async getContractPdfUrl(pdfPath) {
    if (!pdfPath) return { url: null, error: new Error('pdfPath requis') };

    try {
      const { data, error } = await supabase.storage
        .from('contracts')
        .createSignedUrl(pdfPath, 3600); // 1h

      if (error) throw error;
      return { url: data.signedUrl, error: null };
    } catch (error) {
      console.error('[entretiensService] getContractPdfUrl error:', error);
      return { url: null, error };
    }
  },
};
