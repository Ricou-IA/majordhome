// src/apps/artisan/pages/settings/catalogue/ArticleOffersTable.jsx
// Offres d'un article Majord'home = ses lignes fournisseur (vue majordhome_catalog_item_offers) : fournisseur,
// référence, prix d'achat, âge du prix (frais < 30 j), stock relevé, origine du lien, « Détacher » (org_admin).
import { Unlink, Loader2 } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { estFrais, libelleAge } from '@/lib/catalogue/ageDePrix.js';

const LIEN_LABELS = { auto: 'auto', cle: 'clé modèle', ean: 'EAN', ia: 'IA', manuel: 'manuel' };

function stockLabel(o) {
  if (o.stock_qty != null) return o.stock_qty > 0 ? `${o.stock_qty} en stock` : 'rupture';
  if (o.en_stock === true) return 'en stock';
  if (o.en_stock === false) return 'rupture';
  return 'stock inconnu';
}

/**
 * @param {{ offers: any[], canEdit: boolean, onDetach: (productId: string) => void, detaching?: boolean }} p
 */
export default function ArticleOffersTable({ offers, canEdit, onDetach, detaching = false }) {
  if (!offers.length) {
    return <p className="text-sm text-secondary-400">Aucune ligne fournisseur rattachée : cet article n&apos;est plus proposé au devis.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200">
            <th className="py-1.5 pr-3 font-medium">Fournisseur</th>
            <th className="py-1.5 pr-3 font-medium">Référence</th>
            <th className="py-1.5 pr-3 font-medium text-right">Achat HT</th>
            <th className="py-1.5 pr-3 font-medium">Prix</th>
            <th className="py-1.5 pr-3 font-medium">Stock</th>
            <th className="py-1.5 pr-3 font-medium">Lien</th>
            {canEdit && <th className="py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const frais = estFrais(o.purchase_price_at);
            return (
              <tr key={o.product_id} className={`border-b border-secondary-100 ${o.is_active ? '' : 'opacity-50'}`}>
                <td className="py-1.5 pr-3 text-secondary-900">
                  {o.supplier_name}
                  {!o.is_active && <span className="ml-1 text-[10px] text-secondary-400">(inactive)</span>}
                </td>
                <td className="py-1.5 pr-3 text-secondary-600 font-mono text-xs" title={o.name}>{o.reference}</td>
                <td className="py-1.5 pr-3 text-right text-secondary-900 whitespace-nowrap">{o.purchase_price_ht > 0 ? formatEuro(o.purchase_price_ht) : '—'}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1 text-xs ${frais ? 'text-green-700' : 'text-amber-700'}`} title={frais ? 'Prix de moins de 30 jours' : 'Prix de plus de 30 jours : à vérifier avant commande (indicatif, ne change rien au devis)'}>
                    <span className={`w-1.5 h-1.5 rounded-full ${frais ? 'bg-green-500' : 'bg-amber-500'}`} />
                    {libelleAge(o.purchase_price_at)}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-xs text-secondary-600">{stockLabel(o)}</td>
                <td className="py-1.5 pr-3 text-xs text-secondary-500">{LIEN_LABELS[o.link_source] || o.link_source || '—'}</td>
                {canEdit && (
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => onDetach(o.product_id)} disabled={detaching}
                      className="inline-flex items-center gap-1 text-xs text-secondary-500 hover:text-red-700" title="Détacher : cette ligne reçoit son propre article">
                      {detaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} Détacher
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
