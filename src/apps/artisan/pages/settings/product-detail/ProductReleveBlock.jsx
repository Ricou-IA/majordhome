// src/apps/artisan/pages/settings/product-detail/ProductReleveBlock.jsx
// Bloc « Relevé fournisseur » du drawer produit (lecture seule) : tout ce que le relevé a apporté et que le schéma de
// la catégorie n'affiche pas (catégories du site, stock daté, clé modèle, modèle IA…), le lien de la fiche technique,
// et le bouton « Ranger la fiche technique dans Documents » (edge supplier-catalog-sync, action `document`).
// Spec : 2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 6.
import { useState } from 'react';
import { FileDown, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useProductDocuments } from '@hooks/useSuppliers';
import { suppliersService } from '@services/suppliers.service';
import { getSchemaForCategory } from '@/shared/specs';
import { libelleCodeErreur } from '@/lib/catalogue/syncResult.js';
import { useQueryClient } from '@tanstack/react-query';
import { supplierKeys } from '@hooks/cacheKeys';

const LIBELLES = {
  categories_site: 'Catégories du site',
  categories: 'Rayon du site',
  stock_releve: 'Stock au relevé',
  baywa_internalid: 'Id interne fournisseur',
  domos_id: 'Id interne fournisseur',
  slug: 'Identifiant du site',
  fiche_produit: 'Page produit',
  description_courte: 'Description du site',
  attributs: 'Attributs du site',
  modele_ia: 'Modèle (IA)',
  modele_ia_confiance: 'Confiance IA',
  marque_ia: 'Marque (IA)',
  type_batterie: 'Type de batterie',
};
const MASQUEES = new Set(['fiche_technique_fr']);

function valeurLisible(k, v) {
  if (v == null || v === '') return '—';
  if (k === 'stock_releve' && typeof v === 'object') {
    const quand = v.at ? new Date(v.at).toLocaleDateString('fr-FR') : '';
    if ('qty' in v) return `${v.qty ?? '?'} en stock${quand ? ` (${quand})` : ''}`;
    if ('en_stock' in v) return `${v.en_stock ? 'en stock' : 'rupture'}${quand ? ` (${quand})` : ''}`;
  }
  if (k === 'modele_ia_confiance') return `${Math.round(Number(v) * 100)} %`;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([a, b]) => `${a} : ${b}`).join(' · ');
  return String(v);
}

export default function ProductReleveBlock({ product, orgId }) {
  const { isOrgAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { documents } = useProductDocuments(product?.id);
  const [rangement, setRangement] = useState(false);
  if (!product) return null;

  const canonical = product.specs?.canonical || {};
  const sourceVersion = product.specs?.source_version;
  const schema = getSchemaForCategory(product.category);
  const clesSchema = new Set((schema?.filterByFuelType?.(product.fuel_type) || []).map((f) => f.key));
  const horsSchema = Object.entries(canonical).filter(([k]) => !clesSchema.has(k) && !MASQUEES.has(k));
  const fiche = canonical.fiche_technique_fr;
  const dejaRangee = (documents || []).some((d) => d.document_type === 'Fiche technique');
  if (!sourceVersion && !fiche && horsSchema.length === 0) return null;

  const ranger = async () => {
    setRangement(true);
    try {
      const { data, error } = await suppliersService.fetchProductDocument(orgId, product.supplier_id, product.id);
      if (error) throw error;
      if (data?.ok) {
        toast.success(`Fiche technique rangée dans Documents (${data.resultat?.file_name || 'PDF'})`);
        queryClient.invalidateQueries({ queryKey: supplierKeys.productDetail(orgId, product.id) });
        queryClient.invalidateQueries({ queryKey: supplierKeys.productDocuments(orgId, product.id) });
      } else {
        toast.error(`Impossible : ${libelleCodeErreur(data?.code)}`);
      }
    } catch (err) {
      toast.error(err?.message || 'Le téléchargement a échoué');
    } finally {
      setRangement(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-secondary-200 bg-secondary-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary-500">
          Relevé fournisseur{sourceVersion ? <span className="ml-2 font-normal normal-case text-secondary-400">({sourceVersion})</span> : null}
        </h3>
        {fiche && (
          <div className="flex items-center gap-2">
            <a href={fiche} target="_blank" rel="noreferrer" className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1">
              <ExternalLink className="w-3.5 h-3.5" /> Fiche technique
            </a>
            {isOrgAdmin && !dejaRangee && (
              <button type="button" onClick={ranger} disabled={rangement} className="btn-secondary btn-sm">
                {rangement ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
                Ranger dans Documents
              </button>
            )}
            {dejaRangee && <span className="text-xs text-emerald-700">Rangée dans Documents</span>}
          </div>
        )}
      </div>
      {horsSchema.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {horsSchema.map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <dt className="text-secondary-500 shrink-0">{LIBELLES[k] || k}</dt>
              <dd className="text-secondary-800 truncate" title={valeurLisible(k, v)}>{valeurLisible(k, v)}</dd>
            </div>
          ))}
          {product.model_key && (
            <div className="flex gap-2 min-w-0">
              <dt className="text-secondary-500 shrink-0">Clé modèle</dt>
              <dd className="text-secondary-800 font-mono">{product.model_key}{product.model_key_source ? ` (${product.model_key_source})` : ''}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-[11px] text-secondary-400">Ces valeurs viennent du site du fournisseur et sont rafraîchies à chaque relevé ; ce que vous saisissez à la main dans les autres champs est conservé.</p>
    </section>
  );
}
