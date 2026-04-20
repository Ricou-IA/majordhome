/**
 * ProductVariantsSection.jsx — Liste et création de variantes produit
 * ============================================================================
 * Variantes = même produit de base, finition différente (ex: G1 acier / pierre ollaire / pierre blanche)
 * Chaque variante est une ligne supplier_products avec variant_of = parentId.
 * CRUD inline rapide : label + prix de vente (les specs techniques sont héritées du parent).
 * ============================================================================
 */

import { useState } from 'react';
import { Plus, Trash2, Copy, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useProductVariants } from '@hooks/useSuppliers';
import { suppliersService } from '@services/suppliers.service';
import { formatEuro } from '@/lib/utils';
import { inputClass } from '../../../components/FormFields';
import { useQueryClient } from '@tanstack/react-query';
import { supplierKeys } from '@hooks/cacheKeys';

export default function ProductVariantsSection({ parent, orgId }) {
  const { variants, isLoading } = useProductVariants(parent?.id);
  const [showForm, setShowForm] = useState(false);
  const [newVariant, setNewVariant] = useState({ label: '', sellingPriceHt: '', tauxRemise: '' });
  const [savingId, setSavingId] = useState(null);
  const [editState, setEditState] = useState({});
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: supplierKeys.productVariants(parent?.id) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.products(parent?.supplier_id) });
    queryClient.invalidateQueries({ queryKey: supplierKeys.allProducts(orgId) });
  };

  const handleCreateVariant = async () => {
    if (!newVariant.label.trim()) {
      toast.error('Libellé variante requis');
      return;
    }
    setSavingId('new');
    try {
      const parentTarifPublic = parent.tarif_public ? parseFloat(parent.tarif_public) : 0;
      const sellingPrice = parseFloat(newVariant.sellingPriceHt) || 0;
      const tauxRemise = parseFloat(newVariant.tauxRemise) || parseFloat(parent.taux_remise) || 0;

      const result = await suppliersService.createProduct({
        supplierId: parent.supplier_id,
        orgId,
        name: `${parent.name} — ${newVariant.label}`,
        reference: parent.reference ? `${parent.reference}-${newVariant.label.toLowerCase().replace(/\s+/g, '-')}` : null,
        category: parent.category,
        codeFamille: parent.code_famille,
        gamme: parent.gamme,
        diametre: parent.diametre,
        unit: parent.unit,
        defaultTvaRate: parent.default_tva_rate,
        tarifPublic: sellingPrice || parentTarifPublic,
        tauxRemise,
        sellingPriceHt: sellingPrice,
        fuelType: parent.fuel_type,
        brand: parent.brand,
        variantOf: parent.id,
        variantLabel: newVariant.label.trim(),
        specs: parent.specs || {},
        clientVisible: parent.client_visible,
      });

      if (result?.error) throw result.error;
      toast.success('Variante créée');
      setNewVariant({ label: '', sellingPriceHt: '', tauxRemise: '' });
      setShowForm(false);
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur création variante');
    } finally {
      setSavingId(null);
    }
  };

  const handleUpdateVariant = async (variant) => {
    const patch = editState[variant.id];
    if (!patch) return;
    setSavingId(variant.id);
    try {
      const result = await suppliersService.updateProduct(variant.id, patch);
      if (result?.error) throw result.error;
      toast.success('Variante mise à jour');
      setEditState((s) => { const { [variant.id]: _, ...rest } = s; return rest; });
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur mise à jour');
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteVariant = async (variant) => {
    if (!window.confirm(`Supprimer la variante "${variant.variant_label || variant.name}" ?`)) return;
    setSavingId(variant.id);
    try {
      const result = await suppliersService.deactivateProduct(variant.id);
      if (result?.error) throw result.error;
      toast.success('Variante supprimée');
      invalidate();
    } catch (err) {
      toast.error(err?.message || 'Erreur suppression');
    } finally {
      setSavingId(null);
    }
  };

  const setField = (id, field, value) => {
    setEditState((s) => ({ ...s, [id]: { ...(s[id] || {}), [field]: value } }));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-secondary-500">
          Les variantes partagent les caractéristiques techniques du produit parent.
          Seuls le libellé et le prix peuvent différer (ex : habillage pierre, coloris).
        </p>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary btn-sm flex-shrink-0"
          >
            <Plus className="w-4 h-4 mr-1" /> Variante
          </button>
        )}
      </div>

      {/* Formulaire création */}
      {showForm && (
        <div className="border border-primary-200 bg-primary-50/40 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-5">
              <label className="text-[10px] uppercase tracking-wider text-secondary-500 font-semibold">Libellé variante</label>
              <input
                type="text"
                value={newVariant.label}
                onChange={(e) => setNewVariant((v) => ({ ...v, label: e.target.value }))}
                placeholder="Ex: Pierre ollaire"
                className={inputClass}
                autoFocus
              />
            </div>
            <div className="col-span-3">
              <label className="text-[10px] uppercase tracking-wider text-secondary-500 font-semibold">Prix public HT</label>
              <input
                type="number"
                step="0.01"
                value={newVariant.sellingPriceHt}
                onChange={(e) => setNewVariant((v) => ({ ...v, sellingPriceHt: e.target.value }))}
                placeholder="0,00"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-secondary-500 font-semibold">Remise %</label>
              <input
                type="number"
                step="0.1"
                value={newVariant.tauxRemise}
                onChange={(e) => setNewVariant((v) => ({ ...v, tauxRemise: e.target.value }))}
                placeholder="—"
                className={inputClass}
              />
            </div>
            <div className="col-span-2 flex gap-1">
              <button
                type="button"
                onClick={handleCreateVariant}
                disabled={savingId === 'new'}
                className="btn-primary btn-sm flex-1"
              >
                {savingId === 'new' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'OK'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setNewVariant({ label: '', sellingPriceHt: '', tauxRemise: '' }); }}
                className="btn-secondary btn-sm"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste */}
      {variants.length === 0 ? (
        <div className="text-center py-6 text-sm text-secondary-400 bg-secondary-50 rounded-lg">
          Aucune variante. Ajoute-en si ce produit existe en plusieurs finitions.
        </div>
      ) : (
        <div className="border border-secondary-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary-50 text-[10px] uppercase tracking-wider text-secondary-500 font-semibold">
              <tr>
                <th className="text-left px-3 py-2 w-[40%]">Variante</th>
                <th className="text-right px-3 py-2">Prix public</th>
                <th className="text-right px-3 py-2">Remise</th>
                <th className="text-right px-3 py-2">PV HT</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const edit = editState[v.id] || {};
                const hasEdits = Object.keys(edit).length > 0;
                return (
                  <tr key={v.id} className="border-t border-secondary-100">
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={edit.variantLabel ?? v.variant_label ?? ''}
                        onChange={(e) => setField(v.id, 'variantLabel', e.target.value)}
                        className={`${inputClass} text-sm`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={edit.tarifPublic ?? v.tarif_public ?? ''}
                        onChange={(e) => setField(v.id, 'tarifPublic', e.target.value)}
                        className={`${inputClass} text-sm text-right w-24`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={edit.tauxRemise ?? v.taux_remise ?? ''}
                        onChange={(e) => setField(v.id, 'tauxRemise', e.target.value)}
                        className={`${inputClass} text-sm text-right w-16`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right text-secondary-600 text-xs">
                      {formatEuro(v.selling_price_ht || 0)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 justify-end">
                        {hasEdits && (
                          <button
                            type="button"
                            onClick={() => handleUpdateVariant(v)}
                            disabled={savingId === v.id}
                            className="p-1.5 hover:bg-green-50 rounded"
                            title="Enregistrer"
                          >
                            {savingId === v.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-500" />
                            ) : (
                              <Save className="w-3.5 h-3.5 text-green-600" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteVariant(v)}
                          disabled={savingId === v.id}
                          className="p-1.5 hover:bg-red-50 rounded"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
