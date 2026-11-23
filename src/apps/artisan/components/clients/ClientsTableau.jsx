/**
 * ClientsTableau.jsx - Majord'home Artisan
 * ============================================================================
 * Liste des clients : tableau triable à partir de `md` (tablette rendue en 1 024 px
 * comprise), cartes `ClientCard` sur téléphone. Triables : Client et Créé le. Pied commun : « 25 sur 3 612 » et
 * « Charger plus » (le hook charge par ajout, pas par page).
 * Aucune donnée calculée ici : tri et chargement viennent de la page (`useClients`).
 * ============================================================================
 */

import { ChevronDown } from 'lucide-react';
import { DataTable } from '@components/ui/data-table';
import { Avatar } from '@components/ui/avatar';
import { Tag } from '@components/ui/tag';
import { StatusPill } from '@components/ui/status-pill';
import { Button } from '@components/ui/button';
import { toneFor } from '@/lib/tonsStatut';
import { casseTitre } from '@/lib/clientsAffichage';
import { formatDateShortFR, formatPhoneDisplay } from '@lib/utils';
import { CLIENT_CATEGORIES } from '@services/clients.service';
import { ClientCard, ClientCardSkeleton } from './ClientCard';
import { EquipmentKindIcons } from '../shared/EquipmentKindIcons';

const LIBELLE_CATEGORIE = Object.fromEntries(CLIENT_CATEGORIES.map((c) => [c.value, c.label]));

const nomDuClient = (client) => client.display_name
  || `${client.last_name || ''} ${client.first_name || ''}`.trim()
  || 'Client sans nom';

const COLONNES = [
  {
    cle: 'display_name',
    titre: 'Client',
    triable: true,
    rendu: (client) => {
      const nom = nomDuClient(client);
      const categorie = LIBELLE_CATEGORIE[client.client_category];
      return (
        <div className="flex min-w-0 items-center gap-3 py-2">
          <Avatar nom={nom} id={client.id} taille={32} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-secondary-900">{casseTitre(nom)}</span>
              {categorie && <Tag>{categorie}</Tag>}
              {client.is_archived === true && <StatusPill tone="neutre" taille="compacte">Archivé</StatusPill>}
              <EquipmentKindIcons clientId={client.id} size="xs" />
            </div>
            {client.client_number && (
              <p className="font-mono text-caption text-secondary-500">{client.client_number}</p>
            )}
          </div>
        </div>
      );
    },
  },
  {
    // Pas triable : des milliers d'égalités sur la ville, l'ordre ne tiendrait pas d'un « Charger plus » à l'autre.
    cle: 'city',
    titre: 'Ville',
    rendu: (client) => (client.city ? client.city : <span className="text-secondary-400">—</span>),
  },
  {
    cle: 'telephone',
    titre: 'Téléphone',
    classe: 'whitespace-nowrap tabular-nums',
    rendu: (client) => (client.phone ? formatPhoneDisplay(client.phone) : <span className="text-secondary-400">—</span>),
  },
  {
    cle: 'contrat',
    titre: 'Contrat',
    rendu: (client) => (client.has_active_contract === true
      ? <StatusPill tone={toneFor('contrat', 'active')}>Contrat actif</StatusPill>
      : null),
  },
  {
    cle: 'created_at',
    titre: 'Créé le',
    triable: true,
    classe: 'whitespace-nowrap',
    rendu: (client) => formatDateShortFR(client.created_at),
  },
];

/**
 * @param {Object} props
 * @param {Array<Object>} props.clients
 * @param {boolean} props.chargement        premier chargement
 * @param {boolean} props.chargementSuite   « Charger plus » en cours
 * @param {{ cle: string, ascendant: boolean }} props.tri
 * @param {(cle: string) => void} props.onTri
 * @param {(client: Object) => void} props.onClient
 * @param {number} props.totalCount
 * @param {boolean} props.hasMore
 * @param {() => void} props.onChargerPlus
 */
export function ClientsTableau({
  clients, chargement, chargementSuite, tri, onTri, onClient, totalCount, hasMore, onChargerPlus,
}) {
  const pied = clients.length > 0 && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="tabular-nums">
        {clients.length.toLocaleString('fr-FR')} sur {Math.max(totalCount, clients.length).toLocaleString('fr-FR')}
      </span>
      {(hasMore || chargementSuite) && (
        <Button type="button" variant="secondary" size="sm" onClick={onChargerPlus} disabled={chargementSuite} className="h-11">
          {chargementSuite ? 'Chargement…' : 'Charger plus'}
          {!chargementSuite && <ChevronDown aria-hidden="true" />}
        </Button>
      )}
    </div>
  );

  return (
    <>
      {/* Téléphone : cartes */}
      <div className="md:hidden">
        <div className="grid grid-cols-1 gap-4">
          {chargement && clients.length === 0
            && [1, 2, 3, 4, 5, 6, 7, 8].map((i) => <ClientCardSkeleton key={i} />)}
          {clients.map((client) => (
            <ClientCard key={client.id} client={client} onClick={onClient} />
          ))}
          {chargementSuite && [1, 2, 3, 4].map((i) => <ClientCardSkeleton key={`suite-${i}`} />)}
        </div>
        {pied && (
          <div className="mt-6 rounded-xl border border-secondary-200 bg-white px-4 py-3 text-body-sm text-secondary-500">
            {pied}
          </div>
        )}
      </div>

      {/* À partir de md : tableau */}
      <div className="hidden md:block">
        <DataTable
          colonnes={COLONNES}
          lignes={clients}
          cleLigne={(client) => client.id}
          tri={tri}
          onTri={onTri}
          onLigne={onClient}
          libelleLigne={(client) => `Ouvrir la fiche de ${casseTitre(nomDuClient(client))}`}
          chargement={chargement}
          pied={pied || null}
          libelle="Liste des clients"
        />
      </div>
    </>
  );
}

export default ClientsTableau;
