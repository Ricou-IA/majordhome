// src/apps/artisan/pages/settings/catalogue/ArticlesPage.jsx
// Settings → Fournisseurs → Articles Majord'home : la base du devis de l'org (un article par ligne fournisseur,
// fusionnés quand ils sont communs). Liste filtrée (recherche, catégorie, marque, gamme, sans offre fraîche),
// paginée ; `?item=<id>` ouvre la fiche (ArticleDrawer). Page ouverte au rôle qui a `articles.edit` (team_leader par
// défaut, org_admin compris — Eric 2026-10-27) via `SettingsPage acces` ; l'harmonisation reste réservée à l'org_admin.
// Spec docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md § 5.6.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Loader2, ChevronLeft, ChevronRight, Package, Boxes, Plus, Layers } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useDebounce } from '@hooks/useDebounce';
import { useCatalogItems, useCatalogBrands, useCatalogGammes } from '@hooks/useCatalogItems';
import { PRODUCT_CATEGORIES } from '@services/suppliers.service';
import { formatEuro } from '@/lib/utils';
import { estFrais } from '@/lib/catalogue/ageDePrix.js';
import SettingsPage from '../SettingsPage';
import ArticleDrawer from './ArticleDrawer';
import ArticleStockModal from './ArticleStockModal';
import DevisCreateArticleForm from '../../../components/devis/DevisCreateArticleForm';
import { NATURES_ARTICLE } from '@/lib/catalogue/natures.js';

const PAGE_SIZE = 50;
const SANS_CATEGORIE = '__sans__';
const CATEGORIE_LABELS = Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c.value, c.label]));
const NATURE_LABELS = { main: 'équipement', accessory: 'option', consumable: 'consommable', stock: 'matériel stocké', main_oeuvre: 'main d’œuvre' };

