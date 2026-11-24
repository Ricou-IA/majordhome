// src/apps/artisan/pages/settings/BarreEnregistrement.jsx
// ============================================================================
// Barre d'enregistrement des pages de réglages (brief UX P2-01) : collée en bas de
// l'écran, toujours au même endroit, « Enregistrer » inactif tant que rien n'a changé.
// - `raison` : pourquoi l'enregistrement est fermé alors qu'il y a des changements
//   (saisie invalide), écrite à côté du bouton, jamais en infobulle.
// - `onRetablir` : « Rétablir les valeurs par défaut » (pages à valeurs chiffrées), après
//   confirmation ; ne fait que remettre le formulaire, rien n'est enregistré sans le bouton.
// - `onAnnuler` : « Annuler les modifications » (revient aux valeurs enregistrées).
// Sur téléphone, la barre se pose au-dessus de la barre du bas (`html[data-barre-bas]`,
// règle `.mdh-barre-enregistrement` dans index.css).
// ============================================================================
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * @param {object} p
 * @param {boolean} p.modifie        des champs ont changé depuis le dernier enregistrement
 * @param {boolean} [p.enCours]       enregistrement en cours
 * @param {() => void} p.onEnregistrer
 * @param {string|null} [p.raison]    raison de l'enregistrement impossible (saisie invalide)
 * @param {(() => void)|null} [p.onAnnuler]
 * @param {(() => void)|null} [p.onRetablir]
 * @param {string} [p.libelle]
 */
export function BarreEnregistrement({ modifie, enCours = false, onEnregistrer, raison = null, onAnnuler = null, onRetablir = null, libelle = 'Enregistrer' }) {
  const [confirmerRetablir, setConfirmerRetablir] = useState(false);
  const ferme = !modifie || enCours || !!raison;
  return (
    <>
      <div className="mdh-barre-enregistrement sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-secondary-200 bg-white/95 px-4 py-3 shadow-md backdrop-blur">
        {onRetablir && (
          <button type="button" onClick={() => setConfirmerRetablir(true)} disabled={enCours} className="text-sm text-secondary-600 underline underline-offset-2 hover:text-secondary-900 disabled:opacity-50">
            Rétablir les valeurs par défaut
          </button>
        )}
        <span className="ml-auto text-sm text-secondary-500" role="status">
          {raison ? <span className="text-st-attente">{raison}</span> : modifie ? 'Modifications non enregistrées' : 'Tout est enregistré'}
        </span>
        {onAnnuler && modifie && (
          <button type="button" onClick={onAnnuler} disabled={enCours} className="btn-secondary btn-sm">Annuler les modifications</button>
        )}
        <button type="button" onClick={onEnregistrer} disabled={ferme} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
          {enCours && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {libelle}
        </button>
      </div>
      {onRetablir && (
        <ConfirmDialog
          open={confirmerRetablir}
          onOpenChange={setConfirmerRetablir}
          title="Rétablir les valeurs par défaut ?"
          description="Les valeurs de cette page reviennent à celles d’origine. Rien n’est enregistré tant que vous ne cliquez pas sur « Enregistrer »."
          confirmLabel="Rétablir"
          variant="default"
          onConfirm={() => { setConfirmerRetablir(false); onRetablir(); }}
        />
      )}
    </>
  );
}

export default BarreEnregistrement;
