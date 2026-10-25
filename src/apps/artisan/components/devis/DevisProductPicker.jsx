/**
 * DevisProductPicker.jsx — Ajouter des articles Majord'home à un chapitre de devis
 * ============================================================================
 * Le type du chapitre décide de ce qui est proposé (décisions d'Eric, 2026-10-25) :
 *   Équipement / Option : articles « équipement » ou « accessoire » des catégories de la famille (filtre modifiable) ;
 *   Matériel stocké     : articles de stock « par type » (marque choisie ensuite dans le devis), toutes familles ;
 *   Main d'œuvre        : articles internes de main d'œuvre ;
 *   Libre / Fumisterie  : tout le catalogue (des catégories de la famille / de la fumisterie).
 * Recherche par mots séparés, sans accents, y compris les références fournisseur ; filtres marque et gamme.
 * La ligne reprend libellé, unité et prix de vente de l'article, la TVA du devis ; prix d'achat (marge) = le plus bas
 * des offres. Un admin crée un article manquant sans quitter le devis. Spec articles § 9 + plan 2026-10-25.
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { Package, X, Loader2, Search, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useDebounce } from '@hooks/useDebounce';
import { useCatalogItems, useCatalogBrands, useCatalogGammes } from '@hooks/useCatalogItems';
import { formatEuro } from '@/lib/utils';
import DevisCreateArticleForm from './DevisCreateArticleForm';

const LIMITE = 100;

/** Filtres de nature proposés par type de chapitre ; le premier est le défaut. `categories: false` = ignorer celles de la famille. */
const FILTRES = {
  equipement: [
    { key: 'equipement', label: 'Équipements', natures: ['main'] },
    { key: 'option', label: 'Options', natures: ['accessory', 'consumable'] },
    { key: 'tout', label: 'Tout', natures: [] },
  ],
  option: [
    { key: 'option', label: 'Options', natures: ['accessory', 'consumable'] },
    { key: 'equipement', label: 'Équipements', natures: ['main'] },
    { key: 'tout', label: 'Tout', natures: [] },
  ],
  stock: [
    { key: 'stock', label: 'Matériel stocké', natures: ['stock'], categories: false },
    { key: 'catalogue', label: 'Tout le catalogue', natures: [], categories: false },
  ],
  main_oeuvre: [{ key: 'main_oeuvre', label: 'Main d’œuvre', natures: ['main_oeuvre'], categories: false }],
  libre: [{ key: 'tout', label: 'Tout', natures: [] }],
  fumisterie: [{ key: 'tout', label: 'Tout', natures: [] }],
};
const NATURE_PAR_TYPE = { equipement: 'main', option: 'accessory', stock: 'stock', main_oeuvre: 'main_oeuvre' };

/**
 * @param {{ orgId: string, categories?: string[], typeChapitre?: string, tvaDevis?: number,
 *   onAddLines: (lines: object[]) => void, onClose: () => void }} p
 */
