// src/apps/solaire/components/TransparencyPanel.jsx
// « Comment ces chiffres sont calculés ? » — décompose le résultat pour la
// transparence commerciale : production PVGIS → superposition horaire avec la
// conso type (talon Enedis calé sur les 12 factures) → autoconsommation réelle
// (Σ min(prod, conso) sur 8760 h) → économie. Le coefficient de simultanéité a
// été remplacé par ce moteur horaire (bascule 2026-07-07).
import { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import { percentToDegrees } from '../lib/pvEngine';

const pct = (x) => `${Math.round(x * 100)} %`;
const kwh = (n) => `${Math.round(n).toLocaleString('fr-FR')} kWh`;

export default function TransparencyPanel({ model, config, roof }) {
  const [open, setOpen] = useState(false);
  const t = model.active.totals;
  const tiltDeg = Math.round(percentToDegrees(Number(roof.tiltPercent) || 0) * 10) / 10;

  return (
    <div className="card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-sm font-medium text-secondary-700"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#1565C0]" />
          Comment ces chiffres sont calculés ?
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-secondary-400" /> : <ChevronDown className="w-4 h-4 text-secondary-400" />}
      </button>

      {open && (
        <ol className="mt-3 space-y-2.5 text-sm text-secondary-700 list-decimal list-inside">
          <li>
            <span className="font-semibold text-secondary-900">Production an 1 : {kwh(t.prod)}</span>
            {' '}— données solaires PVGIS pour ce lieu (pente {roof.tiltPercent} % ≈ {tiltDeg}°,
            orientation {String(roof.orientation)}, pertes système {config.system_loss} %) × {model.activeKwc} kWc.
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Superposition heure par heure</span>
            {' '}— la production est confrontée à une consommation type reconstituée heure par heure
            (profil de foyer Enedis calé sur vos 12 factures mensuelles). On ne compare pas des
            totaux annuels : le solaire ne compte que quand un besoin existe au même instant.
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Autoconsommation : {pct(t.tauxAutoconso)}</span>
            {' '}= somme, sur les 8 760 heures annuelles, de la part de production réellement
            consommée sur place → <span className="font-semibold text-secondary-900">{kwh(t.autoconso)}</span> autoconsommés
            ({pct(t.tauxAutoproduction)} de votre consommation couverte).
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Économie an 1 : {formatEuro(Math.round(model.economyYear1))}</span>
            {' '}= {kwh(t.autoconso)} × {model.priceKwh.toLocaleString('fr-FR')} €/kWh.
            Le surplus ({kwh(t.surplus)}) est volontairement valorisé 0 €.
          </li>
          <li className="list-none text-xs text-secondary-500 pl-0">
            Ce constat suppose vos habitudes actuelles. La section « Optimiser l'autoconsommation »
            montre combien le pilotage (ballon, recharges en journée…) peut faire grimper cette part.
          </li>
        </ol>
      )}
      {/* Point mort, sensibilité, ROCE/ROE : volet FINANCEMENT (FinancingModule),
          pas performance de l'actif — séparation Eric 2026-06-11. */}
    </div>
  );
}
