// src/apps/artisan/pages/settings/catalogue/ArticleStockModal.jsx
// « Article de stock depuis mes achats » : un article Mayer « par type » (« Disjoncteur 1P+N 16 A courbe C ») dont les
// offres sont les lignes déjà achetées chez Soditelem, Tereva… cochées ici (décision d'Eric, 2026-10-25 : « ce sont des
// articles que j'ai déjà achetés, je vais les reprendre depuis la liste » ; 4 marques de disjoncteur ⇒ un seul type,
// la marque se choisit dans le devis). Création (org_admin) puis rattachement de chaque ligne cochée.
import { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, Check, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { suppliersService, PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { useCatalogItemMutations } from '@hooks/useCatalogItems';
import { useDebounce } from '@hooks/useDebounce';
import { formatEuro } from '@/lib/utils';

const INPUT = 'w-full px-2.5 py-1.5 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

/**
 * @param {{ orgId: string, onClose: () => void, onCreated?: (itemId: string) => void }} p
 */
export default function ArticleStockModal({ orgId, onClose, onCreated }) {
  const { createItem, attach, isCreating, isLinking } = useCatalogItemMutations(orgId);
  const [form, setForm] = useState({ name: '', unit: 'pièce', sellingPriceHt: '', category: '' });
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [coches, setCoches] = useState({}); // productId → ligne
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) { setResults([]); return undefined; }
    setLoading(true);
    suppliersService.searchProductsMots(orgId, debounced.trim()).then(({ data }) => {
      if (!cancelled) { setResults(data || []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [debounced, orgId]);

  const selection = useMemo(() => Object.values(coches), [coches]);
  const marques = useMemo(() => [...new Set(selection.map((p) => p.brand).filter(Boolean))], [selection]);
  const basculer = (p) => setCoches((c) => { const n = { ...c }; if (n[p.id]) delete n[p.id]; else n[p.id] = p; return n; });

  const creer = async () => {
    if (!form.name.trim()) { toast.error('Donnez un nom au type d’article'); return; }
    if (!selection.length) { toast.error('Cochez au moins une ligne d’achat'); return; }
    try {
      const item = await createItem({ ...form, productKind: 'stock', category: form.category || null });
      let ok = 0;
      for (const p of selection) {
        try { await attach(p.id, item.id); ok += 1; } catch (err) { toast.error(`${p.name} : ${err?.message || 'rattachement refusé'}`); }
      }
      toast.success(`Article de stock créé avec ${ok} offre${ok > 1 ? 's' : ''}${marques.length > 1 ? ` (${marques.length} marques au choix dans le devis)` : ''}`);
      onCreated?.(item.id);
      onClose();
    } catch (err) { toast.error(err?.message || 'Création refusée'); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-secondary-900 flex items-center gap-2"><Layers className="w-4 h-4" /> Article de stock depuis mes achats</h3>
            <p className="text-xs text-secondary-400">Un type d&apos;article, plusieurs références achetées : la marque se choisit dans le devis.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="px-5 py-3 border-b grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Type d’article (ex. Disjoncteur 1P+N 16 A courbe C) *" className={`${INPUT} sm:col-span-2`} />
          <select value={form.unit} onChange={(e) => set('unit', e.target.value)} className={INPUT} aria-label="Unité">
            {PRODUCT_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <input type="number" min="0" step="0.01" value={form.sellingPriceHt} onChange={(e) => set('sellingPriceHt', e.target.value)} placeholder="Prix de vente HT" className={INPUT} />
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className={`${INPUT} sm:col-span-2`} aria-label="Catégorie">
            <option value="">Sans catégorie (proposé dans tous les devis)</option>
            {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="px-5 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher dans les lignes achetées : mots du libellé, référence, marque…"
              className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          {selection.length > 0 && (
            <p className="text-xs text-secondary-600 mt-2">{selection.length} ligne{selection.length > 1 ? 's' : ''} cochée{selection.length > 1 ? 's' : ''}{marques.length ? ` · marques : ${marques.join(', ')}` : ''}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {loading && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>}
          {!loading && debounced.trim().length >= 2 && results.length === 0 && <p className="text-sm text-secondary-400 text-center py-6">Aucune ligne achetée ne correspond</p>}
          {!loading && results.map((p) => {
            const coche = !!coches[p.id];
            return (
              <button key={p.id} type="button" onClick={() => basculer(p)} className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border ${coche ? 'border-primary-300 bg-primary-50/50' : 'border-secondary-100 hover:border-secondary-200'}`}>
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${coche ? 'bg-primary-600 border-primary-600' : 'border-secondary-300'}`}>{coche && <Check className="w-3 h-3 text-white" />}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-secondary-900 break-words">{p.name}</p>
                  <p className="text-xs text-secondary-400 break-words">{[p.supplier_name, p.reference, p.brand].filter(Boolean).join(' · ')}{p.catalog_item_id ? ' · quittera son article actuel' : ''}</p>
                </div>
                <span className="text-xs text-secondary-600 whitespace-nowrap">{p.purchase_price_ht > 0 ? formatEuro(p.purchase_price_ht) : '—'}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
          <button type="button" onClick={creer} disabled={isCreating || isLinking} className="btn-primary btn-sm">
            {(isCreating || isLinking) && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />} Créer l&apos;article de stock
          </button>
        </div>
      </div>
    </div>
  );
}
