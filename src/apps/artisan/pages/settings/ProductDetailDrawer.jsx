/**
 * ProductDetailDrawer.jsx — Fiche produit enrichie (side drawer)
 * ============================================================================
 * Drawer avec 5 onglets :
 *  1. Identité : nom, référence, catégorie, marque, combustible, prix, TVA
 *  2. Caractéristiques : formulaire canonique adaptatif + extras
 *  3. Photo : upload / preview / source externe
 *  4. Variantes : sous-produits liés (pierre ollaire, blanche...)
 *  5. Documents : manuels, fiches techniques PDF
 *
 * Sauvegarde : Identité + Caractéristiques via un seul bouton (updateProduct).
 * Photo, Variantes, Documents se sauvegardent directement via leurs composants.
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useProductDetail } from '@hooks/useSuppliers';
import { suppliersService, PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { TVA_RATES } from '@services/devis.service';
import { POELE_FUEL_TYPES, supportsEnrichment } from '@/shared/specs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  X, Loader2, Save, FileSliders, Image as ImageIcon,
  Layers, FileText, User, Sparkles, Eye, EyeOff, Link2, Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { FormField, TextInput, SelectInput, TextArea } from '../../components/FormFields';
import { formatEuro } from '@/lib/utils';

import ProductSpecsForm from './product-detail/ProductSpecsForm';
import ProductImageSection from './product-detail/ProductImageSection';
import ProductVariantsSection from './product-detail/ProductVariantsSection';
import ProductCompatibilitySection from './product-detail/ProductCompatibilitySection';
import { ProductDocumentsInline } from './ProductDocumentsPanel';
import { useQueryClient } from '@tanstack/react-query';
import { supplierKeys } from '@hooks/cacheKeys';

// Blueprint minimal du form identité
const EMPTY_FORM = {
  name: '',
  reference: '',
  description: '',
  category: '',
  codeFamille: '',
  gamme: '',
  codeEan: '',
  brand: '',
  fuelType: '',
  diametre: '',
  unit: 'pièce',
  tarifPublic: '',
  tauxRemise: '',
  sellingPriceHt: '',
  defaultTvaRate: '20',
  clientVisible: true,
  productKind: 'main',
};


export default function ProductDetailDrawer({ productId, supplierId, orgId, onClose }) {
  const { user } = useAuth();
  const { product, isLoading } = useProductDetail(productId);
  const [form, setForm] = useState(EMPTY_FORM);
  const [specs, setSpecs] = useState({ canonical: {}, extras: [] });
  const [tab, setTab] = useState('identity');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const queryClient = useQueryClient();

  // Sync state local avec product
  useEffect(() => {
    if (!product) return;
    setForm({
      name: product.name || '',
      reference: product.reference || '',
      description: product.description || '',
      category: product.category || '',
      codeFamille: product.code_famille || '',
      gamme: product.gamme || '',
      codeEan: product.code_ean || '',
      brand: product.brand || '',
      fuelType: product.fuel_type || '',
      diametre: product.diametre || '',
      unit: product.unit || 'pièce',
      tarifPublic: product.tarif_public?.toString() || '',
      tauxRemise: product.taux_remise?.toString() || '',
      sellingPriceHt: product.selling_price_ht?.toString() || '',
      defaultTvaRate: product.default_tva_rate?.toString() || '20',
      clientVisible: product.client_visible !== false,
      productKind: product.product_kind || 'main',
    });
    setSpecs({
      canonical: product.specs?.canonical || {},
      extras: product.specs?.extras || [],
    });
    setDirty(false);
  }, [product]);

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }, []);

  const onSpecsChange = useCallback((next) => {
    setSpecs(next);
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Le libellé est requis');
      return;
    }
    setSaving(true);
    try {
      const result = await suppliersService.updateProduct(productId, {
        ...form,
        specs: { canonical: specs.canonical, extras: specs.extras },
      });
      if (result?.error) throw result.error;
      toast.success('Produit enregistré');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: supplierKeys.productDetail(productId) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.products(supplierId) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.allProducts(orgId) });
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !window.confirm('Modifications non enregistrées. Fermer quand même ?')) return;
    onClose?.();
  };

  // Calcul prix achat en live
  const computedPurchase = form.tarifPublic
    ? Math.round(parseFloat(form.tarifPublic) * (1 - (parseFloat(form.tauxRemise) || 0) / 100) * 100) / 100
    : null;

  const isAccessory = form.productKind === 'accessory';
  const isConsumable = form.productKind === 'consumable';
  const supportsSpecs = supportsEnrichment(form.category) && !isAccessory && !isConsumable;

  // Auto-reset tab si onglet désactivé
  useEffect(() => {
    if (tab === 'specs' && !supportsSpecs) setTab('identity');
    if (tab === 'variants' && isAccessory) setTab('compat');
  }, [tab, supportsSpecs, isAccessory]);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={handleClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-secondary-200 bg-white">
          <div className="w-14 h-14 rounded-lg bg-secondary-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
            {product?.image_url ? (
              <img src={product.image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-6 h-6 text-secondary-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-secondary-900 truncate">
              {product?.name || 'Nouveau produit'}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-secondary-500 flex-wrap">
              {product?.product_kind === 'accessory' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-medium">
                  <Link2 className="w-3 h-3" /> Accessoire
                </span>
              )}
              {product?.product_kind === 'consumable' && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-medium">
                  Consommable
                </span>
              )}
              {product?.brand && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-secondary-100 rounded">{product.brand}</span>
              )}
              {product?.fuel_type && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded">
                  {POELE_FUEL_TYPES.find((f) => f.value === product.fuel_type)?.label}
                </span>
              )}
              {product?.reference && <span>Réf. {product.reference}</span>}
              {product?.tarif_public && <span className="font-medium">{formatEuro(product.tarif_public)}</span>}
            </div>
          </div>
          <button
            type="button"
            disabled
            className="btn-secondary btn-sm opacity-50 cursor-not-allowed"
            title="Enrichissement web — bientôt"
          >
            <Sparkles className="w-4 h-4 mr-1" /> Enrichir web
          </button>
          <button onClick={handleClose} className="p-2 hover:bg-secondary-100 rounded-lg">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 pt-3 border-b border-secondary-200 bg-white">
              <TabsList className="h-9">
                <TabsTrigger value="identity" className="gap-1.5">
                  <User className="w-3.5 h-3.5" /> Identité
                </TabsTrigger>
                {supportsSpecs && (
                  <TabsTrigger value="specs" className="gap-1.5">
                    <FileSliders className="w-3.5 h-3.5" /> Caractéristiques
                  </TabsTrigger>
                )}
                <TabsTrigger value="image" className="gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" /> Photo
                </TabsTrigger>
                {!isAccessory && (
                  <TabsTrigger value="variants" className="gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> Variantes
                  </TabsTrigger>
                )}
                <TabsTrigger value="compat" className="gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Compatibilité
                </TabsTrigger>
                <TabsTrigger value="documents" className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Documents
                </TabsTrigger>
              </TabsList>
            </div>

            {/* --------- Tab Identité --------- */}
            <TabsContent value="identity" className="flex-1 overflow-y-auto px-6 py-5 m-0 space-y-5">
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary-500">Classification</h3>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Catégorie">
                    <SelectInput
                      value={form.category}
                      onChange={(v) => setField('category', v)}
                      options={PRODUCT_CATEGORIES}
                      placeholder="— Choisir —"
                    />
                  </FormField>
                  <FormField label="Marque fabricant">
                    <TextInput
                      value={form.brand}
                      onChange={(v) => setField('brand', v)}
                      placeholder="Ex: COLOR"
                    />
                  </FormField>
                </div>
                {form.category === 'poele' && !isAccessory && !isConsumable && (
                  <FormField label="Combustible">
                    <SelectInput
                      value={form.fuelType}
                      onChange={(v) => setField('fuelType', v)}
                      options={[{ value: '', label: '— Choisir —' }, ...POELE_FUEL_TYPES]}
                    />
                  </FormField>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Gamme">
                    <TextInput value={form.gamme} onChange={(v) => setField('gamme', v)} />
                  </FormField>
                  <FormField label="Code Famille">
                    <TextInput value={form.codeFamille} onChange={(v) => setField('codeFamille', v)} />
                  </FormField>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary-500">Identification</h3>
                <FormField label="Libellé" required>
                  <TextInput value={form.name} onChange={(v) => setField('name', v)} placeholder="Désignation" />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Référence fournisseur">
                    <TextInput value={form.reference} onChange={(v) => setField('reference', v)} />
                  </FormField>
                  <FormField label="Code EAN">
                    <TextInput value={form.codeEan} onChange={(v) => setField('codeEan', v)} placeholder="Code-barres" />
                  </FormField>
                </div>
                <FormField label="Description">
                  <TextArea value={form.description} onChange={(v) => setField('description', v)} rows={2} />
                </FormField>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary-500">Tarification</h3>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Tarif public HT">
                    <TextInput type="number" step="0.01" value={form.tarifPublic} onChange={(v) => setField('tarifPublic', v)} placeholder="0,00" />
                  </FormField>
                  <FormField label="Remise %">
                    <TextInput type="number" step="0.1" value={form.tauxRemise} onChange={(v) => setField('tauxRemise', v)} placeholder="0" />
                  </FormField>
                  <FormField label="Prix de vente HT">
                    <TextInput type="number" step="0.01" value={form.sellingPriceHt} onChange={(v) => setField('sellingPriceHt', v)} placeholder="0,00" />
                  </FormField>
                </div>
                {computedPurchase !== null && (
                  <p className="text-xs text-secondary-500">
                    Prix d'achat HT calculé : <span className="font-medium text-secondary-700">{formatEuro(computedPurchase)}</span>
                  </p>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Unité">
                    <SelectInput value={form.unit} onChange={(v) => setField('unit', v)} options={PRODUCT_UNITS} />
                  </FormField>
                  <FormField label="TVA par défaut">
                    <SelectInput
                      value={form.defaultTvaRate}
                      onChange={(v) => setField('defaultTvaRate', v)}
                      options={TVA_RATES.map((t) => ({ value: t.value.toString(), label: t.label }))}
                    />
                  </FormField>
                  <FormField label="Diamètre">
                    <TextInput value={form.diametre} onChange={(v) => setField('diametre', v)} placeholder="Ex: 80mm" />
                  </FormField>
                </div>
              </section>

              <section className="space-y-2 pt-3 border-t border-secondary-200">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.clientVisible}
                    onChange={(e) => setField('clientVisible', e.target.checked)}
                    className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-secondary-700 inline-flex items-center gap-1">
                    {form.clientVisible ? <Eye className="w-4 h-4 text-green-600" /> : <EyeOff className="w-4 h-4 text-secondary-400" />}
                    Visible sur l'espace client
                  </span>
                </label>
                <p className="text-xs text-secondary-400 pl-6">
                  Si coché, ce produit et ses caractéristiques techniques seront accessibles au client depuis son espace (portail — sprint 8).
                </p>
              </section>
            </TabsContent>

            {/* --------- Tab Caractéristiques --------- */}
            <TabsContent value="specs" className="flex-1 overflow-y-auto px-6 py-5 m-0">
              <ProductSpecsForm
                category={form.category}
                fuelType={form.fuelType}
                value={specs}
                onChange={onSpecsChange}
              />
            </TabsContent>

            {/* --------- Tab Photo --------- */}
            <TabsContent value="image" className="flex-1 overflow-y-auto px-6 py-5 m-0">
              <div className="max-w-lg mx-auto">
                <ProductImageSection product={product} orgId={orgId} supplierId={supplierId} />
              </div>
            </TabsContent>

            {/* --------- Tab Variantes --------- */}
            {!isAccessory && (
              <TabsContent value="variants" className="flex-1 overflow-y-auto px-6 py-5 m-0">
                <ProductVariantsSection parent={product} orgId={orgId} />
              </TabsContent>
            )}

            {/* --------- Tab Compatibilité --------- */}
            <TabsContent value="compat" className="flex-1 overflow-y-auto px-6 py-5 m-0">
              <ProductCompatibilitySection product={product} orgId={orgId} />
            </TabsContent>

            {/* --------- Tab Documents --------- */}
            <TabsContent value="documents" className="flex-1 overflow-y-auto px-6 py-5 m-0">
              <ProductDocumentsInline productId={productId} orgId={orgId} />
            </TabsContent>
          </Tabs>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-secondary-200 bg-white">
          {dirty && (
            <span className="text-xs text-amber-600 mr-auto">● Modifications non enregistrées</span>
          )}
          <button type="button" onClick={handleClose} className="btn-secondary">
            Fermer
          </button>
          {(tab === 'identity' || tab === 'specs') && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn-primary"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Enregistrer
            </button>
          )}
        </div>
      </div>
    </>
  );
}
