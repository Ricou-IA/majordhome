// src/apps/clim/components/ResultatPanel.jsx
// Résultat vivant du dimensionnement : besoin par pièce, proposition mono ou multi (bascule),
// postes avec prix d'achat et « à chiffrer », alertes. Ne calcule rien : affiche le résultat du moteur.
import { AlertTriangle, Info, FileText } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

const kw = (w) => `${(w / 1000).toFixed(1).replace('.', ',')} kW`;
const kwN = (v) => `${String(v).replace('.', ',')} kW`;

function Alerte({ a }) {
  const grave = a.niveau === 'alerte';
  return (
    <li className={`flex gap-2 text-sm rounded-lg px-3 py-2 ${grave ? 'bg-amber-50 text-amber-900' : 'bg-secondary-50 text-secondary-700'}`}>
      {grave ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <Info className="w-4 h-4 mt-0.5 shrink-0" />}
      <span>{a.piece ? <b>{a.piece} · </b> : null}{a.message}</span>
    </li>
  );
}

export default function ResultatPanel({ resultat, mode, onMode, onCreerDevis, peutCreerDevis }) {
  if (!resultat) return null;
  if (!resultat.ok) {
    return (
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">Résultat</h2>
        <p className="text-sm text-secondary-600">Complétez le relevé pour obtenir le dimensionnement :</p>
        <ul className="text-sm text-secondary-700 list-disc pl-5">{resultat.erreurs.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    );
  }
  const multiPossible = !!resultat.multi?.groupe;
  const proposition = mode === 'multi' && multiPossible ? resultat.multi : resultat.mono;
  const equipements = proposition.postes.filter((p) => !p.article.liquide);
  const accessoires = proposition.postes.filter((p) => p.article.liquide);
  const aChiffrer = proposition.postes.filter((p) => !(p.article.selling_price_ht > 0)).length;

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">Besoin par pièce</h2>
        <table className="w-full text-sm">
          <thead className="text-xs text-secondary-500">
            <tr><th className="text-left font-medium py-1">Pièce</th><th className="text-right font-medium">Besoin</th><th className="text-right font-medium">Contrôle volume</th><th className="text-right font-medium">Unité</th></tr>
          </thead>
          <tbody>
            {resultat.pieces.map((p) => {
              const u = mode === 'multi' && multiPossible ? p.multi.unite : p.mono.unite;
              return (
                <tr key={p.nom} className="border-t border-secondary-100">
                  <td className="py-1.5">{p.nom}<span className="text-xs text-secondary-400"> · {p.detail.surface_m2} m²</span></td>
                  <td className="text-right font-semibold text-secondary-900">{kw(p.besoin_w)}</td>
                  <td className="text-right text-secondary-500">{kwN(p.controle.kw)}</td>
                  <td className="text-right">{u ? kwN(u.kw_froid) : <span className="text-amber-700">aucune</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-secondary-500">Contrôle volume = 100 BTU/m³ + 1 000 BTU par paroi vitrée. Un écart important entre les deux colonnes signale un relevé à revoir.</p>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">Proposition · {resultat.gamme}</h2>
          {resultat.pieces.length >= 2 && (
            <div className="flex rounded-lg border border-secondary-200 overflow-hidden text-sm">
              <button type="button" onClick={() => onMode('mono')} className={`px-3 py-1.5 ${mode !== 'multi' ? 'bg-primary-500 text-white' : 'text-secondary-600 hover:bg-secondary-50'}`}>Mono-split</button>
              <button type="button" onClick={() => onMode('multi')} disabled={!multiPossible} className={`px-3 py-1.5 ${mode === 'multi' ? 'bg-primary-500 text-white' : 'text-secondary-600 hover:bg-secondary-50 disabled:opacity-40'}`} title={multiPossible ? '' : 'Aucun groupe compatible'}>Multi-split</button>
            </div>
          )}
        </div>
        {mode === 'multi' && multiPossible && (
          <p className="text-xs text-secondary-500">Groupe {resultat.multi.groupe.reference} · {kwN(resultat.multi.groupe.kw_froid)} froid pour {kwN(resultat.multi.somme_kw)} d’unités intérieures ({Math.round(resultat.multi.ratio * 100)} %).</p>
        )}
        <Postes titre="Équipement" postes={equipements} />
        <Postes titre="Accessoires" postes={accessoires} />
        <div className="flex items-center justify-between border-t border-secondary-200 pt-3 text-sm">
          <span className="text-secondary-600">Achat HT (DEEE incluse)</span>
          <span className="font-semibold text-secondary-900">{formatEuro(proposition.total_achat_ht)}</span>
        </div>
        {aChiffrer > 0 && <p className="text-xs text-amber-700">{aChiffrer} article{aChiffrer > 1 ? 's' : ''} sans prix de vente : à renseigner dans Paramètres → Fournisseurs, ou directement sur le devis.</p>}
        <button type="button" onClick={onCreerDevis} disabled={!peutCreerDevis || proposition.postes.length === 0} className="btn-primary w-full flex items-center justify-center gap-2" title={peutCreerDevis ? '' : 'Ouvrez cette page depuis la fiche d\'un lead pour créer le devis'}>
          <FileText className="w-4 h-4" /> Créer le devis
        </button>
      </section>

      {resultat.alertes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">À vérifier</h2>
          <ul className="space-y-1.5">{resultat.alertes.map((a, i) => <Alerte key={`${a.code}-${a.piece || ''}-${i}`} a={a} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Postes({ titre, postes }) {
  if (!postes.length) return null;
  return (
    <div>
      <h3 className="text-xs font-medium text-secondary-500 mb-1">{titre}</h3>
      <ul className="divide-y divide-secondary-100">
        {postes.map((p, i) => (
          <li key={`${p.article.id}-${i}`} className="flex items-start justify-between gap-3 py-1.5 text-sm">
            <div className="min-w-0">
              <div className="text-secondary-900 truncate">{p.quantite > 1 ? `${p.quantite} × ` : ''}{p.article.name}</div>
              <div className="text-xs text-secondary-400">{p.article.reference}{p.piece ? ` · ${p.piece}` : ''}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-secondary-700">{formatEuro(p.article.purchase_price_ht * p.quantite)}</div>
              <div className="text-xs">{p.article.selling_price_ht > 0 ? <span className="text-secondary-400">vente {formatEuro(p.article.selling_price_ht * p.quantite)}</span> : <span className="text-amber-700">à chiffrer</span>}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
