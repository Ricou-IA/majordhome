// src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx
// Fiche d'un article Majord'home (base du devis) : champs humains (org_admin seul), photo choisie parmi les offres ou
// téléversée, specs harmonisées (schéma de la catégorie), offres = lignes fournisseur rattachées (ArticleOffersTable),
// documents = ceux des lignes rattachées, « Rattacher une ligne fournisseur » / « Détacher ».
// Spec docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md § 5.6 / § 8.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, Link2, Image as ImageIcon, Upload, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogItem, useCatalogItemOffers, useCatalogItemMutations } from '@hooks/useCatalogItems';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { supportsEnrichment, getSchemaForCategory } from '@/shared/specs';
import { champsDuSchema } from '@/lib/catalogue/enrichissement.js';
import { FormField, TextInput, SelectInput, TextArea } from '../../../components/FormFields';
import ProductSpecsForm from '../product-detail/ProductSpecsForm';
import ArticleDocuments from './ArticleDocuments';
import ArticleOffersTable from './ArticleOffersTable';
import ArticleAttachModal from './ArticleAttachModal';
import ArticleEnrichModal from './ArticleEnrichModal';
import { NATURES_FICHE } from '@/lib/catalogue/natures.js';

function formDepuis(item) {
  return {
    name: item?.name || '',
    brand: item?.brand || '',
    category: item?.category || '',
    gamme: item?.gamme || '',
    productKind: item?.product_kind || 'main',
    unit: item?.unit || 'pièce',
    sellingPriceHt: item?.selling_price_ht != null ? String(item.selling_price_ht) : '',
    description: item?.description || '',
    imageUrl: item?.image_url || '',
  };
}

/**
 * @param {{ orgId: string, itemId: string, onClose: () => void }} p
 */
