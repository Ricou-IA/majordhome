/**
 * pennylaneQuotes.service.js — lecture de la table jumelle des devis Pennylane
 * ============================================================================
 * Projection alimentée par l'edge function pennylane-quotes-sweep. Lecture
 * seule : on n'écrit JAMAIS dans cette table depuis Majord'home, sinon elle
 * diverge de Pennylane en silence.
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const VIEW = 'majordhome_pennylane_quotes';

export const pennylaneQuotesService = {
  /**
   * Tous les devis matérialisés de l'org, sur tout l'historique, plus leurs
   * rattachements et leurs écartements — c'est-à-dire tout ce que
   * `buildExplorerRows` attend en entrée.
   * Le filtrage métier (seuil, statuts, vues) reste dans le module pur
   * src/lib/quotesExplorer.js — ce service ne fait que de l'I/O.
   *
   * @param {string} orgId
   * @returns {Promise<{ data: { rows: Array, linkByQuoteId: Map, dismissedIds: Set, syncedAt: string|null }, error: Error|null }>}
   */
  async getAll(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) {
        return { rows: [], linkByQuoteId: new Map(), dismissedIds: new Set(), syncedAt: null };
      }

      // Devis vivants uniquement : `missing_since` non nul = disparu du dernier
      // balayage Pennylane, donc plus une opportunité à traiter.
      const { data, error } = await supabase
        .from(VIEW)
        .select('pennylane_quote_id, quote_number, label, status, quote_date, deadline, amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject, synced_at')
        .eq('org_id', orgId)
        .is('missing_since', null)
        .order('quote_date', { ascending: false });

      if (error) throw error;

      // Rattachements actifs. ⚠️ `throw` obligatoire sur l'erreur : un SELECT
      // avalé ferait apparaître TOUS les devis comme orphelins, donc une
      // campagne de rattachement sur des devis déjà rattachés.
      const { data: links, error: linksError } = await supabase
        .from('majordhome_lead_pennylane_quotes')
        .select('pennylane_quote_id, lead_id')
        .eq('org_id', orgId)
        .is('ejected_at', null);
      if (linksError) throw linksError;

      const linkByQuoteId = new Map();
      for (const l of links || []) {
        linkByQuoteId.set(Number(l.pennylane_quote_id), { lead_id: l.lead_id, lead_name: null });
      }

      // Noms des leads rattachés (1 requête, pas N)
      const leadIds = [...new Set([...linkByQuoteId.values()].map(v => v.lead_id).filter(Boolean))];
      if (leadIds.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from('majordhome_leads')
          .select('id, first_name, last_name')
          .in('id', leadIds);
        if (leadsError) throw leadsError;

        const nameById = new Map(
          (leads || []).map(l => [l.id, [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || null]),
        );
        for (const v of linkByQuoteId.values()) {
          v.lead_name = nameById.get(v.lead_id) || null;
        }
      }

      // Écartements
      const { data: dismissals, error: dismissalsError } = await supabase
        .from('majordhome_pennylane_quote_dismissals')
        .select('pennylane_quote_id')
        .eq('org_id', orgId);
      if (dismissalsError) throw dismissalsError;

      const dismissedIds = new Set((dismissals || []).map(d => Number(d.pennylane_quote_id)));

      // ⚠️ `quote_date` (colonne de la vue) → `date` : c'est le nom que
      // `buildExplorerRows` lit pour sa fenêtre et son tri. Un oubli ici ferait
      // disparaître toutes les lignes en silence.
      const rows = (data || []).map(r => ({
        id: Number(r.pennylane_quote_id),
        quote_number: r.quote_number,
        label: r.label,
        subject: r.pdf_invoice_subject,
        date: r.quote_date,
        deadline: r.deadline,
        amount_ht: r.amount_ht,
        amount_ttc: r.amount_ttc,
        status: r.status,
        pdf_url: r.pdf_url,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
      }));

      // Fraîcheur de la projection : la page DOIT l'afficher (cf. spec §9).
      // Sans elle, un balayage arrêté fait afficher des données périmées avec
      // assurance — « aucun nouveau devis » là où il faudrait lire « je ne sais
      // plus ».
      const syncedAt = (data || []).reduce(
        (max, r) => (!max || r.synced_at > max ? r.synced_at : max),
        null,
      );

      return { rows, linkByQuoteId, dismissedIds, syncedAt };
    }, 'pennylaneQuotes.getAll');
  },
};

export default pennylaneQuotesService;
