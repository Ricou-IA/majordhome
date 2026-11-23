import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@lib/utils';
import { Card } from './card';
import { InfoTip } from './info-tip';

/**
 * Chiffre clé (DA § 7) : libellé 14 px (icône 16 px en `secondary-400`), valeur en
 * Bricolage 32 px à chiffres tabulaires, ligne de contexte 13 px, variation en pastille.
 * Une valeur inconnue (`null` / `undefined`) s'affiche « — », jamais 0.
 * Sur téléphone la valeur passe à 20 px : deux chiffres par ligne doivent tenir.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.label
 * @param {React.ComponentType} [props.icon]  icône Lucide
 * @param {React.ReactNode} props.value  chiffre déjà mis en forme
 * @param {React.ReactNode} [props.context]  ligne sous la valeur
 * @param {{ valeur: React.ReactNode, sens: 'hausse'|'baisse' }} [props.delta]
 * @param {React.ReactNode} [props.info]  aide en info-bulle à côté du libellé
 */
export function KpiCard({ label, icon: Icone, value, context, delta, info, className }) {
  const inconnue = value === null || value === undefined;
  const hausse = delta?.sens === 'hausse';
  const Fleche = hausse ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-center gap-1.5 text-body-sm text-secondary-600">
        {Icone && <Icone className="h-4 w-4 shrink-0 text-secondary-400" strokeWidth={1.75} aria-hidden="true" />}
        <span className="min-w-0">{label}</span>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <p className="mt-2 font-display text-count tabular-nums text-secondary-900 sm:text-kpi">
        {inconnue ? '—' : value}
      </p>
      {(context || delta) && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-label font-normal text-secondary-500">
          {delta && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 text-caption font-semibold tabular-nums',
                hausse ? 'bg-st-ok-bg text-st-ok' : 'bg-st-alerte-bg text-st-alerte',
              )}
            >
              <Fleche className="h-3.5 w-3.5" aria-hidden="true" />
              {delta.valeur}
            </span>
          )}
          {context && <span>{context}</span>}
        </div>
      )}
    </Card>
  );
}

export default KpiCard;