export default function ArticleDrawer({ orgId, itemId, onClose }) {
  const { isOrgAdmin } = useAuth();
  const { item, isLoading } = useCatalogItem(orgId, itemId);
  const { offers } = useCatalogItemOffers(orgId, itemId ? [itemId] : []);
  const { updateItem, uploadImage, attach, detach, isSaving, isLinking, proposeEnrichment, applyEnrichment, isApplyingEnrichment } = useCatalogItemMutations(orgId);
  const [form, setForm] = useState(formDepuis(null));
  const [specs, setSpecs] = useState({ canonical: {}, extras: [] });
  const [dirty, setDirty] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    setForm(formDepuis(item));
    setSpecs({ canonical: item.specs?.canonical || {}, extras: item.specs?.extras || [] });
    setDirty(false);
  }, [item]);

  const setField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const canEdit = isOrgAdmin;
  const photosOffres = useMemo(() => [...new Set(offers.map((o) => o.image_url).filter(Boolean))], [offers]);
  const offresActives = offers.filter((o) => o.is_active);
  // champs demandés à l'IA : ceux du formulaire de caractéristiques de la catégorie (sans combustible, comme lui)
  const champsEnrichissement = useMemo(() => champsDuSchema(getSchemaForCategory(item?.category)?.filterByFuelType?.() || []), [item?.category]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Le libellé est requis'); return; }
    try {
      await updateItem(itemId, {
        name: form.name, brand: form.brand, category: form.category, gamme: form.gamme, productKind: form.productKind,
        unit: form.unit, sellingPriceHt: form.sellingPriceHt, description: form.description,
        imageUrl: form.imageUrl, specs: { ...(item?.specs || {}), canonical: specs.canonical || {}, extras: specs.extras || [] },
      });
      toast.success('Article enregistré');
      setDirty(false);
    } catch (err) { toast.error(err?.message || 'Enregistrement refusé'); }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await uploadImage(itemId, file); toast.success('Photo téléversée'); }
    catch (err) { toast.error(err?.message || 'Téléversement refusé'); }
  };

  const handleDetach = async (productId) => {
    if (!window.confirm('Détacher cette ligne fournisseur ? Elle recevra son propre article Majord’home.')) return;
    try { await detach(productId); toast.success('Ligne détachée : un nouvel article a été créé'); }
    catch (err) { toast.error(err?.message || 'Détachement refusé'); }
  };

  const handleAttach = async (productId) => {
    try { await attach(productId, itemId); toast.success('Ligne rattachée'); setAttaching(false); }
    catch (err) { toast.error(err?.message || 'Rattachement refusé'); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-secondary-400">Article Majord&apos;home</p>
            <h2 className="text-lg font-semibold text-secondary-900 truncate">{item?.name || (isLoading ? 'Chargement…' : 'Article')}</h2>
            {item && (
              <p className="text-xs text-secondary-500">
                {offresActives.length} offre{offresActives.length > 1 ? 's' : ''} active{offresActives.length > 1 ? 's' : ''}
                {item.meilleur_prix_achat != null ? ` · meilleur achat ${Number(item.meilleur_prix_achat).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}` : ''}
                {item.merged_into ? ' · fusionné dans un autre article' : ''}
                {!item.is_active ? ' · désactivé' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && item && (
              <button type="button" onClick={() => setEnriching(true)} disabled={dirty} className="btn-secondary btn-sm"
                title={dirty ? 'Enregistrez d’abord vos modifications' : 'Chercher photo, fiche technique et caractéristiques sur le web'}>
                <Sparkles className="w-4 h-4 mr-1" /> Enrichir
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={handleSave} disabled={!dirty || isSaving} className="btn-primary btn-sm">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Enregistrer
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1.5 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
          </div>
        </div>

        {isLoading || !item ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {!canEdit && <p className="text-xs text-secondary-500 bg-secondary-50 rounded px-3 py-2">Lecture seule : la correction d&apos;un article est réservée à l&apos;administrateur.</p>}

            {/* Identité */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <FormField label="Libellé (ce que voit le client)" required>
                  <TextInput value={form.name} onChange={(v) => setField('name', v)} disabled={!canEdit} />
                </FormField>
              </div>
              <FormField label="Marque"><TextInput value={form.brand} onChange={(v) => setField('brand', v)} disabled={!canEdit} /></FormField>
              <FormField label="Gamme"><TextInput value={form.gamme} onChange={(v) => setField('gamme', v)} disabled={!canEdit} /></FormField>
              <FormField label="Catégorie">
                <SelectInput value={form.category} onChange={(v) => setField('category', v)} disabled={!canEdit}
                  options={[{ value: '', label: 'Sans catégorie' }, ...PRODUCT_CATEGORIES]} />
              </FormField>
              <FormField label="Nature">
                <SelectInput value={form.productKind} onChange={(v) => setField('productKind', v)} disabled={!canEdit} options={NATURES_FICHE} />
              </FormField>
              <FormField label="Prix de vente HT (€)">
                <TextInput type="number" value={form.sellingPriceHt} onChange={(v) => setField('sellingPriceHt', v)} disabled={!canEdit} placeholder="0 = à saisir" />
              </FormField>
              <FormField label="Unité">
                <SelectInput value={form.unit} onChange={(v) => setField('unit', v)} disabled={!canEdit} options={PRODUCT_UNITS} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Description">
                  <TextArea value={form.description} onChange={(v) => setField('description', v)} rows={2} disabled={!canEdit} />
                </FormField>
              </div>
            </section>

            {/* Photo */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Photo</h4>
              <div className="flex flex-wrap items-center gap-2">
                {form.imageUrl ? <img src={form.imageUrl} alt="" className="w-20 h-20 object-contain rounded border border-secondary-200 bg-white" /> : <div className="w-20 h-20 rounded border border-dashed border-secondary-300 flex items-center justify-center text-[10px] text-secondary-400">aucune</div>}
                {photosOffres.filter((u) => u !== form.imageUrl).map((u) => (
                  <button key={u} type="button" disabled={!canEdit} onClick={() => setField('imageUrl', u)} title="Choisir cette photo (relevé fournisseur)"
                    className="w-14 h-14 rounded border border-secondary-200 hover:border-primary-400 overflow-hidden bg-white disabled:opacity-60">
                    <img src={u} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
                {canEdit && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                    <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary btn-sm"><Upload className="w-3.5 h-3.5 mr-1" /> Téléverser</button>
                    {form.imageUrl && <button type="button" onClick={() => setField('imageUrl', '')} className="text-xs text-secondary-500 hover:text-red-700">Retirer</button>}
                  </>
                )}
              </div>
            </section>

            {/* Offres */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Offres fournisseur</h4>
                {canEdit && (
                  <button type="button" onClick={() => setAttaching(true)} className="btn-secondary btn-sm"><Link2 className="w-3.5 h-3.5 mr-1" /> Rattacher une ligne fournisseur</button>
                )}
              </div>
              <ArticleOffersTable offers={offers} canEdit={canEdit} onDetach={handleDetach} detaching={isLinking} />
              <p className="text-[11px] text-secondary-400">Au devis, la marge est estimée sur le prix d&apos;achat le plus bas de ces offres (le fournisseur se choisit à la commande) ; l&apos;âge du prix est indicatif.</p>
            </section>

            {/* Caractéristiques : schéma de la catégorie s'il existe, extras libres pour toute catégorie (imprimés au devis) */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
                {supportsEnrichment(form.category) ? 'Caractéristiques harmonisées' : 'Caractéristiques'}
              </h4>
              <fieldset disabled={!canEdit}>
                <ProductSpecsForm category={form.category} value={specs} onChange={(v) => { setSpecs(v); setDirty(true); }} />
              </fieldset>
            </section>

            {/* Documents de l'article : les siens + ceux de ses lignes fournisseur, une seule liste */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500">Documents de l&apos;article</h4>
              <ArticleDocuments orgId={orgId} itemId={itemId} offers={offers} canEdit={canEdit} />
            </section>
          </div>
        )}
      </div>
      {enriching && item && (
        <ArticleEnrichModal item={item} champs={champsEnrichissement} onClose={() => setEnriching(false)}
          propose={proposeEnrichment} apply={applyEnrichment} applying={isApplyingEnrichment} />
      )}
      {attaching && item && <ArticleAttachModal orgId={orgId} item={item} offers={offers} onClose={() => setAttaching(false)} onAttach={handleAttach} attaching={isLinking} />}
    </div>
  );
}
