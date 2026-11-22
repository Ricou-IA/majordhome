/**
 * ProductDrawer — édition / création d'un produit boutique.
 * Un objet `form` + son `initial` (isDirty = diff JSON) ; un seul « Enregistrer ».
 * Photos : envoyées immédiatement ; à l'enregistrement on supprime les fichiers de NOTRE préfixe
 * retirés du produit ; à l'abandon, ceux envoyés pendant la session.
 */
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { X, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { webshopProductsService } from '@services/webshopProducts.service';
import {
  emptyProductForm, productToForm, validateProductForm, formToPayload, imagesToDelete,
  slugify, uniqueSlug, nextDisplayOrder, productPageUrl,
} from '@/lib/webshop/catalog';
import { Block, EssentialFields, StockFields, PoseFields, PurchaseFields, AdvancedFields } from './ProductFormSections';
import ProductImagesField from './ProductImagesField';
import SpecsField from './SpecsField';

export default function ProductDrawer({ product, products, categories, orgId, siteUrl, canEdit, onClose, createProduct, updateProduct, isSaving }) {
  const isNew = !product;
  const [productId] = useState(() => product?.id ?? crypto.randomUUID());
  const initial = useMemo(() => (product ? productToForm(product) : emptyProductForm()), [product]);
  const [form, setForm] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const uploadedRef = useRef(new Set());

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const errors = validateProductForm(form);
  const isValid = Object.keys(errors).length === 0;
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const shownErrors = showErrors ? errors : {};
  const pageUrl = product?.is_active && product?.shipping_kind ? productPageUrl(product.slug, siteUrl) : null;
  const hasPose = Boolean(initial.install_price_ttc || initial.pro_install_price_ttc);

  // Abandon : toute photo envoyée pendant la session et absente de l'état initial est supprimée
  // (y compris une photo envoyée puis retirée, que form.images ne porte plus).
  const discardUploads = async () => {
    const paths = imagesToDelete([...uploadedRef.current], initial.images, orgId);
    if (paths.length) await webshopProductsService.deleteImages(paths);
  };

  const requestClose = () => {
    if (isDirty && canEdit) setConfirmClose(true);
    else {
      discardUploads();
      onClose();
    }
  };

  const handleSave = async () => {
    if (!isValid) {
      setShowErrors(true);
      toast.error('Des champs sont à corriger');
      return;
    }
    const payload = formToPayload(form);
    try {
      if (isNew) {
        const slug = uniqueSlug(slugify(form.name), products.map((p) => p.slug));
        await createProduct({ ...payload, id: productId, slug, display_order: nextDisplayOrder(products) });
        toast.success('Produit créé');
      } else {
        await updateProduct({ id: product.id, patch: payload });
        toast.success(payload.is_active ? 'Produit enregistré — à jour sur le site' : 'Produit enregistré (masqué sur le site)');
      }
      const orphans = imagesToDelete([...initial.images, ...uploadedRef.current], form.images, orgId);
      if (orphans.length) {
        const { error } = await webshopProductsService.deleteImages(orphans);
        if (error) toast.warning('Photos retirées du produit mais pas supprimées du stockage');
      }
      onClose();
    } catch (err) {
      toast.error(`Enregistrement refusé : ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={requestClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-secondary-200">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-secondary-900 truncate">{isNew ? 'Nouveau produit' : product.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-medium ${form.is_active ? 'bg-sky-100 text-sky-700' : 'bg-secondary-100 text-secondary-500'}`}>
                {form.is_active ? 'Visible sur le site' : 'Masqué'}
              </span>
              {pageUrl && (
                <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                  Voir sur le site <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={requestClose} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6">
          {product?.supplier === 'dixneuf' && canEdit && (
            <p className="mt-4 flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Produit importé du catalogue Dixneuf : un ré-import peut remplacer les textes, caractéristiques et stock (pas le prix ni l’expédition).
            </p>
          )}
          <Block title="L'essentiel">
            <EssentialFields form={form} set={set} errors={shownErrors} categories={categories} disabled={!canEdit} />
            <div className="flex gap-6 text-sm text-secondary-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} disabled={!canEdit} className="rounded border-secondary-300" />
                Visible sur le site
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} disabled={!canEdit} className="rounded border-secondary-300" />
                Mis en avant
              </label>
            </div>
          </Block>
          <Block title="Photos" hint={`${form.images.length} photo(s)`}>
            <ProductImagesField images={form.images} onChange={(v) => set('images', v)} onUploaded={(url) => uploadedRef.current.add(url)} orgId={orgId} productId={productId} siteUrl={siteUrl} disabled={!canEdit} />
          </Block>
          <Block title="Caractéristiques" hint={`${form.specs.length}`}>
            <SpecsField rows={form.specs} onChange={(v) => set('specs', v)} disabled={!canEdit} error={shownErrors.specs} />
          </Block>
          <Block title="Stock & livraison">
            <StockFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Pose" defaultOpen={hasPose} hint={hasPose ? 'renseignée' : 'non proposée'}>
            <PoseFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Achat & marge" defaultOpen={false}>
            <PurchaseFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Avancé (description longue, SEO)" defaultOpen={false}>
            <AdvancedFields form={form} set={set} disabled={!canEdit} slug={product?.slug} isNew={isNew} />
          </Block>
        </div>

        {canEdit && (
          <footer className="flex items-center justify-end gap-2 px-6 py-3 border-t border-secondary-200 bg-secondary-50">
            <button type="button" onClick={requestClose} className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-900">Annuler</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={(!isDirty && !isNew) || isSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isNew ? 'Créer le produit' : 'Enregistrer'}
            </button>
          </footer>
        )}
      </aside>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Abandonner les modifications ?"
        description="Les modifications non enregistrées seront perdues."
        confirmLabel="Abandonner"
        onConfirm={async () => {
          setConfirmClose(false);
          await discardUploads();
          onClose();
        }}
      />
    </div>
  );
}
