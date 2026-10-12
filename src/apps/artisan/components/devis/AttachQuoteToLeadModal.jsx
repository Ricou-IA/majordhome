/**
 * AttachQuoteToLeadModal.jsx — rattache un ou plusieurs devis PL orphelins à un
 * lead existant. Réutilise useAttachQuotesAndSend (RPC lead_attach_quotes_and_send,
 * forward-only), qui accepte nativement une liste.
 *
 * Multi-devis (2026-09-16) : la sélection de l'explorateur arrive en `quotes[]`
 * (variantes d'un même client, à rattacher d'un coup). `quote` (singulier) reste
 * accepté pour l'usage unitaire depuis une carte.
 *
 * Recherche (2026-10-12, incident ROZIÈRES) : RPC `lead_search_for_attach`
 * (SECURITY INVOKER, `unaccent`) et non plus un `ILIKE` PostgREST — Pennylane
 * envoie « FRANCOIS ROZIERES » sans accent, la carte est stockée « FRANÇOIS
 * ROZIÈRES » : un ILIKE ne la trouvait pas et la modale affirmait à tort qu'aucun
 * lead n'existait. La RPC tokenise la saisie côté base (chaque mot, sans accent ni
 * casse), classe par nombre de mots matchés, et place EN TÊTE le lead du client
 * Majord'home ponté au client Pennylane du devis (`pennylane_sync`) — l'axe
 * déterministe, le même que le cron `upsert_pennylane_lead`.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Search, Link2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { useDebounce } from '@hooks/useDebounce';
import { pennylaneService } from '@services/pennylane.service';
import { toAttachPayload } from '@/lib/quotesExplorer';
import { formatEuro } from '@/lib/utils';

/** Bouton monté une fois le lead choisi → leadId stable pour le hook. */
function AttachButton({ orgId, leadId, quotes, onDone }) {
  const { attachQuotes, isAttaching } = useAttachQuotesAndSend(orgId, leadId);
  const n = quotes.length;

  const handleAttach = async () => {
    try {
      await attachQuotes(quotes.map(toAttachPayload));
      toast.success(n > 1 ? `${n} devis rattachés au lead` : 'Devis rattaché au lead');
      onDone();
    } catch (e) {
      toast.error(`Rattachement impossible : ${e?.message || e}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleAttach}
      disabled={isAttaching}
      className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
    >
      <Link2 className="w-4 h-4" />
      {isAttaching ? 'Rattachement...' : (n > 1 ? `Rattacher ${n} devis` : 'Rattacher')}
    </button>
  );
}

export function AttachQuoteToLeadModal({ quote = null, quotes = null, onClose, onAttached }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const list = quotes?.length ? quotes : (quote ? [quote] : []);
  const first = list[0] || {};
  const n = list.length;
  const totalHt = list.reduce((s, q) => s + (Number(q.amount_ht) || 0), 0);
  const customerId = first.customer_id || null;

  const [query, setQuery] = useState(first.customer_name || '');
  const [selected, setSelected] = useState(null);
  const debounced = useDebounce(query, 300);
  const term = debounced.trim();
  const hasTerm = term.length >= 2;

  // Client Majord'home ponté au client Pennylane du devis (null si jamais ponté).
  // `undefined` = résolution en cours : on attend avant de chercher, sinon la
  // première liste s'affiche sans le lead du client et se réordonne sous la souris.
  const { data: bridgedClientId, isFetched: bridgeResolved } = useQuery({
    queryKey: ['devis-attach-bridge-client', orgId, customerId],
    queryFn: async () => {
      const { data, error } = await pennylaneService.getClientIdForCustomer(orgId, customerId);
      if (error) throw error;
      return data || null;
    },
    enabled: !!orgId && !!customerId,
  });
  const clientId = customerId ? (bridgedClientId ?? null) : null;
  const canSearch = !!orgId && (!customerId || bridgeResolved) && (hasTerm || !!clientId);

  const { data: leads = [], isFetching } = useQuery({
    queryKey: ['devis-attach-lead-search', orgId, term, clientId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('lead_search_for_attach', {
        p_org_id: orgId,
        p_term: hasTerm ? term : null,
        p_client_id: clientId,
        p_limit: 20,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: canSearch,
  });

  if (n === 0) return null;

  const subtitle = n > 1
    ? `${first.customer_name || 'Client inconnu'} · ${n} devis · ${formatEuro(totalHt)}`
    : `${first.quote_number || `#${first.id}`} · ${first.customer_name || 'Client inconnu'} · ${formatEuro(first.amount_ht)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-secondary-200">
          <div>
            <h2 className="font-semibold text-secondary-900">
              {n > 1 ? `Rattacher ${n} devis` : 'Rattacher le devis'}
            </h2>
            <p className="text-sm text-secondary-500">{subtitle}</p>
            {n > 1 && (
              <p className="text-xs text-secondary-400 mt-0.5 truncate">
                {list.map((q) => q.quote_number || `#${q.id}`).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary-100">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <div className="p-4 border-b border-secondary-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Rechercher un lead (nom, prénom)..."
              className="w-full pl-9 pr-3 py-2 border border-secondary-200 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isFetching && <p className="text-sm text-gray-400 p-3">Recherche...</p>}
          {/* Gaté sur `canSearch` : ne jamais annoncer « aucun lead » quand aucune
              requête n'a été lancée. */}
          {!isFetching && canSearch && leads.length === 0 && (
            <p className="text-sm text-gray-400 p-3">
              Aucun lead trouvé. Utilise « Créer le lead » depuis la carte.
            </p>
          )}
          {leads.map((lead) => {
            const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
            const isSel = selected?.id === lead.id;
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelected(lead)}
                className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                  isSel ? 'bg-primary-50 border border-primary-200' : 'hover:bg-secondary-50 border border-transparent'
                }`}
              >
                <p className="text-sm font-medium text-secondary-900 flex items-center gap-2">
                  <span>{name || 'Sans nom'}</span>
                  {lead.client_match && (
                    <span
                      className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-medium"
                      title="Lead du client Majord'home déjà ponté à ce client Pennylane"
                    >
                      Client Pennylane
                    </span>
                  )}
                </p>
                <p className="text-xs text-secondary-500">
                  {[lead.city, lead.status_label].filter(Boolean).join(' · ')}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-secondary-200">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          {selected && (
            <AttachButton
              orgId={orgId}
              leadId={selected.id}
              quotes={list}
              onDone={onAttached}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AttachQuoteToLeadModal;
