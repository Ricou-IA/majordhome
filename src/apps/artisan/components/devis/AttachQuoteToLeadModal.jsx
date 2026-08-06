/**
 * AttachQuoteToLeadModal.jsx — rattache un devis PL orphelin à un lead existant.
 * Réutilise useAttachQuotesAndSend (RPC lead_attach_quotes_and_send, forward-only).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Search, Link2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { useDebounce } from '@hooks/useDebounce';
import { escapePostgrestSearchTerm } from '@/lib/postgrestUtils';
import { formatEuro } from '@/lib/utils';

/**
 * Découpe la saisie en tokens cherchables.
 *
 * POURQUOI tokeniser (ne pas « simplifier » en une clause unique) : les noms
 * sont stockés en DEUX colonnes séparées et majuscules (`first_name`="JEAN",
 * `last_name`="DUPONT"), alors que la recherche est pré-remplie avec le nom
 * COMPLET venu de Pennylane ("Jean Dupont"). Un `ilike.%Jean Dupont%` ne
 * matche donc AUCUNE des deux colonnes → 0 résultat à l'ouverture, ce qui
 * laisse croire à tort qu'aucun lead n'existe.
 *
 * Volontairement large : sur une liste bornée à 20 lignes que l'humain relit
 * avant de cliquer, rappeler trop coûte bien moins cher que ne rien rappeler.
 *
 * L'escape P0.26 s'applique par TOKEN (et non à la chaîne entière) : sinon on
 * réintroduit l'injection de filtre PostgREST que le helper existe pour couvrir.
 * Tokens < 2 caractères ignorés (particules, initiales) — sinon on ramène la
 * moitié de la base.
 */
function buildSearchTokens(raw) {
  return String(raw || '')
    .split(/\s+/)
    .flatMap((t) => escapePostgrestSearchTerm(t).split(' '))
    .filter((t) => t.length >= 2);
}

/** Bouton monté une fois le lead choisi → leadId stable pour le hook. */
function AttachButton({ orgId, leadId, quote, onDone }) {
  const { attachQuotes, isAttaching } = useAttachQuotesAndSend(orgId, leadId);

  const handleAttach = async () => {
    try {
      await attachQuotes([{
        quote_pl_id: quote.id,
        customer_id: quote.customer_id ?? null,
        amount_ht: quote.amount_ht ?? null,
        label: quote.quote_number || quote.label || null,
        date: quote.date || null,
        status: quote.status || null,
        pdf_url: quote.pdf_url || null,
      }]);
      toast.success('Devis rattaché au lead');
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
      {isAttaching ? 'Rattachement...' : 'Rattacher'}
    </button>
  );
}

export function AttachQuoteToLeadModal({ quote, onClose, onAttached }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [query, setQuery] = useState(quote.customer_name || '');
  const [selected, setSelected] = useState(null);
  const debounced = useDebounce(query, 300);
  const tokens = buildSearchTokens(debounced);

  const { data: leads = [], isFetching } = useQuery({
    queryKey: ['devis-attach-lead-search', orgId, debounced],
    queryFn: async () => {
      // Chaque token est testé sur les deux colonnes de nom.
      const orClause = tokens
        .flatMap((t) => [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`])
        .join(',');
      const { data, error } = await supabase
        .from('majordhome_leads')
        .select('id, first_name, last_name, city, status_label, order_amount_ht')
        .eq('org_id', orgId)
        .eq('is_deleted', false)
        .or(orClause)
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && debounced.trim().length >= 2 && tokens.length > 0,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-secondary-200">
          <div>
            <h2 className="font-semibold text-secondary-900">Rattacher le devis</h2>
            <p className="text-sm text-secondary-500">
              {quote.quote_number || `#${quote.id}`} · {quote.customer_name || 'Client inconnu'} · {formatEuro(quote.amount_ht)}
            </p>
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
          {/* Gaté sur `tokens` : ne jamais annoncer « aucun lead » quand aucune
              requête n'a été lancée (même défaut que celui qu'on corrige ici). */}
          {!isFetching && tokens.length > 0 && leads.length === 0 && (
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
                <p className="text-sm font-medium text-secondary-900">{name || 'Sans nom'}</p>
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
              quote={quote}
              onDone={onAttached}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AttachQuoteToLeadModal;
