// src/apps/artisan/pages/settings/catalogue/ArticleAttachModal.jsx
// « Rattacher une ligne fournisseur » à un article Majord'home : des SUGGESTIONS d'abord (décision d'Eric, 2026-10-25 :
// « l'outil devrait proposer une ou des correspondances »), classées par le module pur suggestions.js (même marque,
// référence fabricant identique ou à un suffixe près, libellé proche, prix du même ordre) avec leurs raisons ; la
// recherche libre dessous. RPC catalog_item_attach (org_admin) : la ligne quitte son article précédent.
import { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, Link2, Sparkles } from 'lucide-react';
import { suppliersService } from '@services/suppliers.service';
import { useDebounce } from '@hooks/useDebounce';
import { formatEuro } from '@/lib/utils';
import { suggestions as classer } from '@/lib/catalogue/suggestions.js';

/** Mots servant à chercher des candidats : la marque, sinon les deux premiers mots significatifs du libellé. */
function requeteCandidats(item) {
  if (item.brand) return item.brand;
  return String(item.name || '').split(/\s+/).filter((m) => m.length >= 4).slice(0, 2).join(' ');
}

function LigneCandidate({ p, raisons, onAttach, attaching }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-secondary-100 hover:border-secondary-200">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-secondary-900 break-words">{p.name}</p>
        <p className="text-xs text-secondary-400 break-words">
          {[p.supplier_name, p.reference, p.brand].filter(Boolean).join(' · ')}
          {p.catalog_item_id && <span className="text-amber-700"> · déjà rattachée à un autre article (elle le quittera)</span>}
        </p>
        {raisons?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {raisons.map((r) => <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700">{r}</span>)}
          </div>
        )}
      </div>
      <span className="text-xs text-secondary-600 whitespace-nowrap">{p.purchase_price_ht > 0 ? formatEuro(p.purchase_price_ht) : '—'}</span>
      <button type="button" onClick={() => onAttach(p.id)} disabled={attaching} className="btn-secondary btn-sm">
        {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1" />} Rattacher
      </button>
    </div>
  );
}

/**
 * @param {{ orgId: string, item: any, offers?: Array<{ reference?: string, product_id: string }>, onClose: () => void,
 *   onAttach: (productId: string) => Promise<void>, attaching?: boolean }} p
 */
export default function ArticleAttachModal({ orgId, item, offers = [], onClose, onAttach, attaching = false }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [chargementSugg, setChargementSugg] = useState(true);

  // candidats des suggestions : lignes de la même marque (ou du même libellé), une fois à l'ouverture
  useEffect(() => {
    let cancelled = false;
    const q = requeteCandidats(item);
    if (!q) { setChargementSugg(false); return undefined; }
    suppliersService.searchProductsMots(orgId, q, { limit: 300 }).then(({ data }) => {
      if (!cancelled) { setCandidats(data || []); setChargementSugg(false); }
    });
    return () => { cancelled = true; };
  }, [orgId, item]);

  const idsOffres = useMemo(() => new Set(offers.map((o) => o.product_id)), [offers]);
  const sugg = useMemo(() => classer(
    { id: item.id, name: item.name, brand: item.brand, model_key: item.model_key, references: offers.map((o) => o.reference).filter(Boolean), prix: item.meilleur_prix_achat },
    candidats.filter((p) => !idsOffres.has(p.id)),
    { max: 8 },
  ), [item, offers, candidats, idsOffres]);

  useEffect(() => {
    let cancelled = false;
    if (!debounced || debounced.trim().length < 2) { setResults([]); return undefined; }
    setLoading(true);
    suppliersService.searchProductsMots(orgId, debounced.trim()).then(({ data }) => {
      if (!cancelled) { setResults((data || []).filter((p) => p.catalog_item_id !== item.id)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [debounced, orgId, item.id]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-secondary-900">Rattacher une ligne fournisseur</h3>
            <p className="text-xs text-secondary-400 break-words">à « {item.name} »</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Correspondances proposées</h4>
            {chargementSugg ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-primary-600" /></div>
            ) : sugg.length === 0 ? (
              <p className="text-xs text-secondary-400">Aucune correspondance évidente : cherchez ci-dessous.</p>
            ) : (
              sugg.map((s) => <LigneCandidate key={s.ligne.id} p={s.ligne} raisons={s.raisons} onAttach={onAttach} attaching={attaching} />)
            )}
          </section>
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Recherche</h4>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Mots du libellé, référence, marque…"
                className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>}
            {!loading && debounced.trim().length >= 2 && results.length === 0 && <p className="text-sm text-secondary-400 text-center py-4">Aucune ligne fournisseur trouvée</p>}
            {!loading && results.map((p) => <LigneCandidate key={p.id} p={p} onAttach={onAttach} attaching={attaching} />)}
          </section>
        </div>
      </div>
    </div>
  );
}
