// src/apps/artisan/pages/settings/suppliers/CatalogMatchesPage.jsx
// Settings → Fournisseurs → Rapprochements : les articles communs entre fournisseurs. Onglet « À confirmer »
// (propositions automatiques ambiguës, cases à cocher, « Tout confirmer » / « Refuser »), onglet « Confirmés »,
// onglet « Refusés ». La machine propose, l'humain tranche en lot, jamais un par un (spec tranche 2 § 7).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Loader2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useCatalogMatches } from '@hooks/useSuppliers';
import { trierParEcart, formatPrixHt } from '@/lib/catalogue/matchesModel.js';

const ONGLETS = [
  { value: 'propose', label: 'À confirmer' },
  { value: 'confirme', label: 'Confirmés' },
  { value: 'refuse', label: 'Refusés' },
];

function pct(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${String(n).replace('.', ',')} %`;
}

export default function CatalogMatchesPage() {
  const { organization, isOrgAdmin } = useAuth();
  const orgId = organization?.id;
  const [statut, setStatut] = useState('propose');
  const { matches, isLoading, setStatus, isDeciding } = useCatalogMatches(orgId, statut);
  const [coches, setCoches] = useState(() => new Set());
  const liste = useMemo(() => trierParEcart(matches), [matches]);
  const tous = liste.length > 0 && liste.every((m) => coches.has(m.id));

  const basculer = (id) => setCoches((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const basculerTous = () => setCoches(tous ? new Set() : new Set(liste.map((m) => m.id)));

  const decider = async (ids, s) => {
    if (!ids.length) return;
    try {
      const n = await setStatus(ids, s);
      setCoches(new Set());
      toast.success(`${n} rapprochement${n > 1 ? 's' : ''} ${s === 'confirme' ? 'confirmé' : 'refusé'}${n > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err?.message || 'Décision refusée');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-secondary-500">
        <Link to="/settings" className="hover:text-secondary-700">Paramètres</Link>
        <span>/</span>
        <Link to="/settings/suppliers" className="hover:text-secondary-700">Fournisseurs</Link>
        <span>/</span>
        <span className="text-secondary-900">Rapprochements</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-2"><Link2 className="w-6 h-6 text-primary-600" /> Articles communs entre fournisseurs</h1>
        <p className="text-secondary-600">Même marque et même modèle fabricant chez deux fournisseurs. Les cas évidents sont confirmés tout seuls ; ici, ceux qui demandent un regard.</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-1 border-b border-secondary-200">
          {ONGLETS.map((o) => (
            <button key={o.value} type="button" onClick={() => { setStatut(o.value); setCoches(new Set()); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${statut === o.value ? 'border-primary-500 text-primary-700' : 'border-transparent text-secondary-500 hover:text-secondary-700'}`}>
              {o.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-secondary-400 pr-2">{liste.length} paire{liste.length > 1 ? 's' : ''}</span>
        </div>

        {isOrgAdmin && statut !== 'confirme' && liste.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-secondary-700"><input type="checkbox" checked={tous} onChange={basculerTous} /> Tout sélectionner</label>
            <button type="button" disabled={isDeciding || !coches.size} onClick={() => decider([...coches], 'confirme')} className="btn-primary btn-sm">
              {isDeciding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />} Confirmer ({coches.size})
            </button>
            {statut === 'propose' && (
              <button type="button" disabled={isDeciding || !coches.size} onClick={() => decider([...coches], 'refuse')} className="btn-secondary btn-sm">
                <X className="w-3.5 h-3.5 mr-1" /> Refuser ({coches.size})
              </button>
            )}
            {statut === 'propose' && (
              <button type="button" disabled={isDeciding || !liste.length} onClick={() => decider(liste.map((m) => m.id), 'confirme')} className="btn-secondary btn-sm ml-auto">
                Tout confirmer
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>
        ) : liste.length === 0 ? (
          <p className="text-center py-10 text-sm text-secondary-500">{statut === 'propose' ? 'Rien à confirmer.' : 'Aucun rapprochement.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-left text-secondary-500">
                  {isOrgAdmin && statut !== 'confirme' && <th className="py-2 pr-2 w-6" />}
                  <th className="py-2 pr-3 font-medium">Modèle</th>
                  <th className="py-2 pr-3 font-medium">Fournisseur A</th>
                  <th className="py-2 pr-3 font-medium text-right">Achat A</th>
                  <th className="py-2 pr-3 font-medium">Fournisseur B</th>
                  <th className="py-2 pr-3 font-medium text-right">Achat B</th>
                  <th className="py-2 pr-3 font-medium text-right">Écart</th>
                  {isOrgAdmin && statut === 'confirme' && <th className="py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {liste.map((m) => (
                  <tr key={m.id} className="border-b border-secondary-100 align-top">
                    {isOrgAdmin && statut !== 'confirme' && <td className="py-2 pr-2"><input type="checkbox" checked={coches.has(m.id)} onChange={() => basculer(m.id)} /></td>}
                    <td className="py-2 pr-3"><span className="font-mono text-xs text-secondary-700">{m.model_key || '—'}</span><div className="text-xs text-secondary-400">{m.motif}</div></td>
                    <td className="py-2 pr-3"><div className="font-medium text-secondary-900">{m.product_a_name}</div><div className="text-xs text-secondary-400">{m.supplier_a_name} · {m.product_a_reference || '—'}</div></td>
                    <td className="py-2 pr-3 text-right text-secondary-700 whitespace-nowrap">{formatPrixHt(m.product_a_purchase)}</td>
                    <td className="py-2 pr-3"><div className="font-medium text-secondary-900">{m.product_b_name}</div><div className="text-xs text-secondary-400">{m.supplier_b_name} · {m.product_b_reference || '—'}</div></td>
                    <td className="py-2 pr-3 text-right text-secondary-700 whitespace-nowrap">{formatPrixHt(m.product_b_purchase)}</td>
                    <td className={`py-2 pr-3 text-right whitespace-nowrap ${Math.abs(Number(m.ecart_pct)) >= 20 ? 'text-amber-700 font-medium' : 'text-secondary-700'}`}>{pct(m.ecart_pct)}</td>
                    {isOrgAdmin && statut === 'confirme' && (
                      <td className="py-2 text-right"><button type="button" disabled={isDeciding} onClick={() => decider([m.id], 'refuse')} className="p-1 rounded hover:bg-red-50 text-red-500" title="Ce n'est pas le même article"><X className="w-4 h-4" /></button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
