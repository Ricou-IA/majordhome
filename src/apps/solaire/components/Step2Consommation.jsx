// src/apps/solaire/components/Step2Consommation.jsx
// Étape 2 du wizard : profil de consommation (RES1/RES2), 12 consommations
// mensuelles, prix kWh, bloc optionnel véhicule électrique. Le profil pilote le
// talon horaire du constat d'autoconso (moteur horaire) ET la répartition
// « depuis l'annuel ». (Les cartes « présence » + coefficient de simultanéité ont
// été retirées à la bascule horaire du 2026-07-07.)
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Wand2, Car, ChevronDown, ChevronUp } from 'lucide-react';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { evMonthlyConsumption } from '../lib/pvEngine';
import { monthlyFromHourly } from '../lib/autoconsoEngine';
import { CONSO_PROFILES, consoProfileHourly } from '../data';

const MONTH_LABELS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

const PROFILE_LIST = [CONSO_PROFILES.RES1, CONSO_PROFILES.RES2];

export default function Step2Consommation({ conso, ev, config, onConso, onEv, onBack, onNext }) {
  const [annualInput, setAnnualInput] = useState('');
  const [showSpread, setShowSpread] = useState(false);

  const setMonth = (index, value) => {
    const n = value === '' ? '' : Number(value);
    const monthly = conso.monthly.map((v, i) => (i === index ? (Number.isNaN(n) ? '' : n) : v));
    onConso({ monthly });
  };

  // Répartit l'annuel selon la silhouette mensuelle du profil sélectionné (Σ des
  // poids = 1, dérivée du talon Enedis RES1/RES2) — plus fidèle qu'un profil générique.
  const applySpread = () => {
    const total = Number(annualInput);
    if (!Number.isFinite(total) || total <= 0) return;
    const shares = monthlyFromHourly(consoProfileHourly(conso.profile)); // Σ = 1
    onConso({ monthly: shares.map((w) => Math.round(total * w)) });
    setShowSpread(false);
    setAnnualInput('');
  };

  const totalAnnual = conso.monthly.reduce((a, v) => a + (Number(v) || 0), 0);
  const allMonthsFilled = conso.monthly.every((v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0);
  const priceOk = Number.isFinite(Number(conso.priceKwh)) && Number(conso.priceKwh) > 0;

  const evAnnual = ev.enabled
    ? Math.round(evMonthlyConsumption({
        kmPerYear: Number(ev.kmPerYear) || 0,
        kwhPer100km: Number(ev.kwhPer100km) || 0,
        homeChargeShare: config.ev.home_charge_share,
      }) * 12)
    : 0;

  const canContinue = allMonthsFilled && priceOk
    && (!ev.enabled || ((Number(ev.kmPerYear) || 0) > 0 && (Number(ev.kwhPer100km) || 0) > 0));

  return (
    <div className="space-y-5">
      {/* Consommation mensuelle */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-secondary-900">Consommation mensuelle (kWh)</h2>
          <button
            onClick={() => setShowSpread((s) => !s)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            <Wand2 className="w-4 h-4" /> Répartir depuis l'annuel
          </button>
        </div>

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

        {showSpread && (
          <div className="flex items-center gap-2 bg-secondary-50 rounded-lg p-3">
            <input
              type="number"
              inputMode="numeric"
              className={inputClass}
              placeholder="Total annuel kWh (ex : 12000)"
              value={annualInput}
              min={0}
              onChange={(e) => setAnnualInput(e.target.value)}
            />
            <button onClick={applySpread} className="btn-primary flex-shrink-0">Appliquer</button>
          </div>
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
              <span className="font-normal text-secondary-500"> + {evAnnual.toLocaleString('fr-FR')} kWh VE</span>
            )}
          </span>
        </div>
      </div>

      {/* Écran large (xl) : prix/profil et VE côte à côte. Tablette/mobile : empilé. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 xl:items-start gap-5">
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

        {/* Bloc VE repliable */}
        <div className="card space-y-4">
          <button
            onClick={() => onEv({ enabled: !ev.enabled })}
            className="w-full flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 font-semibold text-secondary-900">
              <Car className="w-5 h-5 text-secondary-500" /> Véhicule électrique
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                ev.enabled ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-500'
              }`}
              >
                {ev.enabled ? 'Activé' : 'Désactivé'}
              </span>
            </span>
            {ev.enabled ? <ChevronUp className="w-4 h-4 text-secondary-400" /> : <ChevronDown className="w-4 h-4 text-secondary-400" />}
          </button>

          {ev.enabled && (
            <div className="space-y-4">
              <p className="text-xs text-secondary-500">
                Projet d'achat ou véhicule non reflété dans les factures — la surconsommation est ajoutée au modèle.
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
                Ajouter la borne de recharge à l'investissement
              </label>
              {ev.addCharger && config.ev.charger_price === null && (
                <p className="text-xs text-secondary-500 bg-secondary-50 rounded-lg px-3 py-2">
                  Prix borne non configuré dans l'admin — il sera ajouté manuellement au coût de l'installation.
                </p>
              )}

              {evAnnual > 0 && (
                <p className="text-sm text-secondary-700">
                  dont véhicule électrique : <span className="font-semibold">{evAnnual.toLocaleString('fr-FR')} kWh/an</span>
                  {' '}({config.ev.home_charge_share * 100} % rechargé à domicile)
                </p>
              )}
            </div>
          )}
        </div>
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
