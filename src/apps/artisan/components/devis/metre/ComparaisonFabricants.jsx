// src/apps/artisan/components/devis/metre/ComparaisonFabricants.jsx
// Le même relevé chiffré chez chaque fabricant reconnu (comparerFabricants du moteur) : rendu pur, choix du
// fabricant injecté. Jamais de « moins cher » quand une colonne a des pièces à chiffrer ou ambiguës, et chaque
// réserve est écrite (équivalence non validée, base de prix non vérifiée).
import { AlertTriangle, Check } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

export default function ComparaisonFabricants({ comparaison, choisi, onChoisir }) {
  if (!comparaison || comparaison.colonnes.length < 2) return null;
  return (
    <section className="border border-secondary-200 rounded-xl bg-white p-4">
      <h3 className="text-xs uppercase tracking-wide text-secondary-500 mb-1">Comparaison des fabricants · même relevé</h3>
      <p className="text-xs text-secondary-600 mb-3">
        {comparaison.complete
          ? 'Les deux nomenclatures sont complètes.'
          : 'Comparaison incomplète : un fabricant a des pièces à chiffrer ou ambiguës, aucun n’est désigné moins cher.'}
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${comparaison.colonnes.length}, minmax(0, 1fr))` }}>
        {comparaison.colonnes.map((c) => {
          const actif = c.supplierId === choisi;
          const reserves = [
            !c.validee && 'Équivalence de gamme non validée',
            !c.prixVerifies && `Base de prix ${c.nom} non vérifiée`,
            c.erreur && 'Relevé à corriger',
          ].filter(Boolean);
          return (
            <button key={c.supplierId} type="button" onClick={() => onChoisir(c.supplierId)} aria-pressed={actif}
              className={`text-left rounded-lg border p-3 ${actif ? 'border-primary-600 ring-2 ring-primary-200 bg-primary-50' : 'border-secondary-200 hover:border-secondary-400 bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-secondary-900">{c.nom}</span>
                {actif && <span className="inline-flex items-center gap-1 text-xs text-primary-800"><Check className="w-3.5 h-3.5" />Injecté</span>}
              </div>
              {c.totaux ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm">
                  <dt className="text-secondary-500">Vente HT</dt><dd className="text-right font-mono font-semibold">{formatEuro(c.totaux.vente_ht)}</dd>
                  <dt className="text-secondary-500">Achat HT</dt><dd className="text-right font-mono">{formatEuro(c.totaux.achat_ht)}</dd>
                  <dt className="text-secondary-500">Marge</dt><dd className="text-right font-mono">{formatEuro(c.totaux.marge_ht)}</dd>
                  <dt className="text-secondary-500">À chiffrer · ambiguës</dt><dd className="text-right font-mono">{c.aChiffrer} · {c.ambigus}</dd>
                </dl>
              ) : null}
              {comparaison.moinsCher === c.supplierId && <p className="mt-2 text-xs font-semibold text-secondary-800">Le moins cher à la vente</p>}
              {reserves.map((r) => <p key={r} className="mt-1 flex gap-1 text-xs text-st-attente"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{r}</p>)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
