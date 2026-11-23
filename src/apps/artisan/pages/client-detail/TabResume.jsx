/**
 * TabResume.jsx — onglet Résumé de la fiche client (refonte UI phase 3, tâche 6).
 * ============================================================================
 * Lecture seule. Colonne large : prochaines interventions et historique récent ;
 * colonne étroite : coordonnées (avec la carte de l'adresse), logement (avec le bloc MonsieurDPE, qui n'est
 * monté qu'ici), proches liés, notes. Une seule colonne sur téléphone.
 *
 * Aucune requête propre : la fiche, le propriétaire et les locataires viennent de
 * ClientDetail ; les interventions et l'historique des hooks des onglets
 * Interventions et Échanges (même cache). Modifier la fiche = bouton « Modifier »
 * de l'en-tête (le formulaire complet, liaison des clients comprise, reste dans
 * `TabInfo`).
 * ============================================================================
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ExternalLink, Loader2, Navigation } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { InfoTip } from '@/components/ui/info-tip';
import { Tag } from '@/components/ui/tag';
import { useProjectInterventions } from '@hooks/useInterventions';
import { HOUSING_TYPES, LEAD_SOURCES } from '@services/clients.service';
import { INTERVENTION_TYPES } from '@services/interventions.service';
import { decrireIntervention, interventionsAVenir } from '@/lib/interventionLigne';
import { formaterAdresse } from '@/lib/itineraire';
import { casseTitre } from '@/lib/clientsAffichage';
import { formatDateShortFR, formatDateTimeFR, formatPhoneDisplay } from '@/lib/utils';
import { AuditEntry } from '@/apps/artisan/components/shared/AuditEntry';
import { LienWaze } from '@/apps/artisan/components/shared/LienWaze';
import { ClientLogementDpe } from '@/apps/artisan/components/clients/ClientLogementDpe';
import { ClientLocationMap } from '@/apps/artisan/components/clients/ClientLocationMap';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { useHistoriqueClient } from './useHistoriqueClient';

const NB_INTERVENTIONS = 3;
const NB_HISTORIQUE = 5;

/** Date locale du jour, 'YYYY-MM-DD' (jamais toISOString : il recule d'un jour après minuit). */
function aujourdhuiLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const labelDe = (liste, valeur) => liste.find((x) => x.value === valeur)?.label || null;

/** Lien discret d'en-tête de carte vers un autre onglet. */
const ToutVoir = ({ onClick, children = 'Tout voir' }) => (
  <button type="button" onClick={onClick} className="text-body-sm font-medium text-primary-700 hover:underline">
    {children}
  </button>
);

const Chargement = () => (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="h-5 w-5 animate-spin text-secondary-400" aria-hidden="true" />
  </div>
);

const Erreur = ({ children }) => (
  <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-body-sm text-red-800">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    {children}
  </p>
);

const Vide = ({ children }) => <p className="py-2 text-body-sm text-secondary-500">{children}</p>;

/** Ligne libellé / valeur des cartes de la colonne étroite. */
const Ligne = ({ label, children }) => (
  <div className="flex gap-3 py-1.5 text-body-sm">
    <dt className="w-[110px] shrink-0 text-secondary-500">{label}</dt>
    <dd className="min-w-0 flex-1 break-words font-medium text-secondary-900">{children}</dd>
  </div>
);

const Absent = () => <span className="font-normal text-secondary-400">—</span>;

/** « RDV le 20 nov. 2026 à 09:30 », « Prévu le … », « À planifier · demande du … ». */
function libelleAVenir(moment, type) {
  if (moment.kind === 'rdv_a_venir') {
    return `RDV le ${formatDateShortFR(moment.date)}${moment.heure ? ` à ${moment.heure}` : ''}`;
  }
  if (moment.kind === 'prevu') return `Prévu le ${formatDateShortFR(moment.date)}`;
  const depuis = moment.date ? ` · ${type === 'sav' ? 'demande du' : 'créée le'} ${formatDateShortFR(moment.date)}` : '';
  return `À planifier${depuis}`;
}

