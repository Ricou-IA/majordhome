// src/apps/thermique/components/wizard/Step1Contexte.jsx
// Étape 1 du wizard Thermique : titre, commune (→ θe/DJU), bâtiment (année, isolation,
// toiture, plancher bas, ventilation, relance). Les choix géométriques structurels
// (plancherBasType, toitureType) vivent dans `saisie` → SET_SAISIE ; le reste → PATCH_CONTEXTE.
import { useRef } from 'react';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';
import { climat, ventilation } from '../../data';
import { thetaBasePour, resolvePeriode, djuDepartemental } from '../../lib/refDataResolvers';
import CommuneSearch from './CommuneSearch';

const ISOLATION_OPTIONS = [
  { value: 'non-isole', label: 'Non isolé' },
  { value: 'iti', label: 'ITI — isolation par l’intérieur' },
  { value: 'ite', label: 'ITE — isolation par l’extérieur' },
];

const TOITURE_OPTIONS = [
  { value: 'comble', label: 'Comble (plafond sous comble)' },
  { value: 'rampant', label: 'Rampant (toiture en pente)' },
];

// D9 — catégories « Espace sous toiture » (ids consommés par assembleBatiment.B_COMBLE)
const COMBLE_OPTIONS = [
  { value: 'isole', label: 'Toiture isolée' },
  { value: 'non-isole', label: 'Toiture non isolée' },
  { value: 'fortement-ventile', label: 'Fortement ventilé (sans feutre ni panneau en sous-face)' },
];

const PLANCHER_BAS_OPTIONS = [
  { value: 'terre-plein', label: 'Terre-plein' },
  { value: 'vide-sanitaire', label: 'Vide sanitaire' },
  { value: 'sous-sol', label: 'Sous-sol' },
];

const VENTILATION_OPTIONS = ventilation.systemes.map((s) => ({ value: s.id, label: s.nom }));

/** θe dérivé — ne destructurer QUE .thetaE (correction altitude non calibrée v1). */
function thetaEDerive(dept, altitude) {
  if (dept == null) return { thetaE: null, erreur: null };
  try {
    const { thetaE } = thetaBasePour(climat, dept, altitude ?? 0);
    return { thetaE, erreur: null };
  } catch {
    return { thetaE: null, erreur: `Température de base indisponible pour le département ${dept}` };
  }
}

