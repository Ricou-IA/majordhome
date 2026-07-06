// src/apps/artisan/pages/settings/ThermiqueSettings.jsx
// Paramètres du module Thermique — défauts de calcul des études de déperditions (org_admin only).
// Source de vérité : core.organizations.settings.thermique via useOrgSettings().
// ⚠️ La RPC org_update_settings merge au niveau 1 : on sauve TOUJOURS
// l'objet thermique complet (les SEULES clés de DEFAULTS_THERMIQUE — jamais un sous-objet partiel).
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { TYPES_PIECE, buildThermiqueConfig } from '@apps/thermique/lib/thermiqueConfig';
import { supprimeParoiBibliotheque } from '@apps/thermique/lib/composeurParois';
import { Thermometer, Layers, Calculator, Library, Trash2, ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, SectionTitle, inputClass } from '../../components/FormFields';

const TABS = [
  { key: 'temperatures', label: 'Températures', icon: Thermometer },
  { key: 'ponts', label: 'Ponts thermiques', icon: Layers },
  { key: 'calcul', label: 'Calcul', icon: Calculator },
  { key: 'bibliotheque', label: 'Bibliothèque de parois', icon: Library },
];

const FAMILLE_LABELS = { murs: 'Murs', plancherBas: 'Plancher bas', plafondToiture: 'Plafond / toiture' };

const DELTA_UTB_FIELDS = [
  { key: 'non-isole', label: 'Non isolé' },
  { key: 'iti', label: 'Isolation intérieure (ITI)' },
  { key: 'ite', label: 'Isolation extérieure (ITE)' },
];

// Bornes de saisie (validation bouton Enregistrer)
const BOUNDS = {
  theta_int: { min: 5, max: 30 },
  delta_utb: { min: 0, max: 0.5 },
  f_rh: { min: 0, max: 50 },
  theta_non_chauffage: { min: 10, max: 20 },
  prix_kwh: { min: 0.05, max: 1 },
  facteur_ajustement: { min: 0.5, max: 1.5 },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, { min, max }) => isNum(v) && v >= min && v <= max;

/** Extrait du config effectif les SEULES clés de DEFAULTS_THERMIQUE (payload complet à sauver). */
function pickThermiqueForm(config) {
  return {
    theta_int_defauts: Object.fromEntries(
      TYPES_PIECE.map((t) => [t.id, config.theta_int_defauts[t.id]]),
    ),
    delta_utb: Object.fromEntries(
      DELTA_UTB_FIELDS.map((f) => [f.key, config.delta_utb[f.key]]),
    ),
    f_rh: config.f_rh,
    theta_non_chauffage: config.theta_non_chauffage,
    prix_kwh: config.prix_kwh,
    facteur_ajustement: config.facteur_ajustement,
  };
}

function validateThermiqueForm(form) {
  if (!TYPES_PIECE.every((t) => inRange(form.theta_int_defauts[t.id], BOUNDS.theta_int))) return false;
  if (!DELTA_UTB_FIELDS.every((f) => inRange(form.delta_utb[f.key], BOUNDS.delta_utb))) return false;
  return inRange(form.f_rh, BOUNDS.f_rh)
    && inRange(form.theta_non_chauffage, BOUNDS.theta_non_chauffage)
    && inRange(form.prix_kwh, BOUNDS.prix_kwh)
    && inRange(form.facteur_ajustement, BOUNDS.facteur_ajustement);
}

// ---------------------------------------------------------------------------
// Helpers champs numériques
// ---------------------------------------------------------------------------

