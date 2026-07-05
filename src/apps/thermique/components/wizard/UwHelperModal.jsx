// src/apps/thermique/components/wizard/UwHelperModal.jsx
// Modale « Proposer un Uw depuis les composants » (étape 3 du wizard Thermique) : vitrage (Ug) ×
// menuiserie (Uf) × volet optionnel (ΔR) → uwDepuisComposants (forfait D3 : Uw ≈ 0.7·Ug + 0.3·Uf ;
// Ujn = 1/(1/Uw + ΔR) si volet). Ouverte POUR UN CHAMP CIBLE (fenêtre ou porte-fenêtre) —
// « Utiliser Uw » / « Utiliser Ujn » appellent onApply(u arrondi 2 déc.) puis le parent ferme.
// Pattern modale du repo : overlay + panneau fixed (pas de @radix-ui/react-dialog installé —
// seul l'AlertDialog de ConfirmDialog l'est) ; montée conditionnellement par le parent
// ({uwTarget && <UwHelperModal …/>}) → état interne remis à zéro à chaque ouverture.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { FormField, SelectInput } from '@apps/artisan/components/FormFields';
import { menuiseries } from '../../data';
import { uwDepuisComposants } from '../../lib/refDataResolvers';

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {Object} props
 * @param {string} props.champLabel libellé du champ cible (« Fenêtre » / « Porte-fenêtre »)
 * @param {(u: number) => void} props.onApply reçoit le U retenu (Uw ou Ujn, arrondi 2 déc.)
 * @param {() => void} props.onClose fermeture sans appliquer
 */
export default function UwHelperModal({ champLabel, onApply, onClose }) {
  const [vitrageIdx, setVitrageIdx] = useState('');
  const [menuiserieIdx, setMenuiserieIdx] = useState('');
  const [voletIdx, setVoletIdx] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const vitrage = vitrageIdx === '' ? null : menuiseries.vitrages[Number(vitrageIdx)];
  const menuiserieType = menuiserieIdx === '' ? null : menuiseries.menuiseriesTypes[Number(menuiserieIdx)];
  const volet = voletIdx === '' ? null : menuiseries.volets[Number(voletIdx)];

  const resultat = vitrage && menuiserieType
    ? uwDepuisComposants({ ug: vitrage.ug, uf: menuiserieType.uf, deltaR: volet?.deltaR ?? null })
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Proposer un Uw — ${champLabel}`}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg rounded-xl border border-secondary-200 bg-white p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-secondary-900">
            Proposer un Uw — {champLabel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-secondary-500 hover:bg-secondary-100 rounded-lg"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <FormField label="Vitrage">
          <SelectInput
            value={vitrageIdx}
            onChange={(v) => setVitrageIdx(v ?? '')}
            placeholder="— Choisir un vitrage —"
            options={menuiseries.vitrages.map((v, i) => ({
              value: String(i),
              label: `${v.nom}${v.format ? ` (${v.format})` : ''} — Ug ${v.ug}`,
            }))}
          />
        </FormField>

        <FormField label="Menuiserie">
          <SelectInput
            value={menuiserieIdx}
            onChange={(v) => setMenuiserieIdx(v ?? '')}
            placeholder="— Choisir une menuiserie —"
            options={menuiseries.menuiseriesTypes.map((m, i) => ({
              value: String(i),
              label: `${m.nom} — Uf ${m.uf}`,
            }))}
          />
        </FormField>

        <FormField label="Volet (optionnel)">
          <SelectInput
            value={voletIdx}
            onChange={(v) => setVoletIdx(v ?? '')}
            placeholder="— Sans volet —"
            options={menuiseries.volets.map((v, i) => ({
              value: String(i),
              label: `${v.nom} — ΔR ${v.deltaR}`,
            }))}
          />
        </FormField>

        <div className="px-3 py-2 rounded-lg bg-secondary-50 border border-secondary-200 text-sm text-secondary-900 space-y-0.5">
          {resultat ? (
            <>
              <p>Uw = <span className="font-semibold">{resultat.uw.toFixed(2)}</span> W/(m²·K)</p>
              {resultat.ujn != null && (
                <p>
                  Ujn = <span className="font-semibold">{resultat.ujn.toFixed(2)}</span> W/(m²·K)
                  <span className="text-xs text-secondary-500"> (volet fermé)</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-secondary-500">Choisissez un vitrage et une menuiserie.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50"
          >
            Annuler
          </button>
          {resultat?.ujn != null && (
            <button
              type="button"
              onClick={() => onApply(round2(resultat.ujn))}
              className="px-4 py-2 text-sm font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50"
            >
              Utiliser Ujn
            </button>
          )}
          <button
            type="button"
            onClick={() => resultat && onApply(round2(resultat.uw))}
            disabled={!resultat}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Utiliser Uw
          </button>
        </div>
      </div>
    </>
  );
}
