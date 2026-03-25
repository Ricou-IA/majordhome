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
import { CONTRACT_STATUSES, CONTRACT_FREQUENCIES } from '@/shared/services/contracts.service';

// ============================================================================
// RÉEXPORT DES CONSTANTES (pour backward-compat des imports)
// ============================================================================

export { CONTRACT_STATUSES, CONTRACT_FREQUENCIES };

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
      console.log('[entretiensService] getContracts', { orgId, filters, limit, offset });

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
      if (filters.search && filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`client_name.ilike.${term},client_city.ilike.${term},client_postal_code.ilike.${term}`);
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
      console.log('[entretiensService] getContractById', contractId);

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
      console.log('[entretiensService] updateContract', contractId, updates);

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
      console.log('[entretiensService] getStats', { orgId, year });

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
      console.log('[entretiensService] getContractsBySector', { orgId, status });

      let query = supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('org_id', orgId)
        .order('client_postal_code', { ascending: true, nullsFirst: false })
        .order('client_name', { ascending: true, nullsFirst: false });

      if (status) {
        query = query.eq('status', status);
      } else {
        // Sans filtre statut explicite, exclure les archivés
        query = query.neq('status', 'archived');
      }

      const { data, error } = await query;

      if (error) {
        console.error('[entretiensService] getContractsBySector error:', error);
        return { data: [], error };
      }

      // Grouper par code postal client
      const sectors = {};
      for (const contract of (data || [])) {
        const cp = contract.client_postal_code || 'Inconnu';
        const city = contract.client_city || '';

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
        (a, b) => b.visitsPending - a.visitsPending || a.codePostal.localeCompare(b.codePostal)
      );

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
      console.log('[entretiensService] getVisitsForContract', contractId);

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
      console.log('[entretiensService] recordVisit', { contractId, year, visitDate });

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
        console.log('[entretiensService] recordVisit → update existing', existing.id);
        ({ data, error } = await supabase
          .from('majordhome_maintenance_visits')
          .update(visitData)
          .eq('id', existing.id)
          .select()
          .single());
      } else {
        // Création nouvelle visite
        console.log('[entretiensService] recordVisit → insert new');
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

      // Cascade : créer automatiquement une intervention si visite "completed"
      if ((status === 'completed') && data) {
        try {
          console.log('[entretiensService] recordVisit → cascade intervention creation');

          // Récupérer project_id via contrat → client
          const { data: contract } = await supabase
            .from('majordhome_contracts')
            .select('client_id')
            .eq('id', contractId)
            .single();

          if (contract?.client_id) {
            const { data: client } = await supabase
              .from('majordhome_clients')
              .select('project_id')
              .eq('id', contract.client_id)
              .single();

            if (client?.project_id) {
              const { data: intervention } = await supabase
                .from('majordhome_interventions')
                .insert({
                  project_id: client.project_id,
                  intervention_type: 'maintenance',
                  scheduled_date: visitDate || new Date().toISOString().split('T')[0],
                  status: 'completed',
                  report_notes: notes || null,
                  technician_id: technicianId || null,
                  technician_name: technicianName || null,
                  created_by: userId || null,
                  tags: ['Contrat'],
                })
                .select('id')
                .single();

              // Lier l'intervention à la visite
              if (intervention?.id) {
                await supabase
                  .from('majordhome_maintenance_visits')
                  .update({ intervention_id: intervention.id })
                  .eq('id', data.id);
                console.log('[entretiensService] cascade → intervention', intervention.id, 'liée à visite', data.id);
              }
            }
          }
        } catch (cascadeErr) {
          // Non-bloquant : la visite est enregistrée, la cascade est best-effort
          console.error('[entretiensService] cascade intervention creation error:', cascadeErr);
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
      console.log('[entretiensService] updateVisitStatus', { visitId, status });

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
   * Déclenche la génération du PDF contrat via N8N
   * Formate les données du contrat au format attendu par le webhook "Mayer - Entretien Contrat"
   * (nom, prenom, email, details[], estimationTTC, zone, etc.)
   * Le workflow N8N génère le HTML via l'API LP, convertit en PDF, l'envoie par email au client.
   *
   * @param {Object} contractData - Objet contrat depuis la vue majordhome_contracts
   * @returns {{ success, error }}
   */
  async triggerContractPdf(contractData) {
    if (!contractData?.id) throw new Error('[entretiensService] contractData requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_CONTRACT_PDF;
    if (!webhookUrl) {
      console.error('[entretiensService] VITE_N8N_WEBHOOK_CONTRACT_PDF non configuré');
      return { success: false, error: new Error('Webhook contrat PDF non configuré') };
    }

    try {
      // Charger les équipements liés au contrat
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

        // Charger les types d'équipements pour les labels
        const { data: equipTypes } = await supabase
          .from('majordhome_pricing_equipment_types')
          .select('id, label, has_unit_pricing, included_units, unit_label')
          .eq('is_active', true);

        // Charger les tarifs pour la zone du contrat
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

        // Grouper par equipment_type_id + calculer prix
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
          let lineTotal = basePrice;
          if (et?.has_unit_pricing) {
            const extraUnits = Math.max(0, g.quantity - (et.included_units || 0));
            lineTotal = basePrice + extraUnits * unitPrice;
          }
          return {
            label: et?.label || 'Équipement',
            price: lineTotal,
            quantity: g.quantity,
          };
        });
      }

      // Extraire nom / prénom depuis client_name ("PRENOM NOM")
      const nameParts = (contractData.client_name || '').trim().split(/\s+/);
      const prenom = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
      const nom = nameParts.length > 0 ? nameParts[nameParts.length - 1] : '';

      // Remise label
      const discountPct = parseFloat(contractData.discount_percent) || 0;
      const discountLabel = discountPct > 0
        ? `Remise multi-équipements (-${discountPct}%)`
        : '';

      // Payload au format webhook N8N "Mayer - Entretien Contrat"
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

      console.log('[entretiensService] triggerContractPdf → payload', payload);

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