function ProchainesInterventions({ projectId, members, onToutVoir }) {
  const { interventions, isLoading, error } = useProjectInterventions(projectId);
  const aujourdhui = aujourdhuiLocal();
  const nomsTechniciens = useMemo(
    () => new Map((members || []).map((m) => [String(m.id), m.display_name || [m.first_name, m.last_name].filter(Boolean).join(' ')])),
    [members],
  );
  const aVenir = useMemo(() => interventionsAVenir(interventions, aujourdhui), [interventions, aujourdhui]);
  const affichees = aVenir.slice(0, NB_INTERVENTIONS);

  return (
    <Card as="section">
      <CardHeader
        title="Prochaines interventions"
        subtitle={aVenir.length > NB_INTERVENTIONS ? `${NB_INTERVENTIONS} sur ${aVenir.length}` : null}
        actions={<ToutVoir onClick={onToutVoir} />}
      />
      <div className="px-5 pb-5">
        {isLoading ? <Chargement /> : error ? (
          // Une liste vide ici se lirait « rien de prévu ».
          <Erreur>Les interventions de ce client n&apos;ont pas pu être lues.</Erreur>
        ) : affichees.length === 0 ? (
          <Vide>Rien de prévu : aucun RDV à venir ni carte Entretien / SAV en attente.</Vide>
        ) : (
          <ul className="divide-y divide-secondary-100">
            {affichees.map((i) => {
              const faits = decrireIntervention(i, { aujourdhui, nomsTechniciens });
              const type = labelDe(INTERVENTION_TYPES, i.intervention_type) || 'Intervention';
              return (
                <li key={i.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{type}</Tag>
                    <span className="text-body-sm font-medium text-secondary-900">{libelleAVenir(faits.moment, i.intervention_type)}</span>
                    {faits.techniciens.length > 0 && (
                      <span className="text-body-sm text-secondary-500">{faits.techniciens.join(', ')}</span>
                    )}
                  </div>
                  {faits.objet && <p className="mt-1 line-clamp-2 text-body-sm text-secondary-700">{faits.objet}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function HistoriqueRecent({ clientId, projectId, onToutVoir }) {
  const { timeline, isLoading, auditError, activitiesError } = useHistoriqueClient(clientId, projectId);
  const entrees = timeline.slice(0, NB_HISTORIQUE);

  return (
    <Card as="section">
      <CardHeader title="Historique" subtitle="Dernières modifications" actions={<ToutVoir onClick={onToutVoir} />} />
      <div className="px-5 pb-5">
        {isLoading ? <Chargement /> : (
          <>
            {(auditError || activitiesError) && (
              <div className="mb-3">
                <Erreur>L&apos;historique n&apos;a pas pu être lu en entier : ce qui suit est incomplet.</Erreur>
              </div>
            )}
            {entrees.length === 0 ? (
              !(auditError || activitiesError) && <Vide>Aucune modification enregistrée.</Vide>
            ) : (
              <ul className="divide-y divide-secondary-100">
                {entrees.map((entry) => (
                  <li key={entry.kind === 'audit' ? entry.id : `activity-${entry.id}`} className="py-3 first:pt-0 last:pb-0">
                    {entry.kind === 'audit' ? <AuditEntry entry={entry} showSubject /> : (
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-secondary-900">{entry.title}</p>
                        <p className="mt-1 text-xs text-secondary-400">{formatDateTimeFR(entry.created_at)}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Coordonnees({ client }) {
  const { settings } = useOrgSettings();
  const siege = getOrgHeadquarters(settings);
  const adresse = formaterAdresse({ address: client.address, postalCode: client.postal_code, city: client.city });
  const source = labelDe(LEAD_SOURCES, client.lead_source);
  const telephone = (numero) => (
    <a href={`tel:${numero.replace(/[^\d+]/g, '')}`} className="text-primary-700 hover:underline">{formatPhoneDisplay(numero)}</a>
  );

  return (
    <Card as="section">
      <CardHeader title="Coordonnées" />
      <dl className="px-5 pb-4">
        <Ligne label="Téléphone">{client.phone ? telephone(client.phone) : <Absent />}</Ligne>
        {client.phone_secondary && <Ligne label="Autre téléphone">{telephone(client.phone_secondary)}</Ligne>}
        <Ligne label="E-mail">
          {client.email
            ? <a href={`mailto:${client.email}`} className="text-primary-700 hover:underline">{client.email}</a>
            : <Absent />}
        </Ligne>
        <Ligne label="Adresse">
          <LienWaze
            address={client.address}
            postalCode={client.postal_code}
            city={client.city}
            lat={client.latitude}
            lng={client.longitude}
            className="inline-flex items-start gap-1.5 text-primary-700 hover:underline"
            sinon={<Absent />}
          >
            <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{adresse || 'Itinéraire'}</span>
          </LienWaze>
          {client.address_complement && <span className="block font-normal text-secondary-600">{client.address_complement}</span>}
        </Ligne>
        {client.access_instructions && <Ligne label="Accès">{client.access_instructions}</Ligne>}
        {client.company_name && <Ligne label="Société">{client.company_name}</Ligne>}
        {source && <Ligne label="Source">{source}</Ligne>}
        <Ligne label="Accords">
          E-mails {client.mail_optin !== false ? 'oui' : 'non'} · SMS {client.sms_optin !== false ? 'oui' : 'non'}
        </Ligne>
      </dl>
      {/* Même carte que le formulaire : position enregistrée, siège, trajet. */}
      <div className="px-5 pb-5">
        <ClientLocationMap
          saved={{ lat: client.latitude, lng: client.longitude }}
          savedAddress={{ address: client.address || '', postalCode: client.postal_code || '', city: client.city || '' }}
          address={client.address || ''}
          postalCode={client.postal_code || ''}
          city={client.city || ''}
          siege={siege}
          mapHeight="h-[200px]"
        />
      </div>
    </Card>
  );
}

function Logement({ client, formHousingType, formSurface, onApplyDpe, onCreateEquipment, onInvestigate }) {
  const type = labelDe(HOUSING_TYPES, client.housing_type);
  return (
    <Card as="section">
      <CardHeader title="Logement" />
      <div className="px-5 pb-5">
        <dl>
          <Ligne label="Type">{type || <Absent />}</Ligne>
          <Ligne label="Surface">{client.surface ? `${client.surface} m²` : <Absent />}</Ligne>
          <Ligne label="N° DPE">
            {client.dpe_number ? (
              <a
                href={`https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${client.dpe_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-primary-700 hover:underline"
                title="Ouvrir ce DPE sur l'observatoire ADEME"
              >
                {client.dpe_number}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : <Absent />}
          </Ligne>
        </dl>
        {/* Logement MonsieurDPE : DPE rattaché, carte du logement, rapport au client. Rien si le module est fermé.
            Monté ici seulement (plus dans le formulaire) : sa décision d'ouverture ne joue qu'une fois. */}
        <ClientLogementDpe
          client={client}
          formHousingType={formHousingType}
          formSurface={formSurface}
          onApply={onApplyDpe}
          onCreateEquipment={onCreateEquipment}
          onRechercherVoisinage={onInvestigate}
        />
      </div>
    </Card>
  );
}

function ProchesLies({ owner, tenants }) {
  const liens = [
    ...(owner ? [{ client: owner, role: 'Propriétaire' }] : []),
    ...(tenants || []).map((t) => ({ client: t, role: 'Locataire' })),
  ];
  if (liens.length === 0) return null;
  return (
    <Card as="section">
      <CardHeader title="Proches et sociétés liées" />
      <ul className="px-5 pb-4">
        {liens.map(({ client: lie, role }) => (
          <li key={lie.id} className="flex items-center justify-between gap-3 py-1.5 text-body-sm">
            <Link to={`/clients/${lie.id}`} className="min-w-0 truncate font-medium text-primary-700 hover:underline">
              {casseTitre(lie.display_name || '')}
            </Link>
            <Tag>{role}</Tag>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Notes({ client }) {
  const notes = client.notes?.trim();
  const interne = client.internal_notes?.trim();
  return (
    <Card as="section">
      <CardHeader title="Note" />
      <div className="space-y-4 px-5 pb-5 text-body-sm">
        {!notes && !interne && <Vide>Aucune note.</Vide>}
        {notes && <p className="whitespace-pre-line text-secondary-800">{notes}</p>}
        {interne && (
          <div>
            <p className="mb-1 flex items-center gap-1 font-medium text-secondary-500">
              Note interne
              <InfoTip>Non visible par le client</InfoTip>
            </p>
            <p className="whitespace-pre-line text-secondary-800">{interne}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * @param {object} props
 * @param {object} props.client - fiche chargée par `useClient`
 * @param {object|null} props.owner - propriétaire lié (`useLinkedClients`)
 * @param {Array<object>} props.tenants - locataires liés
 * @param {Array<object>} props.members - équipe (`useTeamMembers`), pour nommer les techniciens
 * @param {string} [props.formHousingType] - type de logement du formulaire (bloc DPE)
 * @param {string|number} [props.formSurface] - surface du formulaire (bloc DPE)
 * @param {Function} props.onApplyDpe - « Appliquer » du bloc DPE : pré-remplit le formulaire
 * @param {Function} props.onCreateEquipment - équipement repéré dans le DPE
 * @param {Function} props.onInvestigate - recherche dans les DPE publics du voisinage
 * @param {(onglet: string) => void} props.onOuvrirOnglet
 */
export function TabResume({
  client, owner, tenants, members, formHousingType, formSurface,
  onApplyDpe, onCreateEquipment, onInvestigate, onOuvrirOnglet,
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <ProchainesInterventions projectId={client.project_id} members={members} onToutVoir={() => onOuvrirOnglet('interventions')} />
        <HistoriqueRecent clientId={client.id} projectId={client.project_id} onToutVoir={() => onOuvrirOnglet('echanges')} />
      </div>
      <div className="min-w-0 space-y-6">
        <Coordonnees client={client} />
        <Logement
          client={client}
          formHousingType={formHousingType}
          formSurface={formSurface}
          onApplyDpe={onApplyDpe}
          onCreateEquipment={onCreateEquipment}
          onInvestigate={onInvestigate}
        />
        <ProchesLies owner={owner} tenants={tenants} />
        <Notes client={client} />
      </div>
    </div>
  );
}

export default TabResume;
