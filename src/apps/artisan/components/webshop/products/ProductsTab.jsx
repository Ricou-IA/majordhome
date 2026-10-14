/** ProductsTab — catalogue boutique : recherche, filtre catégorie, liste, drawer. */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Loader2, Search, Lock } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useWebshopCatalog } from '@hooks/useWebshop';
import { duplicatePayload, nextDisplayOrder } from '@/lib/webshop/catalog';
import { inputClass, selectClass } from '@apps/artisan/components/FormFields';
import ProductList from './ProductList';
import ProductDrawer from './ProductDrawer';
import SiteUrlSetting from './SiteUrlSetting';

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function ProductsTab() {
  const { isOrgAdmin } = useAuth();
  const { settings } = useOrgSettings();
  const siteUrl = settings?.webshop?.site_url ?? null;
  const { orgId, products, categories, isLoading, error, createProduct, updateProduct, isSaving } = useWebshopCatalog();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [drawer, setDrawer] = useState(null); // null | { product: object|null }

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filtered = useMemo(() => {
    const q = fold(query).trim();
    const inCategory = (p) => !categoryId || p.category_id === categoryId || categoriesById.get(p.category_id)?.parent_id === categoryId;
    return products.filter((p) => inCategory(p) && (!q || [p.name, p.brand, p.supplier_ref].some((v) => fold(v).includes(q))));
  }, [products, query, categoryId, categoriesById]);

  const handleToggle = async (p, field) => {
    try {
      await updateProduct({ id: p.id, patch: { [field]: !p[field] } });
      if (field === 'is_active') toast.success(p.is_active ? 'Produit masqué sur le site' : 'Produit visible sur le site');
      else toast.success(p.is_featured ? 'Retiré de la mise en avant' : 'Mis en avant');
    } catch (err) {
      toast.error(`Modification refusée : ${err.message}`);
    }
  };

  const handleDuplicate = async (p) => {
    try {
      const copy = await createProduct(duplicatePayload(p, orgId, products.map((x) => x.slug), nextDisplayOrder(products)));
      toast.success('Copie créée (masquée) — ajoutez ses photos');
      setDrawer({ product: copy });
    } catch (err) {
      toast.error(`Duplication refusée : ${err.message}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-secondary-400" /></div>;
  if (error) return <div className="text-center py-12 text-red-600 text-sm">Chargement du catalogue impossible : {error.message}</div>;

  const roots = categories.filter((c) => !c.parent_id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SiteUrlSetting canEdit={isOrgAdmin} />
        {isOrgAdmin ? (
          <button type="button" onClick={() => setDrawer({ product: null })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            <Plus className="w-4 h-4" /> Nouveau produit
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-secondary-500"><Lock className="w-3.5 h-3.5" /> Lecture seule — modification réservée à l’administrateur</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit, une marque, une référence" className={`${inputClass} pl-9 w-80`} />
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${selectClass} w-64`}>
          <option value="">Toutes les catégories</option>
          {roots.map((r) => (
            <optgroup key={r.id} label={r.name}>
              <option value={r.id}>{r.name} (tout)</option>
              {categories.filter((c) => c.parent_id === r.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="self-center text-xs text-secondary-500">{filtered.length} / {products.length} produit(s)</span>
      </div>

      <ProductList
        products={filtered}
        categoriesById={categoriesById}
        siteUrl={siteUrl}
        canEdit={isOrgAdmin}
        onOpen={(p) => setDrawer({ product: p })}
        onToggle={handleToggle}
        onDuplicate={handleDuplicate}
      />

      {drawer && (
        <ProductDrawer
          key={drawer.product?.id ?? 'new'}
          product={drawer.product}
          products={products}
          categories={categories}
          orgId={orgId}
          siteUrl={siteUrl}
          canEdit={isOrgAdmin}
          onClose={() => setDrawer(null)}
          createProduct={createProduct}
          updateProduct={updateProduct}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
