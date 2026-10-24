// src/apps/artisan/pages/settings/product-detail/ProductArticleBlock.jsx
// Bloc « Article Majord'home » du drawer d'une ligne fournisseur : l'article auquel la ligne est rattachée, ses
// offres, et le lien vers la fiche article (où se corrigent libellé, catégorie, prix de vente, photo).
import { Link } from 'react-router-dom';
import { Boxes, ExternalLink } from 'lucide-react';
import { useCatalogItem } from '@hooks/useCatalogItems';

export default function ProductArticleBlock({ product, orgId }) {
  const itemId = product?.catalog_item_id || null;
  const { item, isLoading } = useCatalogItem(orgId, itemId);
  return (
    <section className="space-y-2 pt-3 border-t border-secondary-200">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Article Majord&apos;home</h4>
      {!itemId && (
        <p className="text-xs text-secondary-400">Pas encore d&apos;article : il est créé au prochain relevé (ligne active) ou par le bouton « Rattacher » d&apos;une fiche article.</p>
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
