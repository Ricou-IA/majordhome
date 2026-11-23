/**
 * EnTeteFicheClient.jsx - Majord'home Artisan
 * ============================================================================
 * En-tête de résumé de la fiche client (refonte UI phase 3, tâche 5) : fil
 * d'Ariane, avatar, nom, repères (contrat actif, catégorie, propriétaire /
 * locataire), ligne d'adresse et de numéros, puis les actions.
 *
 * Présentationnel : tout l'état et tous les gestes restent dans ClientDetail,
 * qui les passe en props. Conditions inchangées : Nouveau RDV si `planning.create`
 * et client non archivé, Nouveau SAV si `sav.create` et non archivé, Archiver si
 * non archivé, Supprimer définitivement si administrateur (les deux ouvrent la
 * confirmation de ClientDetail).
 *
 * Une seule action principale : « Nouveau RDV » (la plus à droite). « Modifier »
 * ouvre le panneau latéral de ClientDetail, qui porte son propre « Enregistrer ».
 * ============================================================================
 */

import { Link } from 'react-router-dom';
import {
  Archive, CalendarPlus, ChevronRight, LifeBuoy, Mail, Navigation, Pencil, Phone, Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { MenuActions } from '@/components/ui/menu-actions';
import { StatusPill } from '@/components/ui/status-pill';
import { Tag } from '@/components/ui/tag';
import { toneFor } from '@/lib/tonsStatut';
import { casseTitre } from '@/lib/clientsAffichage';
import { formaterAdresse } from '@/lib/itineraire';
import { useDeviceClass } from '@hooks/useDeviceClass';
import { CLIENT_CATEGORIES } from '@services/clients.service';
import { LienWaze } from '../../components/shared/LienWaze';
import { InviteClientButton } from '../../components/clients/InviteClientButton';

function anneeDe(date) {
  if (!date) return null;
  const annee = new Date(date).getFullYear();
  return Number.isFinite(annee) ? annee : null;
}

/**
 * @param {object} props
 * @param {object} props.client
 * @param {string} props.displayName
 * @param {boolean} props.isOwner
 * @param {boolean} props.isTenant
 * @param {boolean} props.isArchived
 * @param {boolean} props.isAdmin
 * @param {boolean} props.canCreateAppointment
 * @param {boolean} props.canCreateSAV
 * @param {boolean} props.isHardDeleting
 * @param {Function} props.onNouveauRdv
 * @param {Function} props.onNouveauSav
 * @param {Function} props.onArchiver       ouvre la confirmation d'archivage
 * @param {Function} props.onSupprimer      ouvre la confirmation de suppression définitive
 * @param {Function} props.onModifier       ouvre le panneau « Modifier la fiche »
 */
export function EnTeteFicheClient({
  client, displayName, isOwner, isTenant, isArchived, isAdmin,
  canCreateAppointment, canCreateSAV, isHardDeleting,
  onNouveauRdv, onNouveauSav, onArchiver, onSupprimer, onModifier,
}) {
  const { isPhone } = useDeviceClass();
  // Sur téléphone, toute zone tactile fait au moins 44 px.
  const tactile = isPhone ? 'h-11' : '';
  const tactileIcone = isPhone ? 'h-11 w-11' : '';

  const nom = casseTitre(displayName);
  const categorie = CLIENT_CATEGORIES.find((c) => c.value === client.client_category);
  const depuis = anneeDe(client.created_at);
  const adresse = formaterAdresse({ address: client.address, postalCode: client.postal_code, city: client.city });
  const villeSeule = [client.city, client.postal_code].filter(Boolean).join(' ');
  const rdvPossible = canCreateAppointment && !isArchived;

  const actionsMenu = [
    canCreateSAV && !isArchived && { label: 'Nouveau SAV', icon: LifeBuoy, onClick: onNouveauSav },
    !isArchived && { label: 'Archiver', icon: Archive, danger: true, onClick: onArchiver },
    isAdmin && {
      label: 'Supprimer définitivement', icon: Trash2, danger: true, disabled: isHardDeleting, onClick: onSupprimer,
    },
  ];

  return (
    <div className="min-w-0">
      <nav aria-label="Fil d'Ariane" className="mb-2 flex flex-wrap items-center gap-1 text-body-sm text-secondary-500">
        <Link to="/clients" className="hover:text-secondary-900">Clients</Link>
        <ChevronRight className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
        <span className="truncate text-secondary-700">{nom}</span>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar nom={displayName} id={client.id} taille={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-title text-secondary-900">{nom}</h1>
              {client.has_active_contract && (
                <StatusPill tone={toneFor('contrat', 'active')}>Contrat actif</StatusPill>
              )}
              {categorie && <Tag>{categorie.label}</Tag>}
              {isOwner && <Tag>Propriétaire</Tag>}
              {isTenant && <Tag>Locataire</Tag>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-secondary-500">
              {/* Adresse : un appui lance Waze vers l'adresse de la fiche, depuis n'importe quel onglet */}
              <LienWaze
                address={client.address}
                postalCode={client.postal_code}
                city={client.city}
                lat={client.latitude}
                lng={client.longitude}
                className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                sinon={villeSeule || null}
              >
                <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                {adresse || 'Itinéraire'}
              </LienWaze>
              {client.pennylane_account_number && (
                <span className="rounded bg-secondary-100 px-1.5 py-0.5 font-mono text-caption text-secondary-600" title="Code comptable Pennylane">
                  {client.pennylane_account_number}
                </span>
              )}
              {client.client_number && !client.pennylane_account_number && (
                <span className="font-mono text-caption text-secondary-500">{client.client_number}</span>
              )}
              {client.external_ref && (
                <span className="font-mono text-caption text-secondary-500" title="Numéro du client dans l'ancien logiciel">
                  ancien n° {client.external_ref}
                </span>
              )}
              {depuis && <span>Client depuis {depuis}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {client.phone && (
            <Button asChild variant="secondary" size="icon" className={tactileIcone}>
              <a href={`tel:${client.phone.replace(/[^\d+]/g, '')}`} aria-label={`Appeler le ${client.phone}`} title={`Appeler le ${client.phone}`}>
                <Phone aria-hidden="true" />
              </a>
            </Button>
          )}
          {client.email && (
            <Button asChild variant="secondary" size="icon" className={tactileIcone}>
              <a href={`mailto:${client.email}`} aria-label={`Écrire à ${client.email}`} title={`Écrire à ${client.email}`}>
                <Mail aria-hidden="true" />
              </a>
            </Button>
          )}
          <LienWaze
            address={client.address}
            postalCode={client.postal_code}
            city={client.city}
            lat={client.latitude}
            lng={client.longitude}
            className={buttonVariants({ variant: 'secondary', className: tactile })}
          >
            <Navigation aria-hidden="true" />
            Itinéraire
          </LienWaze>

          {/* Portail client : le composant porte son propre appel et ses trois états
              (portail actif, e-mail requis, invitation) — il reste dans la rangée. */}
          <InviteClientButton client={client} />

          <MenuActions libelle="Autres actions sur le client" actions={actionsMenu} className={tactileIcone} />

          <Button type="button" variant="secondary" className={tactile} onClick={onModifier} title="Modifier la fiche">
            <Pencil aria-hidden="true" />
            Modifier
          </Button>
          {rdvPossible && (
            <Button type="button" variant="primary" className={tactile} onClick={onNouveauRdv} title="Créer un nouveau RDV pour ce client">
              <CalendarPlus aria-hidden="true" />
              Nouveau RDV
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default EnTeteFicheClient;