export default function DevisProductPicker({ orgId, categories = [], typeChapitre = 'libre', tvaDevis = 20, onAddLines, onClose }) {
  const { isOrgAdmin } = useAuth();
  const filtres = FILTRES[typeChapitre] || FILTRES.libre;
  const [filtreKey, setFiltreKey] = useState(filtres[0].key);
  const filtre = filtres.find((f) => f.key === filtreKey) || filtres[0];
  const ignorerCategories = filtre.categories === false;
  const cats = useMemo(() => (ignorerCategories ? [] : categories), [ignorerCategories, categories]);

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [brand, setBrand] = useState('');
  const [gamme, setGamme] = useState('');
  const [quantities, setQuantities] = useState({}); // { itemId: qty }
  const [creation, setCreation] = useState(false);

  const criteres = useMemo(() => ({
    search: debounced, categories: cats, natures: filtre.natures, brand: brand || null, gamme: gamme || null, proposable: true, pageSize: LIMITE,
  }), [debounced, cats, filtre.natures, brand, gamme]);
  const { items, count, isLoading } = useCatalogItems(orgId, criteres);
  const { brands } = useCatalogBrands(orgId, cats);
  const { gammes } = useCatalogGammes(orgId, cats);

  const setQty = (itemId, qty) => setQuantities((prev) => {
    const next = { ...prev };
    if (qty <= 0) delete next[itemId]; else next[itemId] = qty;
    return next;
  });
  const totalSelected = Object.values(quantities).reduce((s, q) => s + q, 0);

  const versLigne = (it, quantity) => ({
    line_type: it.product_kind === 'main_oeuvre' ? 'labor' : 'product',
    catalog_item_id: it.id,
    brand: null,
    supplier_product_id: null,
    supplier_id: null,
    supplier_name: null,
    designation: it.name,
    description: it.description || '',
    reference: '',
    quantity,
    unit: it.unit || 'pièce',
    // marge estimée : le prix d'achat le plus bas connu chez les fournisseurs de l'article (null sans offre)
    purchase_price_ht: it.meilleur_prix_achat != null ? Number(it.meilleur_prix_achat) : null,
    unit_price_ht: Number(it.selling_price_ht) || 0,
    tva_rate: Number(tvaDevis),
  });

  const handleConfirm = () => {
    const lines = items.filter((it) => quantities[it.id] > 0).map((it) => versLigne(it, quantities[it.id]));
    if (lines.length > 0) onAddLines(lines);
    onClose();
  };

  const stockVide = filtre.key === 'stock' && !isLoading && count === 0 && !debounced && !brand && !gamme;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col m-4">
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-secondary-900">Ajouter des articles</h3>
            {cats.length > 0 && <p className="text-xs text-secondary-400">Catégorie{cats.length > 1 ? 's' : ''} : {cats.join(', ')}</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        {/* Filtres */}
        <div className="px-5 py-3 border-b space-y-2">
          {filtres.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {filtres.map((f) => (
                <button key={f.key} type="button" onClick={() => { setFiltreKey(f.key); setBrand(''); setGamme(''); }}
                  className={`px-2.5 py-1 text-xs rounded-full border ${f.key === filtre.key ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-secondary-600 border-secondary-300 hover:bg-secondary-50'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mots du libellé, marque, modèle, référence fournisseur…"
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
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {creation && (
            <DevisCreateArticleForm
              orgId={orgId}
              defaultKind={NATURE_PAR_TYPE[typeChapitre] || 'main'}
              defaultCategory={['equipement', 'option'].includes(typeChapitre) ? (categories[0] || null) : null}
              defaultName={search}
              onCreated={(item) => { onAddLines([versLigne(item, 1)]); onClose(); }}
              onCancel={() => setCreation(false)}
            />
          )}
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-secondary-400 space-y-2">
              <Package className="w-8 h-8 mx-auto opacity-40" />
              {stockVide ? (
                <>
                  <p className="text-sm text-secondary-600">Aucun article de matériel stocké pour l&apos;instant.</p>
                  <p className="text-xs">Regroupez vos achats par type dans Paramètres → Fournisseurs → Articles (« Article de stock depuis mes achats »).</p>
                  <button type="button" onClick={() => setFiltreKey('catalogue')} className="btn-secondary btn-sm">Chercher dans tout le catalogue</button>
                </>
              ) : (
                <p className="text-sm">Aucun article pour ces critères</p>
              )}
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
                      <p className="text-sm font-medium text-secondary-900 break-words">{it.name}</p>
                      <p className="text-xs text-secondary-400 break-words">
                        {[it.brand, it.gamme].filter(Boolean).join(' · ')}
                        {it.fournisseurs?.length ? ` · ${it.fournisseurs.join(', ')}` : ''}
                        {it.meilleur_prix_achat != null ? ` · achat ${formatEuro(it.meilleur_prix_achat)}` : ''}
                        {it.product_kind === 'stock' && it.offres_actives > 1 ? ' · marque au choix dans le devis' : ''}
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

        {/* Pied */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary-600">{totalSelected > 0 ? `${totalSelected} article${totalSelected > 1 ? 's' : ''} sélectionné${totalSelected > 1 ? 's' : ''}` : 'Aucune sélection'}</span>
            {isOrgAdmin && !creation && (
              <button type="button" onClick={() => setCreation(true)} className="text-xs text-primary-700 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Créer un article</button>
            )}
          </div>
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
