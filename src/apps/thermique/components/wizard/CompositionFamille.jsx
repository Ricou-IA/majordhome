// src/apps/thermique/components/wizard/CompositionFamille.jsx
// Carte de composition d'une famille de parois (étape 3 du wizard Thermique) : 3 modes de
// résolution du U — « Défaut période » (uDefautPour × année de construction), « Composer » (couches
// de matériaux → U via ComposeurParoiModal, transparent et vérifiable), « U saisi » (nombre libre
// borné [0.05, 6]). Chaque changement remonte la famille COMPLÈTE { mode, u, couches? } via onPatch
// → PATCH_COMPOSITIONS (le reducer remplace la valeur de la famille). Les couches sont mémorisées
// dans la famille pour ré-édition/transparence (le moteur ne lit que `u`).
// Exporte aussi InputU (input U commit-au-blur partagé avec Step3OuverturesCompositions :
// menuiseries, exceptions par pièce, exceptions par ouverture).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { uDefauts } from '../../data';
import { uDefautPour, resolvePeriode } from '../../lib/refDataResolvers';
import ComposeurParoiModal from './ComposeurParoiModal';

export const U_MIN = 0.05;
export const U_MAX = 6;

/**
 * Input U générique : draft local, commit au blur/Enter, borné [U_MIN, U_MAX] (toast + revert si
 * hors bornes). Champ vidé → onCommit(null) si allowEmpty (= retirer l'exception), sinon revert.
 */
export function InputU({ value, onCommit, allowEmpty = true, placeholder = '', disabled = false, className = '' }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const commit = () => {
    const brut = draft.trim();
    if (brut === '') {
      if (allowEmpty) {
        if (value != null) onCommit(null);
      } else {
        setDraft(value == null ? '' : String(value));
      }
      return;
    }
    const n = Number(brut.replace(',', '.'));
    if (!Number.isFinite(n) || n < U_MIN || n > U_MAX) {
      toast.error(`U doit être compris entre ${U_MIN} et ${U_MAX} W/(m²·K)`);
      setDraft(value == null ? '' : String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      min={U_MIN}
      max={U_MAX}
      step="0.01"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50 disabled:text-secondary-400 disabled:cursor-not-allowed ${className}`}
    />
  );
}

// famille wizard → type de table u-defauts.json (contrat TYPE_U_DEFAUT d'assembleBatiment).
const TYPE_3CL = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/**
 * @param {Object} props
 * @param {'murs'|'plancherBas'|'plafondToiture'} props.famille clé de compositions.familles
 * @param {string} props.label titre affiché de la famille
 * @param {{mode: 'defaut'|'compose'|'saisi', u: number|null, couches?: object[]}} props.valeur
 * @param {number|null} props.annee année de construction (contexte) — pilote le U défaut/période
 * @param {(patch: {mode: string, u: number|null, couches?: object[]}) => void} props.onPatch
 */
export default function CompositionFamille({ famille, label, valeur, annee, onPatch }) {
  const uDefaut = uDefautPour(uDefauts, TYPE_3CL[famille], annee);
  const periode = resolvePeriode(annee);
  const [composeurOuvert, setComposeurOuvert] = useState(false);

  const setMode = (mode) => {
    if (mode === valeur.mode) return;
    if (mode === 'defaut') onPatch({ mode: 'defaut', u: null, couches: undefined });
    else if (mode === 'compose') setComposeurOuvert(true); // le patch vient de onApply
    else onPatch({ mode: 'saisi', u: Number.isFinite(valeur.u) ? valeur.u : uDefaut, couches: undefined });
  };

  const uResolu = valeur.mode === 'defaut' ? uDefaut : (Number.isFinite(valeur.u) ? valeur.u : null);
  const nomRadio = `composition-${famille}`;
  const radioClass = 'mt-0.5 border-secondary-300 text-primary-600 focus:ring-primary-500 flex-shrink-0';
  const nbCouches = valeur.couches?.length ?? 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-secondary-900 text-sm">{label}</h3>
        <span className={`text-xs ${uResolu == null ? 'text-red-600' : 'text-secondary-500'}`}>
          {uResolu == null ? 'U manquant' : `U = ${uResolu} W/(m²·K)`}
        </span>
      </div>

      {/* Défaut période */}
      <label className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer">
        <input
          type="radio"
          name={nomRadio}
          className={radioClass}
          checked={valeur.mode === 'defaut'}
          onChange={() => setMode('defaut')}
        />
        <span>
          Défaut période <span className="text-secondary-500">({periode})</span>
          <span className="block text-xs text-secondary-500">U = {uDefaut} W/(m²·K)</span>
        </span>
      </label>

      {/* Composer (couches de matériaux) */}
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer">
          <input
            type="radio"
            name={nomRadio}
            className={radioClass}
            checked={valeur.mode === 'compose'}
            onChange={() => setMode('compose')}
          />
          <span>Composer <span className="text-secondary-500">(couches de matériaux)</span></span>
        </label>
        {valeur.mode === 'compose' && (
          <div className="flex items-center gap-2 pl-6">
            <span className="text-xs text-secondary-500">
              {nbCouches} couche{nbCouches > 1 ? 's' : ''}
              {Number.isFinite(valeur.u) ? ` · U = ${valeur.u}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setComposeurOuvert(true)}
              className="px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg"
            >
              Composer / éditer
            </button>
          </div>
        )}
      </div>

      {/* U saisi */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-secondary-700 cursor-pointer">
          <input
            type="radio"
            name={nomRadio}
            className={radioClass}
            checked={valeur.mode === 'saisi'}
            onChange={() => setMode('saisi')}
          />
          U saisi
        </label>
        {valeur.mode === 'saisi' && (
          <InputU
            value={Number.isFinite(valeur.u) ? valeur.u : null}
            onCommit={(u) => onPatch({ mode: 'saisi', u })}
            allowEmpty={false}
            className="w-24"
          />
        )}
      </div>

      {composeurOuvert && (
        <ComposeurParoiModal
          famille={famille}
          label={label}
          couchesInitiales={valeur.couches}
          onApply={({ u, couches }) => { onPatch({ mode: 'compose', u, couches }); setComposeurOuvert(false); }}
          onClose={() => setComposeurOuvert(false)}
        />
      )}
    </div>
  );
}
