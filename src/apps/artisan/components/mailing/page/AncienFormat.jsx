/**
 * AncienFormat.jsx — mail fait avec l'ancien outil
 * ============================================================================
 * Un texte que l'éditeur ne sait pas ouvrir (page complète, tableau…) part tel
 * quel : pas d'éditeur, l'aperçu le montre, et deux gestes, confirmés :
 *   - « Refaire avec le nouvel éditeur » : l'ancien texte est mis de côté
 *     (`blocks.ancien_html`), le texte devient celui proposé par l'application
 *     pour ce mail, sinon une page blanche ;
 *   - « Revenir à l'ancien » : tant que l'ancien texte est gardé.
 * Rien n'est écrit avant « Enregistrer ». Règles : `refaireAvecNouvelEditeur`,
 * `revenirALAncien` (`src/lib/mailPage.js`).
 * ============================================================================
 */
import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';

/** Bandeau d'un mail à l'ancien format. */
export function BandeauAncienFormat({ aUnTexteParDefaut, disabled, onRefaire }) {
  const [confirmer, setConfirmer] = useState(false);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
      <div className="flex items-start gap-3">
        <History className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-sm font-medium text-amber-900">Ce mail a été fait avec l’ancien outil. Il part tel quel.</p>
            <p className="mt-1 text-sm text-amber-800">
              Son objet reste modifiable ici. Pour changer son texte, refaites-le avec le nouvel éditeur : l’aperçu montre
              le mail tel qu’il part aujourd’hui.
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => setConfirmer(true)}
              className="inline-flex h-10 items-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Refaire avec le nouvel éditeur
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmer}
        onOpenChange={setConfirmer}
        variant="default"
        title="Refaire ce mail avec le nouvel éditeur ?"
        description={aUnTexteParDefaut
          ? 'Le texte actuel est mis de côté et remplacé par le texte que l’application propose pour ce mail. Vous pourrez revenir à l’ancien. Rien ne change pour vos clients avant « Enregistrer ».'
          : 'Le texte actuel est mis de côté et vous repartez d’une page blanche. Vous pourrez revenir à l’ancien. Rien ne change pour vos clients avant « Enregistrer ».'}
        confirmLabel="Refaire"
        onConfirm={() => { setConfirmer(false); onRefaire(); }}
      />
    </div>
  );
}

/** Ligne discrète : revenir à l'ancien texte mis de côté. */
export function RevenirAncien({ disabled, onRevenir }) {
  const [confirmer, setConfirmer] = useState(false);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-secondary-500">
        Ce texte remplace un mail fait avec l’ancien outil, mis de côté.
        <button
          type="button"
          onClick={() => setConfirmer(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Revenir à l’ancien
        </button>
      </p>
      <ConfirmDialog
        open={confirmer}
        onOpenChange={setConfirmer}
        variant="default"
        title="Revenir à l’ancien mail ?"
        description="Le texte écrit ici est remplacé par l’ancien mail, qui repartira tel quel. Rien ne change pour vos clients avant « Enregistrer »."
        confirmLabel="Revenir à l’ancien"
        onConfirm={() => { setConfirmer(false); onRevenir(); }}
      />
    </>
  );
}
