// src/apps/artisan/pages/settings/SolaireSettings.jsx
// Paramètres du calculateur photovoltaïque (org_admin only).
// Source de vérité : core.organizations.settings.pv via useOrgSettings().
// ⚠️ La RPC org_update_settings merge au niveau 1 : on sauve TOUJOURS
// l'objet pv complet (jamais un sous-objet partiel).
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { buildPvConfig } from '@apps/solaire/lib/pvConfig';
import { Calculator, Grid3x3, Users, ChevronLeft, Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, SectionTitle, inputClass } from '../../components/FormFields';

const TABS = [
  { key: 'calcul', label: 'Paramètres calcul', icon: Calculator },
  { key: 'grille', label: 'Grille de coûts', icon: Grid3x3 },
  { key: 'simultaneite', label: 'Simultanéité & VE', icon: Users },
];

const KWC_OPTIONS = Array.from({ length: 17 }, (_, i) => 1 + i * 0.5); // 1 → 9 kWc, pas 0,5

// ---------------------------------------------------------------------------
// Helpers champs numériques
// ---------------------------------------------------------------------------

function NumberField({ label, value, onChange, step = 'any', suffix, hint, min }) {
  return (
    <FormField label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={inputClass}
          value={value ?? ''}
          step={step}
          min={min}
          inputMode="decimal"
          onChange={(e) => {
            const n = e.target.value === '' ? '' : Number(e.target.value);
            onChange(Number.isNaN(n) ? '' : n);
          }}
        />
        {suffix && <span className="text-sm text-secondary-500 flex-shrink-0">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-secondary-500 mt-1">{hint}</p>}
    </FormField>
  );
}

/** Champ % : stocke une fraction (0,03), affiche 3. */
function PctField({ label, value, onChange, hint, step = 0.1 }) {
  const display = value === '' || value === null || value === undefined
    ? ''
    : Math.round(value * 100 * 1000) / 1000;
  return (
    <NumberField
      label={label}
      value={display}
      step={step}
      suffix="%"
      hint={hint}
      onChange={(v) => onChange(v === '' ? '' : v / 100)}
    />
  );
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

function CalculTab({ form, patch }) {
  return (
    <div className="card space-y-6">
      <div>
        <SectionTitle>Économie</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <NumberField label="Prix du kWh par défaut" value={form.default_price_kwh} step={0.01} suffix="€ TTC"
            hint="⚠️ À aligner sur le TRV en vigueur" onChange={(v) => patch({ default_price_kwh: v })} />
          <PctField label="Inflation prix électricité / an" value={form.inflation_rate}
            onChange={(v) => patch({ inflation_rate: v })} />
          <PctField label="Dégradation panneaux / an" value={form.degradation_rate}
            onChange={(v) => patch({ degradation_rate: v })} />
          <NumberField label="Horizon de projection" value={form.horizon_years} step={1} min={5} suffix="ans"
            onChange={(v) => patch({ horizon_years: v })} />
          <PctField label="TVA (informatif, grille en TTC)" value={form.vat_rate}
            onChange={(v) => patch({ vat_rate: v })} />
        </div>
      </div>
      <div>
        <SectionTitle>Technique</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <NumberField label="Pertes système (PVGIS)" value={form.system_loss} step={1} suffix="%"
            onChange={(v) => patch({ system_loss: v })} />
          <NumberField label="Puissance panneau" value={form.panel_power_wc} step={5} suffix="Wc"
            onChange={(v) => patch({ panel_power_wc: v })} />
          <NumberField label="Surface panneau" value={form.panel_area_m2} step={0.01} suffix="m²"
            onChange={(v) => patch({ panel_area_m2: v })} />
          <NumberField label="Pente toiture par défaut" value={form.default_tilt_percent} step={1} suffix="%"
            onChange={(v) => patch({ default_tilt_percent: v })} />
          <PctField label="Seuil d'autoconsommation (optimiseur)" value={form.autoconso_threshold} step={1}
            hint="Plus grande puissance dont le taux d'autoconso reste ≥ ce seuil"
            onChange={(v) => patch({ autoconso_threshold: v })} />
        </div>
      </div>
      <div>
        <SectionTitle>Financement (défauts proposés au commercial)</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <PctField label="Taux annuel par défaut" value={form.default_loan_rate}
            onChange={(v) => patch({ default_loan_rate: v })} />
          <NumberField label="Durée par défaut" value={form.default_loan_years} step={1} suffix="ans"
            onChange={(v) => patch({ default_loan_years: v })} />
        </div>
      </div>
    </div>
  );
}

function GrilleTab({ form, patch }) {
  const grid = form.cost_grid ?? [];
  const sorted = [...grid].sort((a, b) => (a.kwc || 0) - (b.kwc || 0));
  const usedKwc = new Set(grid.map((r) => r.kwc));

  const updateRow = (index, rowPatch) => {
    const next = grid.map((r, i) => (i === index ? { ...r, ...rowPatch } : r));
    patch({ cost_grid: next });
  };
  const removeRow = (index) => patch({ cost_grid: grid.filter((_, i) => i !== index) });
  const addRow = () => {
    const free = KWC_OPTIONS.find((k) => !usedKwc.has(k));
    patch({ cost_grid: [...grid, { kwc: free ?? 1, prix_ttc: '' }] });
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionTitle>Grille de coûts (€ TTC posé)</SectionTitle>
          <p className="text-sm text-secondary-600 mt-1">
            Configurations entre 1 et 9 kWc. Entre deux lignes, le coût est interpolé ;
            hors grille, le commercial saisit le montant manuellement.
          </p>
        </div>
        <button onClick={addRow} className="btn-primary flex items-center gap-1.5 flex-shrink-0">
          <Plus className="w-4 h-4" /> Ajouter
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-secondary-300 bg-secondary-50 p-6 text-center text-sm text-secondary-600">
          Grille vide — le coût sera saisi manuellement par le commercial à chaque simulation.
        </div>
      ) : (
        <div className="divide-y divide-secondary-100">
          {grid.map((row, index) => {
            const duplicate = grid.filter((r) => r.kwc === row.kwc).length > 1;
            const invalidPrice = !isNum(row.prix_ttc) || row.prix_ttc <= 0;
            return (
              <div key={index} className="flex items-center gap-3 py-2">
                <select
                  className={`${inputClass} w-32`}
                  value={row.kwc}
                  onChange={(e) => updateRow(index, { kwc: Number(e.target.value) })}
                >
                  {KWC_OPTIONS.map((k) => (
                    <option key={k} value={k}>{k} kWc</option>
                  ))}
                </select>
                <input
                  type="number"
                  className={`${inputClass} w-40`}
                  value={row.prix_ttc ?? ''}
                  placeholder="Prix € TTC"
                  step={10}
                  min={0}
                  inputMode="numeric"
                  onChange={(e) => {
                    const n = e.target.value === '' ? '' : Number(e.target.value);
                    updateRow(index, { prix_ttc: Number.isNaN(n) ? '' : n });
                  }}
                />
                <span className="text-sm text-secondary-500">€ TTC</span>
                <div className="flex-1 text-xs">
                  {duplicate && <span className="text-[#0D47A1] font-medium">⚠ Doublon de puissance</span>}
                  {!duplicate && invalidPrice && <span className="text-[#0D47A1] font-medium">⚠ Prix manquant</span>}
                </div>
                <button
                  onClick={() => removeRow(index)}
                  className="p-1.5 rounded-md text-secondary-400 hover:text-secondary-700 hover:bg-secondary-100"
                  title="Supprimer la ligne"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SimultaneiteTab({ form, patch }) {
  const sim = form.simultaneity ?? {};
  const ev = form.ev ?? {};
  const patchSim = (p) => patch({ simultaneity: { ...sim, ...p } });
  const patchEv = (p) => patch({ ev: { ...ev, ...p } });
  return (
    <div className="card space-y-6">
      <div>
        <SectionTitle>Coefficients de simultanéité</SectionTitle>
        <p className="text-sm text-secondary-600 mt-1 mb-3">
          Part du recouvrement production/consommation réellement simultanée à l'échelle de la journée.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <PctField label="Présence en journée (retraités, télétravail)" value={sim.presence_journee} step={1}
            onChange={(v) => patchSim({ presence_journee: v })} />
          <PctField label="Présence partielle (défaut)" value={sim.presence_partielle} step={1}
            onChange={(v) => patchSim({ presence_partielle: v })} />
          <PctField label="Absent en journée" value={sim.absent_journee} step={1}
            onChange={(v) => patchSim({ absent_journee: v })} />
          <PctField label="Bonus pilotage ECS / domotique" value={sim.bonus_ecs} step={1}
            onChange={(v) => patchSim({ bonus_ecs: v })} />
          <PctField label="Bonus recharge VE pilotée" value={sim.bonus_ve} step={1}
            onChange={(v) => patchSim({ bonus_ve: v })} />
          <PctField label="Plafond global" value={sim.cap} step={1}
            onChange={(v) => patchSim({ cap: v })} />
        </div>
      </div>
      <div>
        <SectionTitle>Véhicule électrique</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <NumberField label="Prix borne posée" value={ev.charger_price ?? ''} step={50} suffix="€ TTC"
            hint="Vide = non configuré (ajout manuel au coût)"
            onChange={(v) => patchEv({ charger_price: v === '' ? null : v })} />
          <PctField label="Part de recharge à domicile" value={ev.home_charge_share} step={1}
            onChange={(v) => patchEv({ home_charge_share: v })} />
          <NumberField label="Kilométrage annuel par défaut" value={ev.default_km} step={1000} suffix="km"
            onChange={(v) => patchEv({ default_km: v })} />
          <NumberField label="Consommation véhicule par défaut" value={ev.default_kwh_100km} step={0.5} suffix="kWh/100 km"
            onChange={(v) => patchEv({ default_kwh_100km: v })} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function validatePvForm(form) {
  const flatNums = [
    form.default_price_kwh, form.inflation_rate, form.degradation_rate, form.horizon_years,
    form.system_loss, form.panel_power_wc, form.panel_area_m2, form.default_tilt_percent,
    form.autoconso_threshold, form.default_loan_rate, form.default_loan_years, form.vat_rate,
    form.simultaneity?.presence_journee, form.simultaneity?.presence_partielle,
    form.simultaneity?.absent_journee, form.simultaneity?.bonus_ecs,
    form.simultaneity?.bonus_ve, form.simultaneity?.cap,
    form.ev?.home_charge_share, form.ev?.default_km, form.ev?.default_kwh_100km,
  ];
  if (flatNums.some((v) => !isNum(v))) return false;
  if (form.ev?.charger_price !== null && !isNum(form.ev?.charger_price)) return false;
  const grid = form.cost_grid ?? [];
  const kwcs = grid.map((r) => r.kwc);
  if (new Set(kwcs).size !== kwcs.length) return false;
  return grid.every((r) => isNum(r.kwc) && r.kwc >= 1 && r.kwc <= 9 && isNum(r.prix_ttc) && r.prix_ttc > 0);
}

export default function SolaireSettings() {
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [activeTab, setActiveTab] = useState('calcul');
  const [form, setForm] = useState(null);

  const initial = useMemo(() => buildPvConfig(settings), [settings]);

  // Initialise/réaligne le form quand les settings arrivent (pas pendant une édition)
  useEffect(() => {
    if (!isLoading && form === null) setForm(initial);
  }, [isLoading, initial, form]);

  useEffect(() => {
    if (!isOrgAdmin) toast.error("Accès réservé à l'administrateur de l'organisation");
  }, [isOrgAdmin]);

  if (!isOrgAdmin) return <Navigate to="/settings" replace />;

  const isDirty = form !== null && JSON.stringify(form) !== JSON.stringify(initial);
  const isValid = form !== null && validatePvForm(form);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));

  const handleSave = async () => {
    try {
      const cleaned = { ...form, cost_grid: [...(form.cost_grid ?? [])].sort((a, b) => a.kwc - b.kwc) };
      await save({ pv: cleaned });
      setForm(cleaned);
      toast.success('Paramètres solaire enregistrés');
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1 text-sm text-secondary-500 hover:text-secondary-700 mb-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Paramètres
          </button>
          <h1 className="text-2xl font-bold text-secondary-900">Solaire</h1>
          <p className="text-secondary-600">
            Paramètres du calculateur photovoltaïque et grille de coûts.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          Enregistrer
        </button>
      </div>

      {isLoading || form === null ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : (
        <div className="flex gap-6 flex-col lg:flex-row">
          <nav className="lg:w-56 flex-shrink-0 flex lg:flex-col gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors whitespace-nowrap ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-secondary-600 hover:bg-secondary-50'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 min-w-0">
            {activeTab === 'calcul' && <CalculTab form={form} patch={patch} />}
            {activeTab === 'grille' && <GrilleTab form={form} patch={patch} />}
            {activeTab === 'simultaneite' && <SimultaneiteTab form={form} patch={patch} />}
          </div>
        </div>
      )}
    </div>
  );
}
