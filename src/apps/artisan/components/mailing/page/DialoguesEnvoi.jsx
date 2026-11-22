/**
 * DialoguesEnvoi.jsx — confirmations de la page du mail qui font partir des e-mails
 * ============================================================================
 * « Lancer » : segment, nombre (le même que la carte « À qui ? », compté avec le
 * nom qui partira), nom du mail ; impossible tant que ce nombre est inconnu ou nul.
 * Mise en route automatique : confirmée avant d'enregistrer, c'est l'enregistrement
 * qui fera partir le mail. Le bouton « Annuler » a le focus à l'ouverture.
 * Présentation seulement : les phrases viennent de `src/lib/mailPage.js`.
 * ============================================================================
 */
import { ConfirmDialog } from '@components/ui/confirm-dialog';

export default function DialoguesEnvoi({ confirmation, activation }) {
  return (
    <>
      <ConfirmDialog
        open={confirmation.ouverte}
        onOpenChange={(o) => { if (!o) confirmation.fermer(); }}
        title="Envoyer ce mail maintenant ?"
        description={confirmation.texte ?? confirmation.attente}
        confirmLabel="Oui, envoyer"
        cancelLabel="Annuler"
        variant="default"
        confirmDisabled={!confirmation.texte}
        onConfirm={confirmation.confirmer}
      />
      <ConfirmDialog
        open={activation.ouverte}
        onOpenChange={(o) => { if (!o) activation.fermer(); }}
        title="Mettre ce mail en route automatiquement ?"
        description={activation.texte ?? ''}
        confirmLabel="Enregistrer et mettre en route"
        cancelLabel="Annuler"
        variant="default"
        onConfirm={activation.confirmer}
      />
    </>
  );
}
