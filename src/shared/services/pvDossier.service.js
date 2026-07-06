// src/shared/services/pvDossier.service.js
// CRUD dossier PV via la vue publique majordhome_pv_dossiers (security_invoker, auto-updatable).
// Création LAZY : upsertForSimulation garantit 1 simulation → au plus 1 dossier (pv_simulation_id UNIQUE).
// status muté UNIQUEMENT via la RPC pv_dossier_advance (forward-only). org_id filtré explicitement.
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const VIEW = 'majordhome_pv_dossiers';

export const pvDossierService = {
  /** Dossier attaché à une simulation, ou null. */
  async getBySimulation(orgId, simulationId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from(VIEW)
        .select('*')
        .eq('org_id', orgId)
        .eq('pv_simulation_id', simulationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'pvDossier.getBySimulation');
  },

  /** Création LAZY idempotente : renvoie le dossier existant ou en crée un (status 'offre'). */
  async upsertForSimulation({ orgId, userId, simulationId, leadId = null, clientId = null }) {
    return withErrorHandling(async () => {
      const { data: existing, error: exErr } = await pvDossierService.getBySimulation(orgId, simulationId);
      if (exErr) throw exErr; // échec de lecture → ne PAS retomber sur un INSERT en aveugle
      if (existing) return existing;
      const { data, error } = await supabase
        .from(VIEW)
        .insert({
          org_id: orgId,
          created_by: userId,
          pv_simulation_id: simulationId,
          lead_id: leadId,
          client_id: clientId,
          status: 'offre',
        })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }, 'pvDossier.upsertForSimulation');
  },

  /** Écrit un bloc jsonb (cadastre/roof_geometry/abf/material/declarant/documents). status EXCLU. */
  async patchBlock({ orgId, id, patch }) {
    return withErrorHandling(async () => {
      const { status, ...safe } = patch ?? {}; // garde-fou : status ne passe jamais par la vue
      void status;
      const { data, error } = await supabase
        .from(VIEW)
        .update({ ...safe, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }, 'pvDossier.patchBlock');
  },

  /** Fait avancer le status (forward-only, membership-checked) via la RPC canonique. */
  async advance({ id, targetStatus }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('pv_dossier_advance', {
        p_dossier_id: id,
        p_target_status: targetStatus,
      });
      if (error) throw error;
      return data;
    }, 'pvDossier.advance');
  },
};
