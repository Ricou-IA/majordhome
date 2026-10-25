// src/apps/artisan/pages/settings/catalogue/ArticleAttachModal.jsx
// « Rattacher une ligne fournisseur » à un article Majord'home. La recherche reste EN HAUT ; dessous, une seule liste :
// les correspondances proposées (module pur suggestions.js : même marque, référence fabricant identique ou à un suffixe
// près, libellé proche, prix du même ordre, avec leurs raisons) tant qu'on ne cherche rien, les résultats dès qu'on
// tape (retours d'Eric, 2026-10-25). Chaque ligne fournisseur a déjà son article (rattachement automatique) : on ne
// signale que celle qui quitterait un article regroupant d'autres lignes (avertissementDepart).
// RPC catalog_item_attach (org_admin) : la ligne quitte son article précédent, un article vidé est désactivé.
import { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, Link2, Sparkles } from 'lucide-react';
import { suppliersService } from '@services/suppliers.service';
import { useDebounce } from '@hooks/useDebounce';
import { useCatalogItemsResume } from '@hooks/useCatalogItems';
import { formatEuro } from '@/lib/utils';
import { suggestions as classer, avertissementDepart } from '@/lib/catalogue/suggestions.js';

/** Mots servant à chercher des candidats : la marque, sinon les deux premiers mots significatifs du libellé. */
function requeteCandidats(item) {
  if (item.brand) return item.brand;
  return String(item.name || '').split(/\s+/).filter((m) => m.length >= 4).slice(0, 2).join(' ');
}

function LigneCandidate({ p, raisons, avertissement, onAttach, attaching }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-secondary-100 hover:border-secondary-200">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-secondary-900 break-words">{p.name}</p>
        <p className="text-xs text-secondary-400 break-words">{[p.supplier_name, p.reference].filter(Boolean).join(' · ')}</p>
        {(raisons?.length > 0 || avertissement) && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {(raisons || []).map((r) => <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700">{r}</span>)}
            {avertissement && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{avertissement}</span>}
          </div>
        )}
      </div>
      <span className="text-xs text-secondary-600 whitespace-nowrap">{p.purchase_price_ht > 0 ? formatEuro(p.purchase_price_ht) : '—'}</span>
      <button type="button" onClick={() => onAttach(p.id)} disabled={attaching} className="btn-secondary btn-sm">
        {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5 mr-1" />} Rattacher
      </button>
    </div>
  );
}

/**
 * @param {{ orgId: string, item: any, offers?: Array<{ reference?: string, product_id: string }>, onClose: () => void,
 *   onAttach: (productId: string) => Promise<void>, attaching?: boolean }} p
 */
export default function ArticleAttachModal({ orgId, item, offers = [], onClose, onAttach, attaching = false }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [chargementSugg, setChargementSugg] = useState(true);
  const cherche = debounced.trim().length >= 2;

  // candidats des suggestions : lignes de la même marque (ou du même libellé), une fois à l'ouverture
  useEffect(() => {
    let cancelled = false;
    const q = requeteCandidats(item);
    if (!q) { setChargementSugg(false); return undefined; }
    suppliersService.searchProductsMots(orgId, q, { limit: 300 }).then(({ data }) => {
      if (!cancelled) { setCandidats(data || []); setChargementSugg(false); }
    });
    return () => { cancelled = true; };
  }, [orgId, item]);

  const idsOffres = useMemo(() => new Set(offers.map((o) => o.product_id)), [offers]);
  const sugg = useMemo(() => classer(
    { id: item.id, name: item.name, brand: item.brand, model_key: item.model_key, references: offers.map((o) => o.reference).filter(Boolean), prix: item.meilleur_prix_achat },
    candidats.filter((p) => !idsOffres.has(p.id)),
    { max: 8 },
  ), [item, offers, candidats, idsOffres]);

  useEffect(() => {
    let cancelled = false;
    if (!cherche) { setResults([]); return undefined; }
    setLoading(true);
    suppliersService.searchProductsMots(orgId, debounced.trim()).then(({ data }) => {
      if (!cancelled) { setResults((data || []).filter((p) => p.catalog_item_id !== item.id)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [debounced, cherche, orgId, item.id]);

  // une seule liste : résultats de la recherche, sinon correspondances proposées
  const lignes = useMemo(() => (cherche ? results.map((p) => ({ ligne: p, raisons: [] })) : sugg), [cherche, results, sugg]);
  const { articles } = useCatalogItemsResume(orgId, lignes.map((l) => l.ligne.catalog_item_id));
  const enCours = cherche ? loading : chargementSugg;

  return (
    // écran large : la fenêtre se range à GAUCHE de la fiche article (max-w-3xl = 48rem), sans la masquer (Eric)
    <div className="fixed inset-y-0 left-0 right-0 xl:right-[48rem] z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-3 pb-3 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-secondary-900">Rattacher une ligne fournisseur</h3>
              <p className="text-xs text-secondary-400 break-words">à « {item.name} »</p>
            </div>
            <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded"><X className="w-5 h-5 text-secondary-500" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher une autre ligne : libellé, référence, marque…" autoFocus
              className="w-full pl-10 pr-9 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary-100 rounded" title="Revenir aux correspondances proposées">
                <X className="w-3.5 h-3.5 text-secondary-400" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 flex items-center gap-1.5">
            {cherche ? `Résultats${!enCours ? ` (${lignes.length})` : ''}` : <><Sparkles className="w-3.5 h-3.5" /> Correspondances proposées</>}
          </h4>
          {enCours && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary-600" /></div>}
          {!enCours && lignes.length === 0 && (
            <p className="text-sm text-secondary-400 py-4">{cherche ? 'Aucune ligne fournisseur trouvée.' : 'Aucune correspondance évidente : cherchez ci-dessus.'}</p>
          )}
          {!enCours && lignes.map((s) => (
            <LigneCandidate key={s.ligne.id} p={s.ligne} raisons={s.raisons} avertissement={avertissementDepart(s.ligne, articles)}
              onAttach={onAttach} attaching={attaching} />
          ))}
        </div>
      </div>
    </div>
  );
}
