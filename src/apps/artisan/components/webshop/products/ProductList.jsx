/** ProductList — une ligne par produit ; Visible / Mis en avant se basculent au clic. */
import { Package, Star, Copy, ImageOff } from 'lucide-react';
import { resolveImageUrl } from '@/lib/webshop/catalog';

const euros = (n) => `${Number(n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

export default function ProductList({ products, categoriesById, siteUrl, canEdit, onOpen, onToggle, onDuplicate }) {
  if (products.length === 0) {
    return <div className="text-center py-12 text-secondary-500 text-sm">Aucun produit ne correspond.</div>;
  }
  return (
    <div className="bg-white border border-secondary-200 rounded-xl divide-y divide-secondary-100">
      {products.map((p) => {
        const thumb = resolveImageUrl(Array.isArray(p.images) ? p.images[0] : null, siteUrl);
        const outOfStock = (p.stock_qty ?? 0) <= 0 && !p.allow_backorder;
        const noPhoto = !Array.isArray(p.images) || p.images.length === 0;
        return (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary-50 cursor-pointer" onClick={() => onOpen(p)}>
            <div className="w-12 h-12 rounded-lg bg-secondary-100 overflow-hidden flex items-center justify-center shrink-0">
              {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-secondary-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium truncate ${p.is_active ? 'text-secondary-900' : 'text-secondary-400'}`}>{p.name}</p>
              <p className="text-xs text-secondary-500 truncate">
                {[p.brand, categoriesById.get(p.category_id)?.name].filter(Boolean).join(' · ') || '—'}
                {!p.shipping_kind && <span className="ml-2 text-secondary-400">hors boutique</span>}
                {noPhoto && (
                  <span className="inline-flex items-center gap-0.5 ml-2 text-amber-600"><ImageOff className="w-3 h-3" /> sans photo</span>
                )}
              </p>
            </div>
            <div className="w-24 text-right text-sm font-semibold text-secondary-900">{euros(p.price_ttc)}</div>
            <div className="w-24 text-right">
              <span className={`text-xs px-2 py-0.5 rounded-full ${outOfStock ? 'bg-amber-100 text-amber-800' : 'bg-secondary-100 text-secondary-600'}`}>
                {outOfStock ? 'Rupture' : `Stock ${p.stock_qty ?? 0}`}
              </span>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onToggle(p, 'is_featured')}
                title={p.is_featured ? 'Retirer de la mise en avant' : 'Mettre en avant'}
                className="p-1.5 rounded hover:bg-secondary-100 disabled:cursor-default"
              >
                <Star className={`w-4 h-4 ${p.is_featured ? 'fill-amber-400 text-amber-400' : 'text-secondary-300'}`} />
              </button>
              <label className={`flex items-center gap-1.5 text-xs text-secondary-600 px-1.5 ${canEdit ? 'cursor-pointer' : ''}`}>
                <input type="checkbox" checked={p.is_active} disabled={!canEdit} onChange={() => onToggle(p, 'is_active')} className="rounded border-secondary-300" />
                Visible
              </label>
              {canEdit && (
                <button type="button" onClick={() => onDuplicate(p)} title="Dupliquer" className="p-1.5 rounded text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700">
                  <Copy className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
