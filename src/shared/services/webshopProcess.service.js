/**
 * webshopProcess.service.js — Process des commandes boutique (étape 2).
 * Tout changement de statut passe par l'edge `webshop-process` (transition, événement de
 * tournée, rejeu d'une action) : le front n'écrit plus `status` en direct.
 * Le journal des envois se lit dans la vue `majordhome_webshop_order_actions` (lecture seule).
 * Erreur de l'edge : le code métier (`invalid_transition`, `forbidden`, `already_sent`…) est lu
 * dans le corps de la réponse et traduit (`libelleErreurProcess`) ; l'erreur garde `code`.
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { libelleErreurProcess } from '@/lib/webshop/orders';

const CHUNK = 200;
const ACTION_COLUMNS = 'id, order_id, envoi, evenement, action, gabarit, status, error_code, error_message, recipient, slot_id, created_at, updated_at';

/** Erreur lisible depuis un `functions.invoke` non-2xx (corps `{ error, detail? }`). */
async function processError(error) {
  let code = null;
  let detail = null;
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      code = body?.error ?? null;
      detail = body?.detail ?? null;
    }
  } catch {
    /* corps illisible → message générique */
  }
  const err = new Error(code ? libelleErreurProcess(code) : (error?.message || 'Erreur inattendue'));
  err.code = code;
  err.detail = detail;
  return err;
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('webshop-process', { body });
  if (error) throw await processError(error);
  return data;
}

export const webshopProcessService = {
  /** Change la colonne d'une commande. → `{ order, actions }` */
  async transition(orderId, to) {
    return withErrorHandling(async () => {
      if (!orderId || !to) throw new Error('[webshopProcess] orderId et to requis');
      return invoke({ kind: 'transition', order_id: orderId, to });
    }, 'webshopProcess.transition');
  },

  /** Tournée partie / livrée. → `{ slot, orders }` */
  async tourneeEvent(slotId, event) {
    return withErrorHandling(async () => {
      if (!slotId || !event) throw new Error('[webshopProcess] slotId et event requis');
      return invoke({ kind: 'tournee', slot_id: slotId, event });
    }, 'webshopProcess.tourneeEvent');
  },

  /** Rejoue une action du journal. → `{ action }` */
  async retry(actionId) {
    return withErrorHandling(async () => {
      if (!actionId) throw new Error('[webshopProcess] actionId requis');
      return invoke({ kind: 'retry', action_id: actionId });
    }, 'webshopProcess.retry');
  },

  /** Journal des envois des commandes affichées, plus récent d'abord. */
  async getActions(orgId, orderIds) {
    return withErrorHandling(async () => {
      const ids = Array.isArray(orderIds) ? orderIds : [];
      const rows = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('majordhome_webshop_order_actions')
          .select(ACTION_COLUMNS)
          .eq('org_id', orgId)
          .in('order_id', ids.slice(i, i + CHUNK))
          .order('updated_at', { ascending: false });
        if (error) throw error;
        rows.push(...(data || []));
      }
      return rows;
    }, 'webshopProcess.getActions');
  },
};

export default webshopProcessService;
