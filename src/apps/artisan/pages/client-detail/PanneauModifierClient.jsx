/**
 * PanneauModifierClient.jsx - Majord'home Artisan
 * ============================================================================
 * Modification de la fiche client dans un panneau latéral (refonte UI phase 3,
 * tâche 7) : le formulaire complet (`TabInfo`, inchangé) s'ouvre par-dessus la
 * page, le Résumé reste monté dessous.
 *
 * Présentationnel : `formData`, l'enregistrement et l'abandon restent dans
 * ClientDetail. Le panneau ne décide que de la confirmation : fermer (Annuler,
 * Échap, voile, croix) avec des modifications demande « Abandonner les
 * modifications ? » ; sans modification, on ferme directement. Rien ne se ferme
 * pendant un enregistrement, ni tant que la fenêtre « Créer un nouveau client » de
 * `TabInfo` est ouverte (elle garde son propre bouton de fermeture).
 * ============================================================================
 */

import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { SidePanel } from '@/components/ui/side-panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TabInfo } from './TabInfo';

/**
 * @param {object} props
 * @param {boolean} props.ouvert
 * @param {string} props.nom                  nom du client, sous le titre
 * @param {boolean} props.modifie             la saisie diffère de la fiche enregistrée
 * @param {boolean} props.isUpdating
 * @param {() => void} props.onEnregistrer    enregistre ; ClientDetail ferme le panneau si c'est réussi
 * @param {() => void} props.onAbandonner     remet la saisie à la fiche enregistrée et ferme
 * @param {object} props.formData
 * @param {Function} props.setFormData
 * @param {string} props.clientId
 * @param {string} props.orgId
 * @param {object} props.client
 */
export function PanneauModifierClient({
  ouvert, nom, modifie, isUpdating, onEnregistrer, onAbandonner,
  formData, setFormData, clientId, orgId, client,
}) {
  const [confirmation, setConfirmation] = useState(false);
  const [modaleImbriquee, setModaleImbriquee] = useState(false);

  const demanderFermeture = () => {
    if (isUpdating || confirmation || modaleImbriquee) return;
    if (modifie) setConfirmation(true);
    else onAbandonner();
  };

  return (
    <>
      <SidePanel
        ouvert={ouvert}
        onFermer={demanderFermeture}
        titre="Modifier la fiche"
        description={nom}
        largeur="lg"
        bloquerFermeture={modaleImbriquee}
        pied={(
          <>
            <Button type="button" variant="ghost" onClick={demanderFermeture} disabled={isUpdating}>
              Annuler
            </Button>
            <Button type="button" variant="primary" onClick={onEnregistrer} disabled={!modifie || isUpdating}>
              {isUpdating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              Enregistrer
            </Button>
          </>
        )}
      >
        <TabInfo
          formData={formData}
          setFormData={setFormData}
          isLocked={false}
          clientId={clientId}
          orgId={orgId}
          savedLocation={{ lat: client?.latitude, lng: client?.longitude }}
          savedAddress={{ address: client?.address || '', postalCode: client?.postal_code || '', city: client?.city || '' }}
          onModaleOuverte={setModaleImbriquee}
        />
      </SidePanel>

      <ConfirmDialog
        open={confirmation}
        onOpenChange={setConfirmation}
        title="Abandonner les modifications ?"
        description="Les changements non enregistrés de la fiche seront perdus."
        confirmLabel="Abandonner"
        cancelLabel="Continuer la saisie"
        variant="destructive"
        onConfirm={() => {
          setConfirmation(false);
          onAbandonner();
        }}
      />
    </>
  );
}

export default PanneauModifierClient;
