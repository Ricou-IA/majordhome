// src/apps/artisan/pages/settings/product-detail/ProductMatchesBlock.jsx
// Bloc « Aussi chez » du drawer produit : le même article chez les autres fournisseurs (rapprochements confirmés ou
// proposés), prix d'achat et écart ; confirmation / refus d'une proposition ; rapprochement manuel par recherche.
// Spec : 2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 7.
import { useState } from 'react';
import { Link2, Check, X, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useProductMatches, useCatalogMatches } from '@hooks/useSuppliers';
import { suppliersService } from '@services/suppliers.service';
import { autreCote, libelleAussiChez } from '@/lib/catalogue/matchesModel.js';

export default function ProductMatchesBlock({ product, orgId }) {
  const { isOrgAdmin } = useAuth();
  const { matches, isLoading } = useProductMatches(orgId, product?.id);
  const { setStatus, createMatch, isDeciding } = useCatalogMatches(orgId, null);
  const [recherche, setRecherche] = useState('');
  const [candidats, setCandidats] = useState([]);
  const [cherche, setCherche] = useState(false);
  if (!product) return null;

  const cotes = matches.map((m) => autreCote(m, product.id)).filter(Boolean);

  const decider = async (matchId, statut) => {
    try {
      await setStatus([matchId], statut);
      toast.success(statut === 'confirme' ? 'Rapprochement confirmé' : 'Rapprochement refusé');
    } catch (err) {
      toast.error(err?.message || 'Décision refusée');
    }
  };

  const chercher = async (e) => {
    e.preventDefault();
    if (recherche.trim().length < 2) return;
    setCherche(true);
    const { data } = await suppliersService.searchProducts(orgId, recherche.trim());
    setCandidats((data || []).filter((p) => p.supplier_id !== product.supplier_id && p.id !== product.id).slice(0, 8));
    setCherche(false);
  };

  const rapprocher = async (autre) => {
    try {
      await createMatch(product.id, autre.id);
      setCandidats([]);
      setRecherche('');
      toast.success(`Rapproché de ${autre.name} (${autre.supplier_name})`);
    } catch (err) {
      toast.error(err?.message || 'Rapprochement refusé');
    }
  };

  return (
    <section className="mt-6 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary-500 flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" /> Aussi chez
      </h3>
      {isLoading ? (
        <p className="text-xs text-secondary-400">Recherche des articles communs…</p>
      ) : cotes.length === 0 ? (
        <p className="text-xs text-secondary-400">Aucun autre fournisseur connu pour cet article.</p>
      ) : (
        <ul className="space-y-1">
          {cotes.map((c) => (
            <li key={c.matchId} className="flex items-center justify-between gap-3 text-sm">
              <span className={c.statut === 'propose' ? 'text-amber-700' : 'text-secondary-800'}>
                {libelleAussiChez(c)}
                {c.reference ? <span className="text-xs text-secondary-400"> · réf. {c.reference}</span> : null}
                {c.statut === 'propose' && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-600">à confirmer</span>}
              </span>
              {isOrgAdmin && c.statut === 'propose' && (
                <span className="flex gap-1 shrink-0">
                  <button type="button" disabled={isDeciding} onClick={() => decider(c.matchId, 'confirme')} className="p-1 rounded hover:bg-emerald-50 text-emerald-700" title="Confirmer"><Check className="w-4 h-4" /></button>
                  <button type="button" disabled={isDeciding} onClick={() => decider(c.matchId, 'refuse')} className="p-1 rounded hover:bg-red-50 text-red-600" title="Refuser"><X className="w-4 h-4" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOrgAdmin && (
        <form onSubmit={chercher} className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Même article chez un autre fournisseur… (nom ou référence)" className="w-full pl-8 pr-2 py-1.5 border border-secondary-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <button type="submit" disabled={cherche || recherche.trim().length < 2} className="btn-secondary btn-sm">
            {cherche ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Chercher'}
          </button>
        </form>
      )}
      {candidats.length > 0 && (
        <ul className="rounded-lg border border-secondary-200 divide-y divide-secondary-100">
          {candidats.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
              <span className="min-w-0 truncate"><span className="font-medium text-secondary-800">{c.name}</span> <span className="text-secondary-400">· {c.supplier_name} · {c.reference || '—'}</span></span>
              <button type="button" disabled={isDeciding} onClick={() => rapprocher(c)} className="text-primary-700 hover:underline shrink-0">Même article</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
