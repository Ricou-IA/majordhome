// src/apps/artisan/pages/settings/catalogue/ArticleAttachModal.jsx
// « Rattacher une ligne fournisseur » à un article Majord'home : recherche dans les lignes fournisseur de l'org
// (libellé / référence), puis RPC catalog_item_attach (org_admin). La ligne quitte son article précédent.
import { useEffect, useState } from 'react';
import { Search, X, Loader2, Link2 } from 'lucide-react';
import { suppliersService } from '@services/suppliers.service';
import { useDebounce } from '@hooks/useDebounce';
import { formatEuro } from '@/lib/utils';

/**
 * @param {{ orgId: string, item: any, onClose: () => void, onAttach: (productId: string) => Promise<void>, attaching?: boolean }} p
 */
export default function ArticleAttachModal({ orgId, item, onClose, onAttach, attaching = false }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!debounced || debounced.trim().length < 2) { setResults([]); return undefined; }
    setLoading(true);
    suppliersService.searchProducts(orgId, debounced.trim()).then(({ data }) => {
      if (!cancelled) { setResults((data || []).filter((p) => p.catalog_item_id !== item.id)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [debounced, orgId, item.id]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-secondary-900">Rattacher une ligne fournisseur</h3>
            <p className="text-xs text-secondary-400 truncate">à « {item.name} »</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>
        <div className="px-5 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Libellé ou référence fournisseur…"
              className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {loading && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>}
          {!loading && debounced.trim().length >= 2 && results.length === 0 && <p className="text-sm text-secondary-400 text-center py-6">Aucune ligne fournisseur trouvée</p>}
          {!loading && results.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-secondary-100 hover:border-secondary-200">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-secondary-900 truncate">{p.name}</p>
                <p className="text-xs text-secondary-400 truncate">{[p.supplier_name, p.reference, p.brand].filter(Boolean).join(' · ')}{p.catalog_item_id ? ' · déjà rattachée à un autre article' : ''}</p>
              </div>
              <span className="text-xs text-secondary-600 whitespace-nowrap">{p.purchase_price_ht > 0 ? formatEuro(p.purchase_price_ht) : '—'}</span>
              <button type="button" onClick={() => onAttach(p.id)} disabled={attaching} className="btn-secondary btn-sm">
                {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1" />} Rattacher
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
