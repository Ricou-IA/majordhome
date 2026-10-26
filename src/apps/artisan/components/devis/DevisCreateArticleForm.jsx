/**
 * DevisCreateArticleForm.jsx — Créer un article Majord'home sans quitter le devis (org_admin)
 * ============================================================================
 * Décision d'Eric (2026-10-25) : « les articles devraient pouvoir être créés depuis les devis ». L'article créé reste
 * dans la base pour les devis suivants ; la nature et la catégorie sont pré-remplies d'après le chapitre.
 * ============================================================================
 */

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { useCatalogItemMutations } from '@hooks/useCatalogItems';
import { NATURES_ARTICLE } from '@/lib/catalogue/natures.js';

const INPUT = 'w-full px-2.5 py-1.5 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

/**
 * @param {{ orgId: string, defaultKind?: string, defaultCategory?: string|null, defaultName?: string,
 *   onCreated: (item: object) => void, onCancel: () => void }} p
 */
export default function DevisCreateArticleForm({ orgId, defaultKind = 'main', defaultCategory = null, defaultName = '', submitLabel = 'Créer et ajouter au devis', onCreated, onCancel }) {
  const { createItem, isCreating } = useCatalogItemMutations(orgId);
  const [form, setForm] = useState({
    code: '', name: defaultName, brand: '', category: defaultCategory || '', productKind: defaultKind,
    unit: defaultKind === 'main_oeuvre' ? 'forfait' : 'pièce', sellingPriceHt: '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Le libellé est requis'); return; }
    try {
      const item = await createItem({ ...form, category: form.category || null });
      toast.success('Article créé : il reste dans la base pour les prochains devis');
      onCreated(item);
    } catch (err) { toast.error(err?.message || 'Création refusée'); }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2">
      <p className="text-xs font-semibold text-secondary-700">Nouvel article Majord&apos;home</p>
      <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Libellé (ce que voit le client) *" className={INPUT} />
      <input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="Référence interne (ex. ME-POE-0042)" className={INPUT} aria-label="Référence interne" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <select value={form.productKind} onChange={(e) => set('productKind', e.target.value)} className={INPUT} aria-label="Nature">
          {NATURES_ARTICLE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
        </select>
        <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Marque" className={INPUT} />
        <select value={form.category} onChange={(e) => set('category', e.target.value)} className={INPUT} aria-label="Catégorie">
          <option value="">Sans catégorie</option>
          {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={form.unit} onChange={(e) => set('unit', e.target.value)} className={INPUT} aria-label="Unité">
          {PRODUCT_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
        <input type="number" min="0" step="0.01" value={form.sellingPriceHt} onChange={(e) => set('sellingPriceHt', e.target.value)} placeholder="Prix de vente HT" className={INPUT} />
      </div>
      <p className="text-[11px] text-secondary-500">Les références fournisseur se rattachent ensuite depuis la fiche article (Paramètres → Fournisseurs → Articles).</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Annuler</button>
        <button type="submit" disabled={isCreating} className="btn-primary btn-sm">
          {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
