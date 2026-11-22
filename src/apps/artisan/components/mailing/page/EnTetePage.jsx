/**
 * EnTetePage.jsx — en-tête de la page du mail
 * ============================================================================
 * Retour à la liste, nom du mail (modifiable tant qu'il n'a jamais été envoyé),
 * état d'enregistrement et bouton « Enregistrer ». Collant sur grand écran, sous
 * la fenêtre de lien de l'éditeur (z-50) : rien ici au-dessus de z-20.
 * Présentation seulement : les règles viennent de `src/lib/mailPage.js`.
 * ============================================================================
 */
import { ArrowLeft, Check, Loader2, Lock } from 'lucide-react';

export default function EnTetePage({
  nom, onNom, nomModifiable, raisonNom, etat, coche, modifie, raisons, enCours, onEnregistrer, onRetour,
}) {
  const ferme = enCours || !modifie || raisons.length > 0;
  return (
    <div className="z-20 -mx-4 border-b border-secondary-200 bg-secondary-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          type="button"
          onClick={onRetour}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Campagnes
        </button>

        <div className="min-w-0 flex-1">
          {nomModifiable ? (
            <input
              type="text"
              value={nom}
              onChange={(e) => onNom(e.target.value)}
              placeholder="Nom du mail"
              aria-label="Nom du mail"
              maxLength={120}
              className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-secondary-900 placeholder:text-secondary-400 hover:border-secondary-300 focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          ) : (
            <h1 className="flex items-center gap-2 truncate px-2 py-1 text-lg font-semibold text-secondary-900">
              <span className="truncate">{nom || 'Mail sans nom'}</span>
              {raisonNom && <Lock className="h-4 w-4 flex-shrink-0 text-secondary-400" aria-hidden="true" />}
            </h1>
          )}
          {raisonNom && <p className="px-2 text-xs text-secondary-500">{raisonNom}</p>}
        </div>

        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-sm ${modifie ? 'text-amber-700' : 'text-secondary-500'}`} aria-live="polite">
            {coche && <Check className="h-4 w-4" aria-hidden="true" />}
            {etat}
          </span>
          <button
            type="button"
            onClick={onEnregistrer}
            disabled={ferme}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
      {modifie && raisons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-right text-sm text-amber-800">
          {raisons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