export default function ArticlesPage() {
  const { organization } = useAuth();
  const { can } = useCanAccess();
  const peutCreer = can('articles', 'create');
  const peutCorriger = can('articles', 'edit');
  const orgId = organization?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const itemOuvert = searchParams.get('item');

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [gamme, setGamme] = useState('');
  const [sansOffreFraiche, setSansOffreFraiche] = useState(false);
  const [nature, setNature] = useState('');
  const [page, setPage] = useState(0);
  const [creation, setCreation] = useState(null); // null | 'article' | 'stock'

  useEffect(() => { setPage(0); }, [debounced, category, brand, gamme, sansOffreFraiche, nature]);

  const filtres = useMemo(() => ({
    search: debounced,
    categories: category && category !== SANS_CATEGORIE ? [category] : [],
    sansCategorie: category === SANS_CATEGORIE,
    natures: nature ? [nature] : [],
    brand: brand || null,
    gamme: gamme || null,
    sansOffreFraiche,
    page,
    pageSize: PAGE_SIZE,
  }), [debounced, category, brand, gamme, sansOffreFraiche, nature, page]);

  const { items, count, isLoading, isFetching } = useCatalogItems(orgId, filtres);
  const { brands } = useCatalogBrands(orgId);
  const { gammes } = useCatalogGammes(orgId, category && category !== SANS_CATEGORIE ? [category] : []);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const ouvrir = (id) => setSearchParams(id ? { item: id } : {});

  return (
    <SettingsPage title="Articles Majord'home" acces={{ resource: 'articles', action: 'edit' }} description="La base du devis : un article par ligne fournisseur, fusionnés quand ils sont communs. Au devis, la marge est estimée sur le prix d'achat le plus bas en base ; l'âge du prix est indicatif.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/settings/suppliers" className="text-primary-700 hover:underline">← Fournisseurs</Link>
        {/* créer un article = articles.create (la base refuse aussi) ; le stock rattache aussi des lignes = articles.edit */}
        {peutCreer && <span className="ml-auto flex flex-wrap gap-2">
          {peutCorriger && <button type="button" onClick={() => setCreation('stock')} className="btn-secondary btn-sm"><Layers className="w-3.5 h-3.5 mr-1" /> Article de stock depuis mes achats</button>}
          <button type="button" onClick={() => setCreation(creation === 'article' ? null : 'article')} className="btn-primary btn-sm"><Plus className="w-3.5 h-3.5 mr-1" /> Nouvel article</button>
        </span>}
      </div>

      {peutCreer && creation === 'article' && (
        <DevisCreateArticleForm orgId={orgId} defaultKind="main_oeuvre" submitLabel="Créer l'article"
          onCreated={(item) => { setCreation(null); ouvrir(item.id); }} onCancel={() => setCreation(null)} />
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mots du libellé, marque, modèle, EAN, référence fournisseur…"
              className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <select value={nature} onChange={(e) => setNature(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-2 text-sm" aria-label="Nature">
            <option value="">Toutes les natures</option>
            {NATURES_ARTICLE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setGamme(''); }} className="border border-secondary-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Toutes les catégories</option>
            {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            <option value={SANS_CATEGORIE}>Sans catégorie</option>
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Toutes les marques ({brands.length})</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={gamme} onChange={(e) => setGamme(e.target.value)} className="border border-secondary-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Toutes les gammes ({gammes.length})</option>
            {gammes.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-secondary-700 cursor-pointer">
            <input type="checkbox" checked={sansOffreFraiche} onChange={(e) => setSansOffreFraiche(e.target.checked)} className="w-4 h-4 rounded border-secondary-300 text-primary-600" />
            Sans offre fraîche
          </label>
        </div>

        <div className="flex items-center justify-between text-xs text-secondary-500">
          <span>{count} article{count > 1 ? 's' : ''}{isFetching && !isLoading ? ' · actualisation…' : ''}</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1 rounded hover:bg-secondary-100 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
            <span>page {page + 1} / {pages}</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="p-1 rounded hover:bg-secondary-100 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-secondary-400">
            <Boxes className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucun article pour ces filtres</p>
          </div>
        ) : (
          <div className="divide-y divide-secondary-100">
            {items.map((it) => {
              const frais = estFrais(it.prix_le_plus_recent);
              return (
                <button key={it.id} type="button" onClick={() => ouvrir(it.id)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-secondary-50 px-2 rounded">
                  {it.image_url ? <img src={it.image_url} alt="" className="w-10 h-10 object-contain rounded border border-secondary-100 bg-white flex-shrink-0" />
                    : <div className="w-10 h-10 rounded bg-secondary-100 flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-secondary-400" /></div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-secondary-900 truncate">{it.code && <span className="font-mono text-[11px] text-secondary-500 mr-1">{it.code}</span>}{it.name}</span>
                      {it.brand && <span className="px-1 py-0.5 text-[10px] bg-secondary-100 text-secondary-600 rounded">{it.brand}</span>}
                      {it.category ? <span className="px-1 py-0.5 text-[10px] bg-primary-50 text-primary-700 rounded">{CATEGORIE_LABELS[it.category] || it.category}</span>
                        : <span className="px-1 py-0.5 text-[10px] bg-amber-50 text-amber-700 rounded">sans catégorie</span>}
                      {['stock', 'main_oeuvre'].includes(it.product_kind) && <span className="px-1 py-0.5 text-[10px] bg-secondary-100 text-secondary-700 rounded">{NATURE_LABELS[it.product_kind]}</span>}
                      {it.offres_actives === 0 && it.offres_total > 0 && <span className="px-1 py-0.5 text-[10px] bg-secondary-200 text-secondary-600 rounded">plus au catalogue</span>}
                    </div>
                    <p className="text-xs text-secondary-400 truncate">
                      {it.gamme ? `${it.gamme} · ` : ''}
                      {it.offres_actives} offre{it.offres_actives > 1 ? 's' : ''}{it.fournisseurs?.length ? ` (${it.fournisseurs.join(', ')})` : ''}
                      {it.meilleur_prix_achat != null ? ` · achat ${formatEuro(it.meilleur_prix_achat)}` : ''}
                      {it.offres_actives > 0 && !frais ? ' · aucun prix frais' : ''}
                    </p>
                  </div>
                  <span className={`text-sm w-24 text-right flex-shrink-0 ${Number(it.selling_price_ht) > 0 ? 'text-secondary-900' : 'text-amber-600'}`}>
                    {Number(it.selling_price_ht) > 0 ? formatEuro(it.selling_price_ht) : 'vente à saisir'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {itemOuvert && <ArticleDrawer orgId={orgId} itemId={itemOuvert} onClose={() => ouvrir(null)} />}
      {creation === 'stock' && <ArticleStockModal orgId={orgId} onClose={() => setCreation(null)} onCreated={(id) => ouvrir(id)} />}
    </SettingsPage>
  );
}
