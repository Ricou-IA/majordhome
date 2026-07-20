// src/apps/solaire/components/Step2Consommation.jsx
// Étape 2 du wizard : le MODE d'enregistrement d'abord (Réel = 12 relevés factures /
// Schéma Enedis = annuel réparti selon la silhouette du profil), puis les hypothèses
// (profil RES1/RES2, VE en 3 états Pas de VE / En projet / Déjà équipé), la grille
// mensuelle (éditable en Réel, dérivée en Schéma), enfin le prix kWh.
// Règle VE (Enedis ne publie pas de schéma avec VE) :
//   - Déjà équipé + Schéma : part VE DÉDUITE de l'annuel → solde réparti selon le
//     schéma → part VE ré-ajoutée LISSÉE sur 12 mois (recharge non saisonnière).
//   - Déjà équipé + Réel : déjà dans les factures, rien à faire.
//   - En projet (les 2 modes) : la surconsommation VE est ajoutée au modèle (moteur).
import { useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { evMonthlyConsumption } from '../lib/pvEngine';
import { monthlyFromHourly } from '../lib/autoconsoEngine';
import { CONSO_PROFILES, consoProfileHourly } from '../data';

const MONTH_LABELS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

const PROFILE_LIST = [CONSO_PROFILES.RES1, CONSO_PROFILES.RES2];

/** Annuel → 12 mois : solde (hors part VE lissée) selon la silhouette Enedis du profil. */
function spreadFromAnnual({ total, profileKey, evFlatAnnual }) {
  const shares = monthlyFromHourly(consoProfileHourly(profileKey)); // Σ = 1
  const evFlat = Math.min(evFlatAnnual, total);
  const rest = total - evFlat;
  return shares.map((w) => Math.round(rest * w + evFlat / 12));
}

export default function Step2Consommation({ conso, ev, config, onConso, onEv, onBack, onNext }) {
  const source = conso.source ?? 'reel'; // rétro-compat : simulations sans le champ = saisie réelle
  const isSchema = source === 'annuel';

  const setMonth = (index, value) => {
    const n = value === '' ? '' : Number(value);
    const monthly = conso.monthly.map((v, i) => (i === index ? (Number.isNaN(n) ? '' : n) : v));
    onConso({ monthly });
  };

  const evAnnual = ev.enabled
    ? Math.round(evMonthlyConsumption({
        kmPerYear: Number(ev.kmPerYear) || 0,
        kwhPer100km: Number(ev.kwhPer100km) || 0,
        homeChargeShare: config.ev.home_charge_share,
      }) * 12)
    : 0;

  const totalAnnual = conso.monthly.reduce((a, v) => a + (Number(v) || 0), 0);

  // Mode Schéma : la grille mensuelle est DÉRIVÉE en continu de (annuel, profil, VE).
  // « Déjà équipé » : sa part (recharge domicile, non saisonnière) est DANS le total
  // mais ne suit pas la silhouette Enedis → déduite, solde réparti, part ré-ajoutée lissée.
  const annualTarget = Number(conso.annualKwh);
  useEffect(() => {
    if (!isSchema || !Number.isFinite(annualTarget) || annualTarget <= 0) return;
    const monthly = spreadFromAnnual({
      total: annualTarget,
      profileKey: conso.profile,
      evFlatAnnual: ev.enabled && ev.owned ? evAnnual : 0,
    });
    if (monthly.some((v, i) => v !== Number(conso.monthly[i]))) onConso({ monthly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSchema, annualTarget, conso.profile, ev.enabled, ev.owned, evAnnual]);

  // Bascule vers le mode Schéma : pré-remplit l'annuel avec le total courant (si absent).
  const switchSource = (next) => {
    if (next === 'annuel' && !Number(conso.annualKwh) && totalAnnual > 0) {
      onConso({ source: next, annualKwh: totalAnnual });
    } else {
      onConso({ source: next });
    }
  };
  const allMonthsFilled = conso.monthly.every((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0);
  const priceOk = Number.isFinite(Number(conso.priceKwh)) && Number(conso.priceKwh) > 0;

  const canContinue = allMonthsFilled && priceOk
    && (!ev.enabled || ((Number(ev.kmPerYear) || 0) > 0 && (Number(ev.kwhPer100km) || 0) > 0));

  return (
    <div className="space-y-5">
      {/* Consommation mensuelle */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Consommation (kWh)</h2>

        {/* Mode d'enregistrement — pilote l'éditabilité de la grille mensuelle */}
        <FormField label="Enregistrement de la consommation">
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { key: 'reel', title: 'Relevés réels', hint: '12 mois saisis depuis les factures / Enedis' },
              { key: 'annuel', title: 'Schéma Enedis', hint: 'total annuel réparti selon le profil' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => switchSource(opt.key)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  source === opt.key
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-secondary-200 bg-white text-secondary-700 hover:border-secondary-400'
                }`}
              >
                <span className="block text-sm font-medium">{opt.title}</span>
                <span className="block text-xs text-secondary-500">{opt.hint}</span>
              </button>
            ))}
          </div>
        </FormField>

        {/* Profil AVANT la saisie : il pilote la répartition depuis l'annuel ET le talon horaire */}
        <FormField label="Profil de consommation">
          <div className="grid sm:grid-cols-2 gap-2">
            {PROFILE_LIST.map((p) => (
              <button
                key={p.key}
                onClick={() => onConso({ profile: p.key })}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  conso.profile === p.key
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-secondary-200 bg-white text-secondary-700 hover:border-secondary-400'
                }`}
              >
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-secondary-500">{p.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-secondary-500 mt-2">
            Détermine la silhouette mensuelle utilisée par « Répartir depuis l’annuel » et la silhouette
            horaire (talon Enedis) de l’autoconsommation. Un foyer chauffé en électrique consomme beaucoup plus en hiver.
          </p>
        </FormField>

        {/* Hypothèse VE — AVANT la saisie des mois : elle conditionne la répartition
            (déjà équipé = part lissée hors silhouette Enedis) et le calcul (en projet = ajouté). */}
        <FormField label="Véhicule électrique">
          <div className="grid sm:grid-cols-3 gap-2">
            {[
              { key: 'none', title: 'Pas de VE', hint: 'aucun véhicule électrique', active: !ev.enabled, patch: { enabled: false } },
              { key: 'projet', title: 'En projet d’achat', hint: 'pas encore dans les factures — ajouté au calcul', active: ev.enabled && !ev.owned, patch: { enabled: true, owned: false } },
              { key: 'owned', title: 'Déjà équipé', hint: 'déjà dans les factures — part lissée', active: ev.enabled && !!ev.owned, patch: { enabled: true, owned: true } },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onEv(opt.patch)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  opt.active
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-secondary-200 bg-white text-secondary-700 hover:border-secondary-400'
                }`}
              >
                <span className="block text-sm font-medium">{opt.title}</span>
                <span className="block text-xs text-secondary-500">{opt.hint}</span>
              </button>
            ))}
          </div>

          {ev.enabled && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-secondary-500">
                {ev.owned
                  ? (isSchema
                      ? 'Le schéma Enedis ne connaît pas le VE : sa part est déduite du total annuel, le solde suit le schéma, puis la part VE est ré-ajoutée lissée sur 12 mois (la recharge n’est pas saisonnière).'
                      : 'Sa consommation est déjà dans vos relevés — rien n’est ajouté au calcul.')
                  : 'Véhicule non reflété dans les factures — sa surconsommation est ajoutée au modèle.'}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Kilométrage annuel (km)">
                  <input
                    type="number"
                    inputMode="numeric"
                    className={inputClass}
                    value={ev.kmPerYear ?? ''}
                    min={0}
                    step={1000}
                    onChange={(e) => {
                      const n = e.target.value === '' ? '' : Number(e.target.value);
                      onEv({ kmPerYear: Number.isNaN(n) ? '' : n });
                    }}
                  />
                </FormField>
                <FormField label="Conso véhicule (kWh/100 km)">
                  <input
                    type="number"
                    inputMode="decimal"
                    className={inputClass}
                    value={ev.kwhPer100km ?? ''}
                    min={0}
                    step={0.5}
                    onChange={(e) => {
                      const n = e.target.value === '' ? '' : Number(e.target.value);
                      onEv({ kwhPer100km: Number.isNaN(n) ? '' : n });
                    }}
                  />
                </FormField>
              </div>

              <label className="flex items-center gap-2 text-sm text-secondary-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-secondary-300"
                  checked={ev.addCharger}
                  onChange={(e) => onEv({ addCharger: e.target.checked })}
                />
                Ajouter la borne de recharge à l’investissement
              </label>
              {ev.addCharger && config.ev.charger_price === null && (
                <p className="text-xs text-secondary-500 bg-secondary-50 rounded-lg px-3 py-2">
                  Prix borne non configuré dans l’admin — il sera ajouté manuellement au coût de l’installation.
                </p>
              )}

              {evAnnual > 0 && (
                <p className="text-sm text-secondary-700">
                  {ev.owned ? 'part VE estimée dans vos factures : ' : 'véhicule électrique ajouté au modèle : '}
                  <span className="font-semibold">{evAnnual.toLocaleString('fr-FR')} kWh/an</span>
                  {' '}({config.ev.home_charge_share * 100} % rechargé à domicile)
                </p>
              )}
            </div>
          )}
        </FormField>

        {isSchema && (
          <FormField label="Consommation annuelle totale (kWh, factures)">
            <input
              type="number"
              inputMode="numeric"
              className={inputClass}
              placeholder="ex : 12000"
              value={conso.annualKwh ?? ''}
              min={0}
              onChange={(e) => {
                const n = e.target.value === '' ? '' : Number(e.target.value);
                onConso({ annualKwh: Number.isNaN(n) ? '' : n });
              }}
            />
            <p className="text-xs text-secondary-500 mt-1">
              Répartie selon le schéma Enedis du profil sélectionné
              {ev.enabled && ev.owned ? ' (part VE déduite puis lissée)' : ''} — la grille ci-dessous est calculée automatiquement.
            </p>
          </FormField>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-3">
          {MONTH_LABELS.map((label, i) => (
            <FormField key={label} label={label}>
              <input
                type="number"
                inputMode="numeric"
                className={inputClass}
                value={conso.monthly[i] ?? ''}
                min={0}
                disabled={isSchema}
                onChange={(e) => setMonth(i, e.target.value)}
              />
            </FormField>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm border-t border-secondary-100 pt-3">
          <span className="text-secondary-600">Total annuel</span>
          <span className="font-semibold text-secondary-900">
            {totalAnnual.toLocaleString('fr-FR')} kWh
            {ev.enabled && evAnnual > 0 && (
              <span className="font-normal text-secondary-500">
                {ev.owned
                  ? ` dont ~${evAnnual.toLocaleString('fr-FR')} kWh VE`
                  : ` + ${evAnnual.toLocaleString('fr-FR')} kWh VE`}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Prix kWh */}
      <div className="card space-y-4">
        <FormField label="Prix actuel du kWh (€ TTC)">
          <input
            type="number"
            inputMode="decimal"
            className={inputClass}
            value={conso.priceKwh ?? ''}
            step={0.01}
            min={0}
            onChange={(e) => {
              const n = e.target.value === '' ? '' : Number(e.target.value);
              onConso({ priceKwh: Number.isNaN(n) ? '' : n });
            }}
          />
        </FormField>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Voir les résultats <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
