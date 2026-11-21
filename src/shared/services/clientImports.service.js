/**
 * clientImports.service.js - Majord'home Artisan
 * ============================================================================
 * Import des clients d'un autre logiciel : lecture des imports et des clients
 * existants, écriture par lots, retrait. Les écritures passent par les RPC
 * `clients_import_*` (SECURITY DEFINER, org dérivée de l'import côté base).
 * Les codes d'erreur de la base arrivent dans `error.message`
 * (cf. `messageErreurImport`, src/lib/importClients/lots.js).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { fetchAllPages } from '@/lib/postgrestUtils';
import { TAILLE_LOT_RETRAIT } from '@/lib/importClients/lots';

const COLONNES_EXISTANTS = 'id, display_name, first_name, last_name, company_name, client_category, email, phone, phone_secondary, postal_code, city, client_number, external_ref';

export const clientImportsService = {
  /** Imports de l'entreprise, du plus récent au plus ancien. */
  async listImports(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_client_imports')
        .select('id, org_id, created_by, created_by_name, created_at, file_name, source_label, counts, status, removed_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    }, 'clientImports.listImports');
  },

  /**
   * Tous les clients non archivés (pour repérer les doublons). Rejette si une page échoue :
   * jamais une liste partielle rendue comme complète.
   */
  async loadExistingClients(orgId) {
    return withErrorHandling(
      () => fetchAllPages((from, to) => supabase
        .from('majordhome_clients')
        .select(COLONNES_EXISTANTS)
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('id', { ascending: true })
        .range(from, to)),
      'clientImports.loadExistingClients',
    );
  },

  /** Ouvre un import ; rend son identifiant. */
  async startImport({ orgId, fileName, sourceLabel, mapping, counts }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('clients_import_start', {
        p_org_id: orgId,
        p_file_name: fileName,
        p_source_label: sourceLabel ?? null,
        p_mapping: mapping,
        p_counts: counts,
      });
      if (error) throw error;
      return data;
    }, 'clientImports.startImport');
  },

  /** Écrit un lot ; rend `{ created, skipped }`. Un lot renvoyé ne recrée rien. */
  async sendBatch({ importId, rows }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('clients_import_batch', { p_import_id: importId, p_rows: rows });
      if (error) throw error;
      return data;
    }, 'clientImports.sendBatch');
  },

  /** Clôt l'import avec son bilan. */
  async finishImport({ importId, counts }) {
    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('clients_import_finish', { p_import_id: importId, p_counts: counts });
      if (error) throw error;
      return true;
    }, 'clientImports.finishImport');
  },

  /** Combien de fiches se retirent, combien sont conservées (déjà utilisées). */
  async previewRemoval(importId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('clients_import_removal_preview', { p_import_id: importId });
      if (error) throw error;
      return data;
    }, 'clientImports.previewRemoval');
  },

  /** Retire au plus `TAILLE_LOT_RETRAIT` fiches ; rend `{ retirees, conservees, restantes }`. */
  async removeBatch(importId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('clients_import_remove', { p_import_id: importId, p_limit: TAILLE_LOT_RETRAIT });
      if (error) throw error;
      return data;
    }, 'clientImports.removeBatch');
  },
};
