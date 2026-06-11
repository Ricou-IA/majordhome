// src/apps/solaire/components/TransparencyPanel.jsx
// « Comment ces chiffres sont calculés ? » — décompose le résultat pour la
// transparence commerciale : production PVGIS → recouvrement mensuel →
// coefficient de simultanéité (preset + bonus) → autoconsommation → économie.
import { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import { PRESET_LABELS } from '../lib/etudeModel';
import { percentToDegrees } from '../lib/pvEngine';

const pct = (x) => `${Math.round(x * 100)} %`;
const kwh = (n) => `${Math.round(n).toLocaleString('fr-FR')} kWh`;

export default function TransparencyPanel({ model, config, conso, ev, roof }) {
  const [open, setOpen] = useState(false);
  const t = model.active.totals;
  const parts = model.coeffParts;
  const tiltDeg = Math.round(percentToDegrees(Number(roof.tiltPercent) || 0) * 10) / 10;

  const coeffFormula = [
    `${PRESET_LABELS[parts.preset] || parts.preset} (${pct(parts.presetValue)})`,
    parts.ecsApplied ? `pilotage ECS (+${pct(parts.bonusEcs)})` : null,
    parts.evApplied ? `recharge VE pilotée (+${pct(parts.bonusVe)})` : null,
  ].filter(Boolean).join(' + ');

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
            <span className="font-semibold text-secondary-900">Recouvrement mensuel : {pct(model.overlapRatio)}</span>
            {' '}— part de la production qui reste sous la consommation, mois par mois
            {model.overlapRatio >= 0.999 ? ' (aucun débordement structurel : tout est consommable)' : ' (le reste déborde les mois d\'été)'}.
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Coefficient de simultanéité : {pct(model.coeff)}</span>
            {' '}= {coeffFormula}{parts.capped ? `, plafonné à ${pct(parts.cap)}` : ''}.
            C'est la part du recouvrement réellement consommée au fil de la journée
            (la production de 11h-16h doit coïncider avec vos usages).
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Autoconsommation : {pct(t.tauxAutoconso)}</span>
            {' '}= {pct(model.overlapRatio)} × {pct(model.coeff)} → <span className="font-semibold text-secondary-900">{kwh(t.autoconso)}</span> autoconsommés
            ({pct(t.tauxAutoproduction)} de votre consommation couverte).
          </li>
          <li>
            <span className="font-semibold text-secondary-900">Économie an 1 : {formatEuro(Math.round(model.economyYear1))}</span>
            {' '}= {kwh(t.autoconso)} × {model.priceKwh.toLocaleString('fr-FR')} €/kWh.
            Le surplus ({kwh(t.surplus)}) est volontairement valorisé 0 €.
          </li>
          {model.breakEvenAutoconsoRate !== null && (
            <li>
              <span className="font-semibold text-secondary-900">Point mort : {pct(model.breakEvenAutoconsoRate)} d'autoconsommation</span>
              {' '}suffisent pour que les économies couvrent l'annuité de crédit (an 1) — cette simulation est à {pct(t.tauxAutoconso)}
              {t.tauxAutoconso >= model.breakEvenAutoconsoRate
                ? ' (au-dessus : gain dès la première année)'
                : model.maxAchievableAutoconso >= model.breakEvenAutoconsoRate
                  ? ' (atteignable en améliorant le pilotage des usages)'
                  : ' (atteint plus tard, porté par l\'inflation du prix de l\'électricité)'}.
            </li>
          )}
          <li>
            <span className="font-semibold text-secondary-900">
              Sensibilité : +1 point d'autoconsommation = +{formatEuro(Math.round(model.sensitivityPerAutoconsoPoint))}/an
            </span>
            {' '}d'économies (an 1). Potentiel maximum via pilotage : {pct(model.maxAchievableAutoconso)} d'autoconsommation
            (coefficient plafonné à {pct(parts.cap)}).
          </li>
        </ol>
      )}
    </div>
  );
}
