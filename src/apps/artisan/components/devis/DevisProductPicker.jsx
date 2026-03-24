/**
 * DevisProductPicker.jsx — Sélecteur produit guidé
 * ============================================================================
 * Parcours : Fournisseur → Gamme → Diamètre → Liste filtrée → Quantités
 * L'utilisateur choisit les quantités et valide pour ajouter les lignes au devis.
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';

import { useSuppliers } from '@hooks/useSuppliers';
import { suppliersService } from '@services/suppliers.service';
import { formatEuro } from '@/lib/utils';
import {
  Package, ChevronRight, ChevronLeft, Check, X,
  Loader2, Search, Minus, Plus, ShoppingCart,
} from 'lucide-react';

export default function DevisProductPicker({ orgId, category, onAddLines, onClose }) {
  const { suppliers: allSuppliers } = useSuppliers(orgId);

  // État du parcours
  const [step, setStep] = useState('supplier'); // supplier | gamme | diametre | products
  const [filteredSuppliers, setFilteredSuppliers] = useState([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [gammes, setGammes] = useState([]);
  const [selectedGamme, setSelectedGamme] = useState(null);
  const [diametres, setDiametres] = useState([]);
  const [selectedDiametre, setSelectedDiametre] = useState(null);
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({}); // { productId: qty }
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Charger les fournisseurs filtrés par catégorie
  useEffect(() => {
    if (category && orgId) {
      setLoadingSuppliers(true);
      suppliersService.getSuppliersByCategory(orgId, category).then(({ data }) => {
        setFilteredSuppliers(data || []);
        setLoadingSuppliers(false);
      });
    } else {
      setFilteredSuppliers(allSuppliers);
    }
  }, [category, orgId, allSuppliers]);

  const suppliers = filteredSuppliers;

  // Charger gammes quand fournisseur sélectionné
  const loadGammes = useCallback(async (supplier) => {
    setSelectedSupplier(supplier);
    setLoading(true);
    const { data } = await suppliersService.getDistinctGammes(supplier.id, category);
    setGammes(data || []);
    setLoading(false);
    setStep('gamme');
  }, [category]);

  // Charger diamètres quand gamme sélectionnée
  const loadDiametres = useCallback(async (gamme) => {
    setSelectedGamme(gamme);
    setLoading(true);
    const { data } = await suppliersService.getDistinctDiametres(selectedSupplier.id, gamme, category);
    setDiametres(data || []);
    setLoading(false);
    // Si pas de diamètres, aller directement aux produits
    if (!data || data.length === 0) {
      loadProducts(gamme, null);
    } else {
      setStep('diametre');
    }
  }, [selectedSupplier, category]);

  // Charger produits filtrés
  const loadProducts = useCallback(async (gamme, diametre) => {
    if (diametre !== undefined) setSelectedDiametre(diametre);
    setLoading(true);
    const { data } = await suppliersService.getFilteredProducts(
      selectedSupplier.id,
      { gamme: gamme || selectedGamme, diametre: diametre, category }
    );
    setProducts(data || []);
    setQuantities({});
    setLoading(false);
    setStep('products');
  }, [selectedSupplier, selectedGamme]);

  // Gestion quantités
  const setQty = (productId, qty) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[productId];
      } else {
        next[productId] = qty;
      }
      return next;
    });
  };

  const totalSelected = Object.values(quantities).reduce((sum, q) => sum + q, 0);

  // Valider et ajouter les lignes
  const handleConfirm = () => {
    const lines = products
      .filter((p) => quantities[p.id] > 0)
      .map((p) => ({
        line_type: 'product',
        supplier_product_id: p.id,
        supplier_id: p.supplier_id,
        supplier_name: selectedSupplier.name,
        designation: p.name,
        description: p.description || '',
        reference: p.reference || '',
        quantity: quantities[p.id],
        unit: p.unit || 'pièce',
        purchase_price_ht: p.purchase_price_ht,
        unit_price_ht: p.selling_price_ht,
        tva_rate: p.default_tva_rate || 5.5,
      }));

    if (lines.length > 0) {
      // Ajouter un titre de section avec le nom de la gamme
      const sectionTitle = [selectedGamme, selectedDiametre ? `Ø${selectedDiametre}` : null]
        .filter(Boolean).join(' — ');

      onAddLines(lines, sectionTitle);
    }
    onClose();
  };

  // Retour arrière
  const goBack = () => {
    if (step === 'products') {
      if (diametres.length > 0) {
        setStep('diametre');
      } else {
        setStep('gamme');
      }
    } else if (step === 'diametre') {
      setStep('gamme');
    } else if (step === 'gamme') {
      setStep('supplier');
      setSelectedSupplier(null);
    }
    setSearchFilter('');
  };

  // Filtrage texte local sur les produits affichés
  const filteredProducts = searchFilter
    ? products.filter((p) =>
        p.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (p.reference && p.reference.toLowerCase().includes(searchFilter.toLowerCase()))
      )
    : products;

  // Breadcrumb
  const breadcrumb = [
    selectedSupplier?.name,
    selectedGamme,
    selectedDiametre ? `Ø${selectedDiametre}` : null,
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            {step !== 'supplier' && (
              <button onClick={goBack} className="p-1 hover:bg-secondary-100 rounded">
                <ChevronLeft className="w-5 h-5 text-secondary-500" />
              </button>
            )}
            <div>
              <h3 className="text-base font-semibold text-secondary-900">Ajouter des produits</h3>
              {breadcrumb.length > 0 && (
                <p className="text-xs text-secondary-400">{breadcrumb.join(' › ')}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {(loading || loadingSuppliers) ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
            </div>
          ) : step === 'supplier' ? (
            /* ── Étape 1 : Choix fournisseur ── */
            <div className="space-y-2">
              {category && (
                <p className="text-xs text-secondary-400 mb-1">Catégorie : <span className="font-medium">{category}</span></p>
              )}
              <p className="text-sm text-secondary-500 mb-3">Choisissez un fournisseur</p>
              {suppliers.length === 0 && (
                <p className="text-sm text-secondary-400 text-center py-6">
                  Aucun fournisseur n'a de produits dans cette catégorie
                </p>
              )}
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadGammes(s)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-secondary-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
                >
                  <span className="font-medium text-secondary-900">{s.name}</span>
                  <ChevronRight className="w-4 h-4 text-secondary-400" />
                </button>
              ))}
            </div>
          ) : step === 'gamme' ? (
            /* ── Étape 2 : Choix gamme ── */
            <div className="space-y-2">
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Rechercher une gamme..."
                  className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  autoFocus
                />
              </div>
              {gammes
                .filter((g) => !searchFilter || g.toLowerCase().includes(searchFilter.toLowerCase()))
                .map((g) => (
                <button
                  key={g}
                  onClick={() => { setSearchFilter(''); loadDiametres(g); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-secondary-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
                >
                  <span className="text-sm font-medium text-secondary-900">{g}</span>
                  <ChevronRight className="w-4 h-4 text-secondary-400" />
                </button>
              ))}
            </div>
          ) : step === 'diametre' ? (
            /* ── Étape 3 : Choix diamètre ── */
            <div className="space-y-2">
              {diametres.length > 8 && (
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Rechercher un diamètre..."
                    className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              )}
              <button
                onClick={() => { setSearchFilter(''); loadProducts(selectedGamme, null); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-secondary-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
              >
                <span className="text-sm text-secondary-600">Tous les diamètres</span>
                <ChevronRight className="w-4 h-4 text-secondary-400" />
              </button>
              {diametres
                .filter((d) => !searchFilter || d.includes(searchFilter))
                .map((d) => (
                <button
                  key={d}
                  onClick={() => { setSearchFilter(''); loadProducts(selectedGamme, d); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-secondary-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
                >
                  <span className="text-sm font-medium text-secondary-900">Ø {d}</span>
                  <ChevronRight className="w-4 h-4 text-secondary-400" />
                </button>
              ))}
            </div>
          ) : (
            /* ── Étape 4 : Liste produits avec quantités ── */
            <div className="space-y-3">
              {/* Recherche locale */}
              {products.length > 10 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filtrer..."
                    className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              )}

              <p className="text-xs text-secondary-400">{filteredProducts.length} produit{filteredProducts.length !== 1 ? 's' : ''}</p>

              {filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-secondary-400">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Aucun produit trouvé</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredProducts.map((product) => {
                    const qty = quantities[product.id] || 0;
                    return (
                      <div
                        key={product.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                          qty > 0
                            ? 'border-primary-300 bg-primary-50/50'
                            : 'border-secondary-100 hover:border-secondary-200'
                        }`}
                      >
                        {/* Info produit */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-secondary-900 truncate">{product.name}</p>
                          <p className="text-xs text-secondary-400 truncate">
                            {[product.reference, product.diametre ? `Ø${product.diametre}` : null].filter(Boolean).join(' · ')}
                          </p>
                        </div>

                        {/* Prix */}
                        <span className="text-sm font-medium text-secondary-700 w-20 text-right flex-shrink-0">
                          {formatEuro(product.selling_price_ht)}
                        </span>

                        {/* Quantité */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setQty(product.id, qty - 1)}
                            disabled={qty === 0}
                            className="w-7 h-7 flex items-center justify-center rounded border border-secondary-300 hover:bg-secondary-100 disabled:opacity-30 disabled:cursor-default"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            value={qty || ''}
                            onChange={(e) => setQty(product.id, parseInt(e.target.value) || 0)}
                            className="w-12 text-center text-sm border border-secondary-300 rounded py-1"
                            min="0"
                            placeholder="0"
                          />
                          <button
                            type="button"
                            onClick={() => setQty(product.id, qty + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-secondary-300 hover:bg-secondary-100"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'products' && (
          <div className="flex items-center justify-between px-5 py-3 border-t bg-white">
            <p className="text-sm text-secondary-500">
              {totalSelected > 0
                ? `${totalSelected} article${totalSelected > 1 ? 's' : ''} sélectionné${totalSelected > 1 ? 's' : ''}`
                : 'Sélectionnez des quantités'}
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={totalSelected === 0}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              <ShoppingCart className="w-4 h-4 mr-1" />
              Ajouter au devis
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
