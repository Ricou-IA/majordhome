/**
 * chargement-app.jsx — ce qui s'affiche pendant qu'une page se charge (brief UX P1-06).
 * ============================================================================
 * Plus d'écran blanc uni ni de « Chargement… » seul : la structure de l'application se
 * dessine tout de suite, en blocs gris (même fond `bg-secondary-50` que l'application).
 * - `ChargementApp` : écran entier (connexion en cours, page publique, portail) ; `sansMenu`
 *   pour une page sans menu latéral (lien signé, portail client, connexion).
 * - `ChargementPage` : contenu d'une page dans l'application (menu déjà affiché).
 * Aucune donnée, aucun appel : affichage seul.
 * ============================================================================
 */
import { Squelette } from './squelette';

/** Contenu d'une page : titre, une ligne de repères, quatre blocs. */
export function ChargementPage() {
  return (
    <div role="status" aria-label="Chargement de la page" className="space-y-6 p-4 md:p-8">
      <div className="space-y-2">
        <Squelette className="h-7 w-48" />
        <Squelette className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Squelette key={i} className="h-20" />)}
      </div>
      <div className="space-y-3 rounded-2xl border border-secondary-200 bg-white p-5">
        {[0, 1, 2, 3].map((i) => <Squelette key={i} className="h-5" />)}
      </div>
    </div>
  );
}

/** Écran entier : bandeau, menu latéral (sauf `sansMenu`), contenu de page. */
export function ChargementApp({ sansMenu = false }) {
  return (
    <div className="flex min-h-screen bg-secondary-50">
      {!sansMenu && (
        <div aria-hidden="true" className="hidden w-64 shrink-0 flex-col gap-3 border-r border-secondary-200 bg-white p-4 lg:flex">
          <Squelette className="mb-4 h-8 w-36" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <Squelette key={i} className="h-5 w-40" />)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div aria-hidden="true" className="flex h-14 items-center border-b border-secondary-200 bg-white px-4">
          <Squelette className="h-5 w-32" />
        </div>
        <ChargementPage />
      </div>
    </div>
  );
}

export default ChargementApp;
