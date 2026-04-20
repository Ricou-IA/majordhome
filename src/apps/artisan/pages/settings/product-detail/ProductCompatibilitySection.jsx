/**
 * ProductCompatibilitySection.jsx — Gestion bidirectionnelle des compatibilités
 * ============================================================================
 * Éditable depuis les DEUX côtés :
 *  - Sur un ÉQUIPEMENT : liste des accessoires compatibles + ajout/retrait direct
 *    (modifie le compatible_with_ids des accessoires ciblés)
 *  - Sur un ACCESSOIRE : liste des équipements compatibles + ajout/retrait direct
 *    (modifie le compatible_with_ids de ce produit)
 *
 * La source de vérité reste la colonne compatible_with_ids côté accessoire.
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Plus, X, Loader2, Info, Package, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSupplierProducts, useAccessoriesForProduct } from '@hooks/useSuppliers';
import { suppliersService } from '@services/suppliers.service';
import { formatEuro } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { supplierKeys } from '@hooks/cacheKeys';

export default function ProductCompatibilitySection({ product, orgId }) {
  if (!product) return null;

  if (product.product_kind === 'accessory') {
    return <AccessoryView product={product} />;
  }

  return <MainProductView product={product} />;
}

// ----------------------------------------------------------------------------
// Vue ACCESSOIRE : liste des équipements compatibles (éditable)
// ----------------------------------------------------------------------------
function AccessoryView({ product }) {
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const { products: allMain, isLoading } = useSupplierProducts(product.supplier_id, {
    kind: 'main',
    pageSize: 500,
    search,
  });

  const currentIds = product.compatible_with_ids || [];
  const currentProducts = useMemo(() => allMain.filter((p) => currentIds.includes(p.id)), [allMain, currentIds]);
  const candidates = useMemo(() => allMain.filter((p) => !currentIds.includes(p.id)), [allMain, currentIds]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: supplierKeys.productDetail(product.id) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.products(product.supplier_id) });
  };

  const link = async (mainProduct) => {
    setSaving(true);
    try {
      const nextIds = [...currentIds, mainProduct.id];
      const result = await suppliersService.updateProduct(product.id, { compatibleWithIds: nextIds });
      if (result?.error) throw result.error;
      toast.success(`Lié à ${mainProduct.name}`);
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    } finally { setSaving(false); }
  };

  const unlink = async (mainId) => {
    setSaving(true);
    try {
      const nextIds = currentIds.filter((id) => id !== mainId);
      const result = await suppliersService.updateProduct(product.id, { compatibleWithIds: nextIds });
      if (result?.error) throw result.error;
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    } finally { setSaving(false); }
  };

  return (
    <CompatibilityPanel
      intro="Cet accessoire peut être commandé avec les équipements ci-dessous."
      currentLabel="Compatible avec"
      pickerLabel="Ajouter un équipement"
      iconBg="bg-secondary-100"
      iconColor="text-secondary-400"
      emptyMsg="Aucun équipement compatible défini"
      currentItems={currentProducts}
      candidates={candidates}
      isLoading={isLoading}
      search={search}
      setSearch={setSearch}
      showPicker={showPicker}
      setShowPicker={setShowPicker}
      saving={saving}
      onAdd={link}
      onRemove={(p) => unlink(p.id)}
    />
  );
}

// ----------------------------------------------------------------------------
// Vue ÉQUIPEMENT : liste des accessoires compatibles (éditable)
// ----------------------------------------------------------------------------
function MainProductView({ product }) {
  const { accessories, isLoading } = useAccessoriesForProduct(product.id);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  // Tous les accessoires du même fournisseur (pour picker)
  const { products: allAccessories, isLoading: loadingAll } = useSupplierProducts(product.supplier_id, {
    kind: 'accessory',
    pageSize: 500,
    search,
  });

  const currentIds = accessories.map((a) => a.id);
  const candidates = useMemo(
    () => allAccessories.filter((a) => !currentIds.includes(a.id)),
    [allAccessories, currentIds]
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [...supplierKeys.all, 'accessories-for', product.id] });
    queryClient.invalidateQueries({ queryKey: supplierKeys.products(product.supplier_id) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.productDetail(product.id) });
  };

  // Lier : ajouter l'id de l'équipement courant au compatible_with_ids de l'accessoire
  const link = async (accessory) => {
    setSaving(true);
    try {
      const nextIds = [...(accessory.compatible_with_ids || []), product.id];
      const result = await suppliersService.updateProduct(accessory.id, { compatibleWithIds: nextIds });
      if (result?.error) throw result.error;
      toast.success(`${accessory.name} ajouté`);
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    } finally { setSaving(false); }
  };

  // Délier : retirer l'id de l'équipement courant du compatible_with_ids de l'accessoire
  const unlink = async (accessory) => {
    setSaving(true);
    try {
      const nextIds = (accessory.compatible_with_ids || []).filter((id) => id !== product.id);
      const result = await suppliersService.updateProduct(accessory.id, { compatibleWithIds: nextIds });
      if (result?.error) throw result.error;
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    } finally { setSaving(false); }
  };

  return (
    <CompatibilityPanel
      intro="Ces accessoires peuvent être commandés avec cet équipement. Ajoute ou retire-les directement ici."
      currentLabel="Accessoires compatibles"
      pickerLabel="Ajouter un accessoire"
      iconBg="bg-amber-50"
      iconColor="text-amber-500"
      emptyMsg="Aucun accessoire référencé pour ce produit"
      currentItems={accessories}
      candidates={candidates}
      isLoading={isLoading || loadingAll}
      search={search}
      setSearch={setSearch}
      showPicker={showPicker}
      setShowPicker={setShowPicker}
      saving={saving}
      onAdd={link}
      onRemove={unlink}
    />
  );
}

// ----------------------------------------------------------------------------
// Panel partagé (mise en forme identique, comportement symétrique)
// ----------------------------------------------------------------------------
function CompatibilityPanel({
  intro, currentLabel, pickerLabel, iconBg, iconColor, emptyMsg,
  currentItems, candidates, isLoading, search, setSearch,
  showPicker, setShowPicker, saving, onAdd, onRemove,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900">{intro}</div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary-500">
            {currentLabel} ({currentItems.length})
          </h4>
          {!showPicker && (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Ajouter
            </button>
          )}
        </div>

        {currentItems.length === 0 ? (
          <div className="text-sm text-secondary-400 italic bg-secondary-50 rounded-lg p-4 text-center">
            {emptyMsg}
          </div>
        ) : (
          <div className="space-y-1.5">
            {currentItems.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 bg-white border border-secondary-200 rounded-lg">
                <div className={`w-8 h-8 rounded ${iconBg} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package className={`w-4 h-4 ${iconColor}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-secondary-900 truncate">{p.name}</div>
                  <div className="text-xs text-secondary-400">{p.reference || '—'}</div>
                </div>
                <span className="text-xs text-secondary-500">{formatEuro(p.tarif_public || p.selling_price_ht)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(p)}
                  disabled={saving}
                  className="p-1 hover:bg-red-50 rounded disabled:opacity-50"
                  title="Retirer"
                >
                  <X className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPicker && (
        <div className="border border-primary-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-primary-50 border-b border-primary-200">
            <span className="text-xs font-semibold text-primary-900">{pickerLabel}</span>
            <button
              type="button"
              onClick={() => { setShowPicker(false); setSearch(''); }}
              className="p-1 hover:bg-white/50 rounded"
            >
              <X className="w-3.5 h-3.5 text-primary-600" />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full px-3 py-2 text-sm border border-secondary-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              autoFocus
            />
            <div className="max-h-60 overflow-y-auto space-y-1">
              {isLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-primary-500 animate-spin" /></div>
              ) : candidates.length === 0 ? (
                <p className="text-xs text-secondary-400 text-center py-4">
                  {search ? 'Aucun résultat' : 'Rien à ajouter — tous déjà liés ou aucun produit disponible'}
                </p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={saving}
                    onClick={() => onAdd(p)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 text-left hover:bg-secondary-50 rounded group disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4 text-secondary-400 group-hover:text-primary-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-secondary-900 truncate">{p.name}</div>
                      <div className="text-xs text-secondary-400">{p.reference || '—'}</div>
                    </div>
                    <span className="text-xs text-secondary-500">{formatEuro(p.tarif_public || p.selling_price_ht)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
