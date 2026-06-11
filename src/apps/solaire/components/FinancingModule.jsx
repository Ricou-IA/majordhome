// src/apps/solaire/components/FinancingModule.jsx
// Module financement : taux/durée saisis par le commercial, apport, coût
// (pré-rempli depuis la grille admin, toujours éditable). Mensualité live.
// + « Lecture investisseur » : ROCE/ROE, point mort, sensibilité — rattachés
// au financement, PAS à la performance de l'actif (séparation Eric 2026-06-11).
import { Landmark, LineChart } from 'lucide-react';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { formatEuro } from '@lib/utils';

const pct1 = (x) => `${Math.round(x * 1000) / 10} %`;
const pct = (x) => `${Math.round(x * 100)} %`;

export default function FinancingModule({
  financing, onFinancing, gridCost, chargerPrice, totalCost, capital, mensualite, economyYear1,
  model, horizonYears,
}) {
  const costValue = financing.manualCost ?? (gridCost !== null ? Math.round(gridCost) : '');
  const economyMonthly = economyYear1 / 12;

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-secondary-900 flex items-center gap-2">
        <Landmark className="w-5 h-5 text-secondary-500" /> Financement
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FormField label="Coût installation (€ TTC)">
          <input
            type="number"
            inputMode="numeric"
            className={inputClass}
            value={costValue}
            min={0}
            step={100}
            onChange={(e) => {
              const n = e.target.value === '' ? null : Number(e.target.value);
              onFinancing({ manualCost: n !== null && Number.isNaN(n) ? null : n });
            }}
          />
          {gridCost === null && financing.manualCost === null && (
            <p className="text-xs text-secondary-500 mt-1">
              Grille non renseignée pour cette puissance — saisir le montant de l'offre
            </p>
          )}
        </FormField>

        <FormField label="Taux annuel (%)">
          <input
            type="number"
            inputMode="decimal"
            className={inputClass}
            value={financing.rate === '' ? '' : Math.round(financing.rate * 100 * 100) / 100}
            min={0}
            step={0.1}
            onChange={(e) => {
              const n = e.target.value === '' ? '' : Number(e.target.value);
              onFinancing({ rate: n === '' || Number.isNaN(n) ? '' : n / 100 });
            }}
          />
        </FormField>

        <FormField label="Durée (ans)">
          <input
            type="number"
            inputMode="numeric"
            className={inputClass}
            value={financing.years ?? ''}
            min={1}
            max={25}
            step={1}
            onChange={(e) => {
              const n = e.target.value === '' ? '' : Number(e.target.value);
              onFinancing({ years: Number.isNaN(n) ? '' : n });
            }}
          />
        </FormField>

        <FormField label="Apport (€)">
          <input
            type="number"
            inputMode="numeric"
            className={inputClass}
            value={financing.deposit ?? ''}
            min={0}
            step={500}
            onChange={(e) => {
              const n = e.target.value === '' ? 0 : Number(e.target.value);
              onFinancing({ deposit: Number.isNaN(n) ? 0 : n });
            }}
          />
        </FormField>
      </div>

      {chargerPrice > 0 && (
        <p className="text-sm text-secondary-600">+ borne de recharge : {formatEuro(chargerPrice)} (incluse au coût)</p>
      )}

      <div className="rounded-xl bg-secondary-50 p-4 flex items-center justify-between gap-3 flex-wrap">
        {mensualite === null ? (
          <p className="text-sm text-secondary-600">Saisir le coût de l'installation pour calculer la mensualité.</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-secondary-500">
                Mensualité {totalCost !== null && `(capital financé ${formatEuro(capital)})`}
              </p>
              <p className="text-2xl font-bold text-secondary-900">{formatEuro(Math.round(mensualite * 100) / 100)}<span className="text-sm font-normal text-secondary-500">/mois</span></p>
            </div>
            <div className="text-right">
              <p className="text-xs text-secondary-500">vs économie moyenne an 1</p>
              <p className="text-lg font-semibold text-[#1565C0]">{formatEuro(Math.round(economyMonthly))}<span className="text-sm font-normal">/mois</span></p>
            </div>
          </>
        )}
      </div>

      {/* Lecture investisseur (ROCE / ROE / point mort / levier) */}
      {model && model.totalCost !== null && model.assetYieldYear1 !== null && (
        <div className="rounded-xl border border-secondary-200 p-4 space-y-2">
          <p className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
            <LineChart className="w-4 h-4 text-[#1565C0]" /> Lecture investisseur
          </p>
          <ul className="space-y-1.5 text-sm text-secondary-700">
            <li>
              <span className="font-semibold text-secondary-900">Rendement de l'actif (ROCE) : {pct1(model.assetYieldYear1)} an 1</span>
              {' '}— économie {formatEuro(Math.round(model.economyYear1))} ÷ coût {formatEuro(model.totalCost)}.
              Performance de l'installation, indépendante du financement
              {model.assetYieldAvg !== null && ` (moyenne sur ${horizonYears} ans : ${pct1(model.assetYieldAvg)})`}.
            </li>
            {model.equityYieldYear1 !== null ? (
              <li>
                <span className="font-semibold text-secondary-900">Rendement des fonds propres (ROE) : {pct1(model.equityYieldYear1)} an 1</span>
                {' '}— gain net (économie − annuité) ÷ apport {formatEuro(model.deposit)}. L'effet de levier du crédit.
              </li>
            ) : model.fullCredit && model.netGainYear1 !== null ? (
              <li>
                <span className="font-semibold text-secondary-900">Fonds propres : 0 € immobilisé</span>
                {' '}— financement 100 % à crédit, effet de levier maximal :{' '}
                {model.netGainYear1 >= 0
                  ? `gain net de ${formatEuro(Math.round(model.netGainYear1))}/an dès l'an 1 sans mobiliser d'épargne.`
                  : `effort net de ${formatEuro(Math.round(Math.abs(model.netGainYear1)))}/an pendant le crédit, sans mobiliser d'épargne.`}
              </li>
            ) : null}
            {model.breakEvenAutoconsoRate !== null && (
              <li>
                <span className="font-semibold text-secondary-900">Point mort : {pct(model.breakEvenAutoconsoRate)} d'autoconsommation</span>
                {' '}pour que les économies couvrent l'annuité (an 1) — cette simulation est à {pct(model.active.totals.tauxAutoconso)}
                {model.active.totals.tauxAutoconso >= model.breakEvenAutoconsoRate
                  ? ' (au-dessus : gain dès la première année)'
                  : model.maxAchievableAutoconso >= model.breakEvenAutoconsoRate
                    ? ' (atteignable en améliorant le pilotage des usages)'
                    : ' (atteint plus tard, porté par l\'inflation du prix de l\'électricité)'}.
              </li>
            )}
            <li>
              <span className="font-semibold text-secondary-900">
                Levier : +1 point d'autoconsommation = +{formatEuro(Math.round(model.sensitivityPerAutoconsoPoint))}/an
              </span>
              {' '}d'économies. Potentiel maximum via pilotage : {pct(model.maxAchievableAutoconso)} d'autoconsommation.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
