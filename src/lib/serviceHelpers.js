/**
 * serviceHelpers.js — Utilitaires partagés pour les services
 * ============================================================================
 * Helpers utilisés par tous les services : error handling, RPC unpacking,
 * org_id mapping.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

/**
 * Wrapper try/catch standardisé pour les méthodes de service.
 * Remplace le pattern dupliqué dans les 16 services.
 *
 * @param {Function} fn - Fonction async à exécuter
 * @param {string} [context=''] - Identifiant pour les logs (ex: 'clients.getById')
 * @returns {Promise<{ data: any, error: Error|null }>}
 *
 * @example
 * async getClientById(id) {
 *   return withErrorHandling(async () => {
 *     const { data, error } = await supabase.from('majordhome_clients').select('*').eq('id', id).single();
 *     if (error) throw error;
 *     return data;
 *   }, 'clients.getById');
 * }
 */
export async function withErrorHandling(fn, context = '') {
  try {
    const result = await fn();
    return { data: result, error: null };
  } catch (error) {
    if (context) {
      console.error(`[${context}]`, error);
    }
    return { data: null, error };
  }
}

/**
 * Wrapper pour les méthodes qui retournent aussi un count (pagination).
 *
 * @param {Function} fn - Fonction async retournant { data, count }
 * @param {string} [context=''] - Identifiant pour les logs
 * @returns {Promise<{ data: any, count: number, error: Error|null }>}
 */
export async function withErrorHandlingCount(fn, context = '') {
  try {
    const result = await fn();
    return { data: result.data, count: result.count, error: null };
  } catch (error) {
    if (context) {
      console.error(`[${context}]`, error);
    }
    return { data: null, count: 0, error };
  }
}

/**
 * Déballe une réponse de service `{ data, error }` pour une `mutationFn` React Query :
 * résout avec `data` (ou null) et REJETTE avec `error` — contrat unique des hooks
 * de mutation (`mutateAsync` rejette sur refus, l'appelant fait try/catch + toast).
 *
 * Les services ne throw jamais (withErrorHandling) : sans ce déballage, `mutateAsync`
 * résout même quand la base a refusé (RLS, 23503, RPC qui RAISE…) et un appelant en
 * try/catch affiche un toast de succès mensonger (vécu 2026-09-17 : DELETE 409 sur un
 * équipement → « Équipement supprimé » ; `org_admin_required` → « Client supprimé »).
 * Accepte aussi `{ error }` seul (deletes) → résout avec null.
 *
 * @param {Promise<{ data?: any, error?: any }>|{ data?: any, error?: any }} promise
 * @returns {Promise<any>} `data` de la réponse, ou null
 *
 * @example
 * const deleteMutation = useMutation({
 *   mutationFn: (id) => unwrapResult(clientsService.deleteEquipment(id)),
 * });
 */
export async function unwrapResult(promise) {
  const r = await promise;
  if (r?.error) throw r.error;
  return r?.data ?? null;
}

/**
 * Extraire le premier résultat d'un appel RPC retournant SETOF.
 * Les RPC Supabase avec SETOF retournent un array, pas un objet.
 *
 * @param {Array|Object} data - Résultat de l'appel RPC
 * @returns {Object|null} Premier élément si array, sinon l'objet lui-même
 */
export function extractRpcResult(data) {
  if (!data) return null;
  return Array.isArray(data) ? data[0] || null : data;
}

// ============================================================================
// ORG ID MAPPING (core → majordhome)
// ============================================================================

let orgIdCache = {};

/**
 * Résout core.organizations.id → majordhome.organizations.id
 * Cache en mémoire pour éviter les requêtes répétées.
 *
 * @param {string} coreOrgId - UUID de core.organizations
 * @returns {Promise<string>} UUID de majordhome.organizations
 * @throws {Error} Si l'organisation majordhome n'est pas trouvée
 */
export async function getMajordhomeOrgId(coreOrgId) {
  if (!coreOrgId) throw new Error('[serviceHelpers] coreOrgId requis');

  if (orgIdCache[coreOrgId]) return orgIdCache[coreOrgId];

  const { data, error } = await supabase
    .from('majordhome_organizations')
    .select('id')
    .eq('core_org_id', coreOrgId)
    .single();

  if (error || !data) {
    console.error('[serviceHelpers] Impossible de résoudre org_id:', error);
    throw new Error('Organisation majordhome introuvable pour cet org_id');
  }

  orgIdCache[coreOrgId] = data.id;
  return data.id;
}

/**
 * Vide le cache org_id (utile en test ou après changement d'org)
 */
export function clearOrgIdCache() {
  orgIdCache = {};
}
