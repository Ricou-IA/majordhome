// src/apps/artisan/pages/settings/organization/components/layout.jsx
// Briques de mise en page de Settings → Organisation (aucune logique métier) :
// section en deux colonnes (intitulé + rôle du réglage à gauche, champs à droite),
// champ libellé / aide / erreur, barre d'enregistrement collante visible dès qu'un
// onglet a des modifications.
import { AlertTriangle, Loader2 } from 'lucide-react';

export const INPUT_CLASS =
  'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm bg-white text-secondary-900 placeholder:text-secondary-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-secondary-50 disabled:text-secondary-500';

/** Surface unique de l'onglet : les sections s'y suivent, séparées par un filet. */
export function SettingsSurface({ children }) {
  return <div className="bg-white rounded-xl border border-secondary-200 divide-y divide-secondary-100">{children}</div>;
}

/**
 * @param {{ title: string, description?: React.ReactNode, optional?: boolean, children: React.ReactNode }} p
 */
export function SettingsSection({ title, description, optional = false, children }) {
  return (
    <section className="grid gap-x-10 gap-y-4 px-6 py-6 lg:grid-cols-3">
      <div>
        <h2 className="text-sm font-semibold text-secondary-900">
          {title}
          {optional && <span className="ml-2 text-xs font-normal text-secondary-400">Facultatif</span>}
        </h2>
        {description && <p className="mt-1 text-sm text-secondary-500 leading-relaxed">{description}</p>}
      </div>
      <div className="lg:col-span-2 space-y-4 min-w-0">{children}</div>
    </section>
  );
}

/**
 * @param {{ label: string, required?: boolean, hint?: React.ReactNode, error?: string, className?: string, children: React.ReactNode }} p
 */
export function Field({ label, required = false, hint, error, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-secondary-700 mb-1.5">
        {label}
        {required && <span className="text-secondary-400 font-normal"> (obligatoire)</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-secondary-500">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs text-red-700 flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

/**
 * Barre collante en bas d'écran, affichée seulement quand l'onglet a des modifications.
 * @param {{ isDirty: boolean, isValid: boolean, isSaving: boolean, errorCount?: number, onSave: () => void, onReset: () => void }} p
 */
export function SaveBar({ isDirty, isValid, isSaving, errorCount = 0, onSave, onReset }) {
  if (!isDirty && !isSaving) return null;
  return (
    <div className="sticky bottom-4 z-20 mt-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-secondary-200 bg-white px-4 py-3 shadow-lg">
        <p className="text-sm text-secondary-700 mr-auto">
          {errorCount > 0
            ? `${errorCount === 1 ? '1 champ à corriger' : `${errorCount} champs à corriger`} avant d’enregistrer`
            : 'Modifications non enregistrées'}
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={isSaving}
          className="px-3 py-2 text-sm text-secondary-600 hover:text-secondary-900 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!isValid || isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

export function SettingsLoading() {
  return (
    <div className="bg-white rounded-xl border border-secondary-200 p-6 space-y-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-6 lg:grid-cols-3">
          <div className="h-4 w-32 rounded bg-secondary-100 animate-pulse" />
          <div className="lg:col-span-2 h-10 rounded bg-secondary-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
