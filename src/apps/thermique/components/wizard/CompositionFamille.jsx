// src/apps/thermique/components/wizard/CompositionFamille.jsx
// Carte de composition d'une famille de parois (étape 3 du wizard Thermique) : 3 modes de
// résolution du U — « Défaut période » (uDefautPour × année de construction), « Bibliothèque »
// (parois-types.json filtrées par famille), « U saisi » (nombre libre borné [0.05, 6]).
// Chaque changement remonte la famille COMPLÈTE { mode, u } via onPatch → PATCH_COMPOSITIONS
// (le reducer remplace la valeur de la famille — shape { mode, u } VERROUILLÉ, cf. wizardState.js :
// c'est pourquoi la paroi bibliothèque choisie n'est PAS persistée, seul son U l'est ; la
// sélection du <select> est un état local, ré-amorcé au remount par matching sur U SEULEMENT si
// le match est unique — des U dupliqués existent dans les données réelles (ex. murs : 0.19 et
// 0.15 partagés chacun par 2 parois) et un findIndex afficherait le mauvais nom au retour sur
// l'étape ; sinon placeholder honnête, le U affiché en en-tête reste correct).
// Exporte aussi InputU (input U commit-au-blur partagé avec Step3OuverturesCompositions :
// menuiseries, exceptions par pièce, exceptions par ouverture).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { uDefauts, paroisTypes } from '../../data';
import { uDefautPour, resolvePeriode } from '../../lib/refDataResolvers';

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

// Familles réelles de parois-types.json (vérifiées) : 'Mur Ext.' / 'Mur Ent.' / 'Mur Int.' /
// 'Fen. Porte et Porte-fen.' / 'Plan. TP, isol. continue.' / 'Plan. sur VS.' / 'Plaf. sous Comble.'
// → mapping par préfixe ('Fen. …' jamais matchée : les menuiseries ont leurs propres champs U).
const FILTRE_FAMILLE = {
  murs: (f) => f.startsWith('Mur'),
  plancherBas: (f) => f.startsWith('Plan.'),
  plafondToiture: (f) => f.startsWith('Plaf.'),
};

/**
 * @param {Object} props
 * @param {'murs'|'plancherBas'|'plafondToiture'} props.famille clé de compositions.familles
 * @param {string} props.label titre affiché de la famille
 * @param {{mode: 'defaut'|'bibliotheque'|'saisi', u: number|null}} props.valeur famille courante
 * @param {number|null} props.annee année de construction (contexte) — pilote le U défaut/période
 * @param {(patch: {mode: string, u: number|null}) => void} props.onPatch remplace la famille
 */
export default function CompositionFamille({ famille, label, valeur, annee, onPatch }) {
  const parois = useMemo(
    () => paroisTypes.parois.filter((p) => FILTRE_FAMILLE[famille](p.famille)),
    [famille],
  );
  const uDefaut = uDefautPour(uDefauts, TYPE_3CL[famille], annee);
  const periode = resolvePeriode(annee);

  const [selIndex, setSelIndex] = useState(() => {
    if (valeur.mode !== 'bibliotheque' || !Number.isFinite(valeur.u)) return '';
    const matches = parois.filter((p) => p.u === valeur.u);
    return matches.length === 1 ? String(parois.indexOf(matches[0])) : '';
  });

  const setMode = (mode) => {
    if (mode === valeur.mode) return;
    if (mode === 'defaut') {
      onPatch({ mode: 'defaut', u: null });
    } else if (mode === 'bibliotheque') {
      const p = selIndex === '' ? null : parois[Number(selIndex)];
      onPatch({ mode: 'bibliotheque', u: p ? p.u : null });
    } else {
      // Pré-rempli avec le U courant résolu (défaut période si rien) — point de départ éditable.
      onPatch({ mode: 'saisi', u: Number.isFinite(valeur.u) ? valeur.u : uDefaut });
    }
  };

  const handleSelectParoi = (e) => {
    const v = e.target.value;
    setSelIndex(v);
    const p = v === '' ? null : parois[Number(v)];
    onPatch({ mode: 'bibliotheque', u: p ? p.u : null });
  };

  const uResolu = valeur.mode === 'defaut' ? uDefaut : (Number.isFinite(valeur.u) ? valeur.u : null);
  const nomRadio = `composition-${famille}`;
  const radioClass = 'mt-0.5 border-secondary-300 text-primary-600 focus:ring-primary-500 flex-shrink-0';

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-secondary-900 text-sm">{label}</h3>
        <span className={`text-xs ${uResolu == null ? 'text-red-600' : 'text-secondary-500'}`}>
          {uResolu == null ? 'U manquant' : `U = ${uResolu} W/(m²·K)`}
        </span>
      </div>

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

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer">
          <input
            type="radio"
            name={nomRadio}
            className={radioClass}
            checked={valeur.mode === 'bibliotheque'}
            onChange={() => setMode('bibliotheque')}
          />
          <span>Bibliothèque</span>
        </label>
        {valeur.mode === 'bibliotheque' && (
          <select
            value={selIndex}
            onChange={handleSelectParoi}
            className="w-full px-2 py-1.5 text-sm border border-secondary-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">— Choisir une paroi —</option>
            {parois.map((p, i) => (
              <option key={`${p.nom}-${i}`} value={String(i)}>
                {p.nom} — U {p.u}
              </option>
            ))}
          </select>
        )}
      </div>

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
    </div>
  );
}
