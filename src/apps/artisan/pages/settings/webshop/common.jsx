// src/apps/artisan/pages/settings/webshop/common.jsx
// Briques d'affichage partagées par les onglets de Settings → Webshop (aucune logique métier).
import { AlertTriangle, Loader2 } from 'lucide-react';

export const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
export const INPUT = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50 disabled:text-secondary-500';
export const CARD = 'bg-white rounded-lg border border-secondary-200 p-5';

/**
 * Champ : libellé, contenu, aide (« Par défaut : … ») et erreur sous le champ.
 * @param {{ label: string, aide?: React.ReactNode, erreur?: string, className?: string, children: React.ReactNode }} p
 */
export function Champ({ label, aide, erreur, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-secondary-600 mb-1">{label}</label>
      {children}
      {aide && !erreur && <p className="mt-1 text-xs text-secondary-500">{aide}</p>}
      {erreur && (
        <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{erreur}
        </p>
      )}
    </div>
  );
}

/**
 * Barre d'enregistrement d'un onglet de réglages.
 * @param {{ isDirty: boolean, peutEnregistrer: boolean, isSaving: boolean, nbErreurs: number, onSave: () => void, onReset: () => void }} p
 */
export function BarreEnregistrer({ isDirty, peutEnregistrer, isSaving, nbErreurs, onSave, onReset }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {nbErreurs > 0 && (
        <span className="text-xs text-red-600">
          {nbErreurs === 1 ? '1 champ à corriger' : `${nbErreurs} champs à corriger`} avant d’enregistrer
        </span>
      )}
      {isDirty && (
        <button type="button" onClick={onReset} disabled={isSaving} className="px-3 py-2 text-sm text-secondary-600 hover:text-secondary-900">
          Annuler les modifications
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!peutEnregistrer}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
        Enregistrer
      </button>
    </div>
  );
}

/** @param {{ children: React.ReactNode }} p */
export function Avertissement({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** @param {{ children?: React.ReactNode }} p */
export function Chargement({ children }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-secondary-500">
      <Loader2 className="w-5 h-5 animate-spin" />{children}
    </div>
  );
}