export default function Step1Contexte({ contexte, saisie, communeInitialQuery, onPatchContexte, onSetSaisie, onCommune }) {
  // Auto-défaut isolation : appliqué au PREMIER remplissage de l'année (au blur, pour ne pas
  // réagir aux frappes intermédiaires « 1 », « 19 »…), jamais après un choix manuel.
  const isolationTouchedRef = useRef(false);
  const anneeAutoDoneRef = useRef(false);

  const handleCommuneSelect = (commune, communes) => {
    let dju = commune.dju ?? null;
    const djuFallback = commune.dju == null;
    if (djuFallback) {
      try {
        dju = djuDepartemental(communes, commune.dept);
      } catch {
        dju = null; // aucun DJU dans le département — affiché « — », la conso le signalera
      }
    }
    onCommune({ commune, dju, djuFallback });
  };

  const handleAnneeBlur = () => {
    if (anneeAutoDoneRef.current || isolationTouchedRef.current || contexte.annee == null) return;
    anneeAutoDoneRef.current = true;
    onPatchContexte({ isolation: contexte.annee >= 1975 ? 'iti' : 'non-isole' });
  };

  const { thetaE, erreur: thetaErreur } = thetaEDerive(contexte.dept, contexte.altitude);
  // θe affichée = forçage manuel opérateur si posé, sinon θe départementale dérivée.
  const thetaEAffiche = contexte.thetaEForce != null ? contexte.thetaEForce : thetaE;

  return (
    <div className="space-y-5">
      {/* Étude */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Étude</h2>
        <FormField label="Titre de l’étude">
          <TextInput
            value={contexte.titre}
            onChange={(v) => onPatchContexte({ titre: v })}
            placeholder="Étude thermique — Dupont"
          />
        </FormField>
      </div>

      {/* Localisation */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Localisation</h2>
        {/* L'étape est démontée au changement de step : la commune déjà sélectionnée
            réamorce le champ au retour (sinon il repart vide alors que dept/DJU sont posés). */}
        <CommuneSearch
          initialQuery={contexte.commune
            ? `${contexte.commune.nom} (${contexte.commune.dept})`
            : (communeInitialQuery || '')}
          onSelect={handleCommuneSelect}
        />
        {contexte.dept != null && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Altitude (m)">
              <TextInput
                type="number"
                inputMode="numeric"
                // String() : TextInput fait `value || ''` — une altitude 0 (littoral) resterait affichable
                value={contexte.altitude == null ? '' : String(contexte.altitude)}
                onChange={(v) => {
                  const n = v === '' ? null : Number(v);
                  onPatchContexte({ altitude: Number.isNaN(n) ? null : n });
                }}
              />
            </FormField>
            <FormField label="Température de base θe">
              <div className="flex items-center gap-2">
                <TextInput
                  type="number"
                  inputMode="decimal"
                  // String() : θe peut valoir 0 (climat doux), à préserver face au `value || ''` de TextInput
                  value={thetaEAffiche == null ? '' : String(thetaEAffiche)}
                  onChange={(v) => {
                    const n = v === '' ? null : Number(v);
                    onPatchContexte({ thetaEForce: (v === '' || Number.isNaN(n)) ? null : n });
                  }}
                />
                <span className="text-sm text-secondary-500 flex-shrink-0">°C</span>
              </div>
              {contexte.thetaEForce != null ? (
                <button
                  type="button"
                  onClick={() => onPatchContexte({ thetaEForce: null })}
                  className="text-xs text-primary-600 hover:underline mt-1"
                >
                  ↺ Revenir à l’auto{thetaE != null ? ` (${thetaE} °C)` : ''}
                </button>
              ) : (
                <p className="text-xs text-secondary-500 mt-1">Valeur départementale — éditable pour forcer</p>
              )}
              {thetaErreur && contexte.thetaEForce == null && (
                <p className="text-xs text-red-600 mt-1">{thetaErreur} — saisissez une valeur manuelle</p>
              )}
            </FormField>
            <FormField label="DJU (base 18)">
              <div className="px-3 py-2 rounded-lg bg-secondary-50 border border-secondary-200 text-sm text-secondary-900 flex items-center gap-2 flex-wrap">
                <span>{contexte.dju != null ? contexte.dju : '—'}</span>
                {contexte.djuFallback && contexte.dju != null && (
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                    estimation départementale
                  </span>
                )}
              </div>
            </FormField>
          </div>
        )}
      </div>

      {/* Bâtiment */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-secondary-900">Bâtiment</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Année de construction">
            <TextInput
              type="number"
              inputMode="numeric"
              value={contexte.annee ?? ''}
              placeholder="1985"
              onChange={(v) => {
                const n = v === '' ? null : Number(v);
                onPatchContexte({ annee: Number.isNaN(n) ? null : n });
              }}
              onBlur={handleAnneeBlur}
            />
            <p className="text-xs text-secondary-500 mt-1">
              Période réglementaire : {resolvePeriode(contexte.annee)}
              {contexte.annee == null && ' (année inconnue)'}
            </p>
          </FormField>

          <FormField label="Isolation des murs">
            <SelectInput
              value={contexte.isolation}
              onChange={(v) => {
                if (!v) return;
                isolationTouchedRef.current = true;
                onPatchContexte({ isolation: v });
              }}
              options={ISOLATION_OPTIONS}
            />
          </FormField>

          <FormField label="Type de toiture">
            <SelectInput
              value={saisie.toitureType}
              onChange={(v) => v && onSetSaisie({ ...saisie, toitureType: v })}
              options={TOITURE_OPTIONS}
            />
          </FormField>

          {saisie.toitureType === 'comble' && (
            <FormField label="Type de comble">
              <SelectInput
                value={contexte.combleIsolation}
                onChange={(v) => v && onPatchContexte({ combleIsolation: v })}
                options={COMBLE_OPTIONS}
              />
            </FormField>
          )}

          <FormField label="Type de plancher bas">
            <SelectInput
              value={saisie.plancherBasType}
              onChange={(v) => v && onSetSaisie({ ...saisie, plancherBasType: v })}
              options={PLANCHER_BAS_OPTIONS}
            />
          </FormField>

          <FormField label="Type de ventilation">
            <SelectInput
              value={contexte.typeVentilation}
              onChange={(v) => v && onPatchContexte({ typeVentilation: v })}
              options={VENTILATION_OPTIONS}
            />
          </FormField>
        </div>

        {saisie.plancherBasType === 'sous-sol' && (
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
              checked={contexte.sousSolAvecOuvertures}
              onChange={(e) => onPatchContexte({ sousSolAvecOuvertures: e.target.checked })}
            />
            Sous-sol avec fenêtres ou portes extérieures
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
            checked={contexte.relance}
            onChange={(e) => onPatchContexte({ relance: e.target.checked })}
          />
          Majoration de relance (chauffage avec abaissement nocturne)
        </label>
      </div>
    </div>
  );
}