function NumberField({ label, value, onChange, step = 'any', suffix, hint, min, max }) {
  return (
    <FormField label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={inputClass}
          value={value ?? ''}
          step={step}
          min={min}
          max={max}
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

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------

function TemperaturesTab({ form, patchTheta }) {
  return (
    <div className="card space-y-4">
      <div>
        <SectionTitle>Températures intérieures par défaut (θint)</SectionTitle>
        <p className="text-sm text-secondary-600 mt-1">
          Consigne proposée pour chaque type de pièce à la création d'une étude.
          Les pièces non chauffées par défaut (garage, cellier) utilisent cette valeur si on les chauffe.
        </p>
      </div>
      <div className="divide-y divide-secondary-100">
        {TYPES_PIECE.map((type) => (
          <div key={type.id} className="flex items-center gap-3 py-2">
            <span className="flex-1 text-sm text-secondary-700">{type.label}</span>
            <input
              type="number"
              className={`${inputClass} w-28`}
              value={form.theta_int_defauts[type.id] ?? ''}
              step={0.5}
              min={BOUNDS.theta_int.min}
              max={BOUNDS.theta_int.max}
              inputMode="decimal"
              onChange={(e) => {
                const n = e.target.value === '' ? '' : Number(e.target.value);
                patchTheta(type.id, Number.isNaN(n) ? '' : n);
              }}
            />
            <span className="text-sm text-secondary-500 w-6">°C</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PontsTab({ form, patchDelta }) {
  return (
    <div className="card space-y-4">
      <div>
        <SectionTitle>Ponts thermiques (ΔUtb)</SectionTitle>
        <p className="text-sm text-secondary-600 mt-1">
          Majoration forfaitaire ΔUtb appliquée à toutes les parois déperditives
          selon le type d'isolation des murs.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {DELTA_UTB_FIELDS.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            value={form.delta_utb[field.key]}
            step={0.01}
            min={BOUNDS.delta_utb.min}
            max={BOUNDS.delta_utb.max}
            suffix="W/(m²·K)"
            onChange={(v) => patchDelta(field.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

function CalculTab({ form, patch }) {
  return (
    <div className="card space-y-6">
      <div>
        <SectionTitle>Relance & courbe de charge</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <NumberField
            label="Surpuissance de relance (f_RH)"
            value={form.f_rh}
            step={1}
            min={BOUNDS.f_rh.min}
            max={BOUNDS.f_rh.max}
            suffix="W/m²"
            hint="Surpuissance de relance par m² quand l'option est activée dans une étude"
            onChange={(v) => patch({ f_rh: v })}
          />
          <NumberField
            label="Température de non-chauffage"
            value={form.theta_non_chauffage}
            step={0.5}
            min={BOUNDS.theta_non_chauffage.min}
            max={BOUNDS.theta_non_chauffage.max}
            suffix="°C"
            hint="Température extérieure au-delà de laquelle le chauffage est coupé — borne haute de la courbe de charge PAC"
            onChange={(v) => patch({ theta_non_chauffage: v })}
          />
        </div>
      </div>
      <div>
        <SectionTitle>Consommation</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <NumberField
            label="Prix du kWh électrique"
            value={form.prix_kwh}
            step={0.0001}
            min={BOUNDS.prix_kwh.min}
            max={BOUNDS.prix_kwh.max}
            suffix="€/kWh"
            onChange={(v) => patch({ prix_kwh: v })}
          />
          <NumberField
            label="Facteur d'ajustement du besoin"
            value={form.facteur_ajustement}
            step={0.05}
            min={BOUNDS.facteur_ajustement.min}
            max={BOUNDS.facteur_ajustement.max}
            hint="Correction du besoin annuel — apports gratuits/intermittence, à calibrer"
            onChange={(v) => patch({ facteur_ajustement: v })}
          />
        </div>
      </div>
    </div>
  );
}

function BibliothequeTab({ bibliotheque, onRename, onDelete, isSaving }) {
  return (
    <div className="card space-y-4">
      <div>
        <SectionTitle>Bibliothèque de parois</SectionTitle>
        <p className="text-sm text-secondary-600 mt-1">
          Parois composées (couches de matériaux), réutilisables dans les études. On en crée depuis
          le composeur d’une étude (étape « Ouvertures & compositions » → mode « Composer » →
          « Enregistrer ») ; ici on les renomme ou les supprime.
        </p>
      </div>
      {bibliotheque.length === 0 ? (
        <p className="text-sm text-secondary-500">
          Aucune paroi enregistrée. Ouvrez le composeur dans une étude et cliquez « Enregistrer ».
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-secondary-500 border-b border-secondary-100">
                <th className="py-2 pr-3 font-medium">Nom</th>
                <th className="py-2 pr-3 font-medium">Famille</th>
                <th className="py-2 pr-3 font-medium">U</th>
                <th className="py-2 pr-3 font-medium">Couches</th>
                <th className="py-2 font-medium" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {bibliotheque.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      defaultValue={p.nom}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== p.nom) onRename(p.id, v);
                      }}
                      className={`${inputClass} w-full min-w-[140px]`}
                      aria-label="Nom de la paroi"
                    />
                  </td>
                  <td className="py-2 pr-3 text-secondary-600">{FAMILLE_LABELS[p.famille] ?? p.famille}</td>
                  <td className="py-2 pr-3 text-secondary-900">{p.u}</td>
                  <td className="py-2 pr-3 text-secondary-600">{p.couches?.length ?? 0}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      disabled={isSaving}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ThermiqueSettings() {
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [activeTab, setActiveTab] = useState('temperatures');
  const [form, setForm] = useState(null);

  const config = useMemo(() => buildThermiqueConfig(settings), [settings]);
  const initial = useMemo(() => pickThermiqueForm(config), [config]);

  // Initialise le form quand les settings arrivent (pas pendant une édition)
  useEffect(() => {
    if (!isLoading && form === null) setForm(initial);
  }, [isLoading, initial, form]);

  useEffect(() => {
    if (!isOrgAdmin) toast.error("Accès réservé à l'administrateur de l'organisation");
  }, [isOrgAdmin]);

  if (!isOrgAdmin) return <Navigate to="/settings" replace />;

  const isDirty = form !== null && JSON.stringify(form) !== JSON.stringify(initial);
  const isValid = form !== null && validateThermiqueForm(form);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const patchTheta = (id, v) =>
    setForm((f) => ({ ...f, theta_int_defauts: { ...f.theta_int_defauts, [id]: v } }));
  const patchDelta = (key, v) =>
    setForm((f) => ({ ...f, delta_utb: { ...f.delta_utb, [key]: v } }));

  const handleSave = async () => {
    try {
      // ⚠ merge JSONB niveau 1 : préserver parois_bibliotheque (absente de `form`) sinon la
      // bibliothèque serait écrasée en enregistrant les réglages numériques.
      await save({ thermique: { ...form, parois_bibliotheque: config.parois_bibliotheque } });
      toast.success('Paramètres thermique enregistrés');
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
    }
  };

  // Sauvegarde des ops bibliothèque : objet thermique COMPLET, réglages numériques ENREGISTRÉS
  // (pickThermiqueForm(config), pas le `form` en cours d'édition) + nouvelle bibliothèque.
  const saveBiblio = async (nouvelle) => {
    try {
      await save({ thermique: { ...pickThermiqueForm(config), parois_bibliotheque: nouvelle } });
      toast.success('Bibliothèque mise à jour');
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
    }
  };
  const renommeBiblio = (id, nom) => saveBiblio(config.parois_bibliotheque.map((p) => (p.id === id ? { ...p, nom } : p)));
  const supprimeBiblio = (id) => saveBiblio(supprimeParoiBibliotheque(config.parois_bibliotheque, id));

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
          <h1 className="text-2xl font-bold text-secondary-900">Thermique</h1>
          <p className="text-secondary-600">
            Paramètres de calcul des études de déperditions.
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
            {activeTab === 'temperatures' && <TemperaturesTab form={form} patchTheta={patchTheta} />}
            {activeTab === 'ponts' && <PontsTab form={form} patchDelta={patchDelta} />}
            {activeTab === 'calcul' && <CalculTab form={form} patch={patch} />}
            {activeTab === 'bibliotheque' && (
              <BibliothequeTab
                bibliotheque={config.parois_bibliotheque}
                onRename={renommeBiblio}
                onDelete={supprimeBiblio}
                isSaving={isSaving}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
