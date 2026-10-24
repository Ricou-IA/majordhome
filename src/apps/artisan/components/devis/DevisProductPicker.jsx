/**
 * DevisProductPicker.jsx — Ajouter des articles Majord'home à un devis
 * ============================================================================
 * Recherche dans les articles de l'org (base du devis), filtrée par les catégories de la famille / section, par
 * marque (le discriminant, décision d'Eric) et par gamme ; quantités ; validation → lignes de devis.
 * La ligne reprend libellé, unité, TVA et prix de vente de l'article ; son prix d'achat (marge) = le prix d'achat
 * le plus bas des offres fournisseur (`meilleur_prix_achat`), sans choix de fournisseur : les fournisseurs et leurs
 * références vivent dans la fiche article, pour les bons de commande. Spec articles Majord'home § 9.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { Package, X, Loader2, Search, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useDebounce } from '@hooks/useDebounce';
import { useCatalogItems, useCatalogBrands, useCatalogGammes } from '@hooks/useCatalogItems';
import { formatEuro } from '@/lib/utils';

const LIMITE = 100;

/** `categories` : catégories produit de la famille / section (vide = tous les articles, y compris sans catégorie). */
export default function DevisProductPicker({ orgId, categories = [], onAddLines, onClose }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [brand, setBrand] = useState('');
  const [gamme, setGamme] = useState('');
  const [quantities, setQuantities] = useState({}); // { itemId: qty }

  const filtres = useMemo(() => ({
    search: debounced, categories, brand: brand || null, gamme: gamme || null, avecOffreActive: true, pageSize: LIMITE,
  }), [debounced, categories, brand, gamme]);
  const { items, count, isLoading } = useCatalogItems(orgId, filtres);
  const { brands } = useCatalogBrands(orgId, categories);
  const { gammes } = useCatalogGammes(orgId, categories);

  const setQty = (itemId, qty) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId]; else next[itemId] = qty;
      return next;
    });
  };
  const totalSelected = Object.values(quantities).reduce((s, q) => s + q, 0);

  const handleConfirm = () => {
    const lines = items
      .filter((it) => quantities[it.id] > 0)
      .map((it) => ({
        line_type: 'product',
        catalog_item_id: it.id,
        supplier_product_id: null,
        supplier_id: null,
        supplier_name: null,
        designation: it.name,
        description: it.description || '',
        reference: '',
        quantity: quantities[it.id],
        unit: it.unit || 'pièce',
        // marge estimée : le prix d'achat le plus bas connu chez les fournisseurs de l'article
        purchase_price_ht: it.meilleur_prix_achat != null ? Number(it.meilleur_prix_achat) : null,
        unit_price_ht: Number(it.selling_price_ht) || 0,
        tva_rate: Number(it.default_tva_rate) || 20,
      }));
    if (lines.length > 0) onAddLines(lines, gamme || null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-secondary-900">Ajouter des articles</h3>
            {categories.length > 0 && <p className="text-xs text-secondary-400">Catégorie{categories.length > 1 ? 's' : ''} : {categories.join(', ')}</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        {/* Filtres */}
        <div className="px-5 py-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Libellé, marque, modèle…"
              className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">Toutes les marques ({brands.length})</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={gamme} onChange={(e) => setGamme(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">Toutes les gammes ({gammes.length})</option>
              {gammes.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className="ml-auto self-center text-xs text-secondary-400">
              {count} article{count > 1 ? 's' : ''}{count > LIMITE ? ` · les ${LIMITE} premiers, affinez` : ''}
            </span>
          </div>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-secondary-400">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Aucun article pour ces filtres</p>
              <p className="text-xs mt-1">Les articles naissent des relevés fournisseurs (Paramètres → Fournisseurs → Articles Majord&apos;home).</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((it) => {
                const qty = quantities[it.id] || 0;
                return (
                  <div key={it.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${qty > 0 ? 'border-primary-300 bg-primary-50/50' : 'border-secondary-100 hover:border-secondary-200'}`}>
                    {it.image_url ? <img src={it.image_url} alt="" className="w-9 h-9 object-contain rounded border border-secondary-100 bg-white flex-shrink-0" />
                      : <div className="w-9 h-9 rounded bg-secondary-100 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-secondary-900 truncate">{it.name}</p>
                      <p className="text-xs text-secondary-400 truncate">
                        {[it.brand, it.gamme].filter(Boolean).join(' · ')}
                        {it.fournisseurs?.length ? ` · ${it.fournisseurs.join(', ')}` : ''}
                        {it.meilleur_prix_achat != null ? ` · achat ${formatEuro(it.meilleur_prix_achat)}` : ''}
                      </p>
                    </div>
                    <span className={`text-sm font-medium w-24 text-right flex-shrink-0 ${Number(it.selling_price_ht) > 0 ? 'text-secondary-700' : 'text-amber-600'}`} title={Number(it.selling_price_ht) > 0 ? 'Prix de vente HT' : 'Prix de vente à saisir sur la ligne'}>
                      {Number(it.selling_price_ht) > 0 ? formatEuro(it.selling_price_ht) : 'à chiffrer'}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button type="button" onClick={() => setQty(it.id, qty - 1)} disabled={qty === 0} className="w-7 h-7 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100 disabled:opacity-30">
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input type="number" min="0" value={qty || ''} onChange={(e) => setQty(it.id, parseInt(e.target.value, 10) || 0)} placeholder="0"
                        className="w-12 text-center text-sm border border-secondary-300 rounded py-1 focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      <button type="button" onClick={() => setQty(it.id, qty + 1)} className="w-7 h-7 rounded-full border border-secondary-300 flex items-center justify-center hover:bg-secondary-100">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <span className="text-sm text-secondary-600">{totalSelected > 0 ? `${totalSelected} article${totalSelected > 1 ? 's' : ''} sélectionné${totalSelected > 1 ? 's' : ''}` : 'Aucune sélection'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            <button type="button" onClick={handleConfirm} disabled={totalSelected === 0} className="btn-primary btn-sm">
              <ShoppingCart className="w-4 h-4 mr-1" /> Ajouter au devis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
