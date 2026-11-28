// src/apps/artisan/components/devis/metre/ComparaisonFabricants.jsx
// Le même relevé chiffré chez chaque fabricant reconnu (comparerFabricants du moteur) : rendu pur, choix du
// fabricant qui sera ajouté au devis. Jamais de « moins cher » quand une colonne a des pièces sans prix ou à
// départager, et chaque réserve est écrite en clair (reservesFabricant, syntheseComparaison de metreModel).
// Prix d'achat et marge masqués par défaut (même interrupteur que l'éditeur de devis).
import { AlertTriangle } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { useAfficherMarges } from '@hooks/useAfficherMarges';
import { reservesFabricant, syntheseComparaison } from './metreModel';

export default function ComparaisonFabricants({ comparaison, choisi, onChoisir }) {
  const marges = useAfficherMarges();
  if (!comparaison || comparaison.colonnes.length < 2) return null;
  return (
    <section className="border border-secondary-200 rounded-xl bg-white p-4">
      <h3 className="font-display text-section text-secondary-900">Fabricant</h3>
      <p className="text-sm text-secondary-600 mt-0.5 mb-3">Le même relevé chiffré chez chacun. {syntheseComparaison(comparaison)}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {comparaison.colonnes.map((c) => {
          const actif = c.supplierId === choisi;
          const reserves = reservesFabricant(c);
          return (
            <div key={c.supplierId} className={`rounded-xl border p-4 ${actif ? 'border-primary-600 bg-primary-50 shadow-ring' : 'border-secondary-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-secondary-900">{c.nom}</p>
                {actif && <StatusPill tone="info" taille="compacte">Sélectionné</StatusPill>}
              </div>
              {c.totaux && !c.erreur ? (
                <>
                  <p className="mt-1 font-display text-count text-secondary-900 tabular-nums">{formatEuro(c.totaux.vente_ht)} <span className="text-sm font-sans text-secondary-600">HT</span></p>
                  <p className="text-sm text-secondary-600 tabular-nums">{c.resultat?.lignes?.length ?? 0} pièces</p>
                  {marges.visibles && <p className="text-caption text-secondary-600 tabular-nums mt-0.5">achat {formatEuro(c.totaux.achat_ht)} · marge {formatEuro(c.totaux.marge_ht)}</p>}
                </>
              ) : null}
              {reserves.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {reserves.map((r) => <li key={r} className="flex gap-1.5 text-caption text-st-attente"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{r}</li>)}
                </ul>
              )}
              {!actif && !c.erreur && (
                <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => onChoisir(c.supplierId)}>Choisir ce fabricant</Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
