// src/apps/artisan/pages/settings/product-detail/ProductArticleBlock.jsx
// Bloc « Article Majord'home » du drawer d'une ligne fournisseur : l'article auquel la ligne est rattachée, ses
// offres, le lien vers la fiche article (où se corrigent libellé, catégorie, prix de vente, photo) — et, pour une
// ligne sans article (saisie à la main, variante, fournisseur sans relevé), le bouton qui le crée (org_admin).
import { Link } from 'react-router-dom';
import { Boxes, ExternalLink, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogItem, useCatalogItemMutations } from '@hooks/useCatalogItems';

export default function ProductArticleBlock({ product, orgId }) {
  const { isOrgAdmin } = useAuth();
  const itemId = product?.catalog_item_id || null;
  const { item, isLoading } = useCatalogItem(orgId, itemId);
  const { createForProduct, isLinking } = useCatalogItemMutations(orgId);
  const sansPrix = !(Number(product?.purchase_price_ht) > 0);

  const handleCreate = async () => {
    try {
      await createForProduct(product.id);
      toast.success('Article Majord’home créé : la ligne est proposable au devis');
    } catch (err) { toast.error(err?.message || 'Création refusée'); }
  };

  return (
    <section className="space-y-2 pt-3 border-t border-secondary-200">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Article Majord&apos;home</h4>
      {!itemId && (
        <div className="space-y-1.5">
          <p className="text-xs text-secondary-500">
            Cette ligne n&apos;a pas d&apos;article : elle n&apos;apparaît pas dans le devis.
            {sansPrix ? ' Les lignes sans prix d’achat n’en reçoivent pas automatiquement.' : ' Un relevé fournisseur en crée un ; sans relevé, créez-le ici.'}
          </p>
          {isOrgAdmin && (
            <button type="button" onClick={handleCreate} disabled={isLinking || !product?.id} className="btn-secondary btn-sm">
              {isLinking ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />} Créer l&apos;article Majord&apos;home
            </button>
          )}
        </div>
      )}
      {itemId && isLoading && <p className="text-xs text-secondary-400">Chargement…</p>}
      {itemId && !isLoading && item && (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-secondary-900 truncate">{item.name}</p>
            <p className="text-xs text-secondary-400">
              {item.offres_actives} offre{item.offres_actives > 1 ? 's' : ''} active{item.offres_actives > 1 ? 's' : ''}
              {item.fournisseurs?.length ? ` · ${item.fournisseurs.join(', ')}` : ''}
            </p>
          </div>
          <Link to={`/settings/suppliers/articles?item=${item.id}`} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline whitespace-nowrap">
            Ouvrir l&apos;article <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
      {itemId && !isLoading && !item && <p className="text-xs text-amber-700">Article introuvable (fusionné ou supprimé) : le prochain relevé en recrée un.</p>}
    </section>
  );
}
