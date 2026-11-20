/**
 * TabInterventions.jsx — onglet Interventions de la fiche client.
 * ============================================================================
 * Ici on RECENSE, on ne crée pas (Eric 2026-11-16) : un entretien naît du contrat,
 * un SAV du bouton « Nouveau SAV » de la fiche, une installation d'un chantier.
 * Chaque ligne dit ce que la base sait : quand (RDV posé, date prévue, sinon date
 * de la demande), qui (techniciens du RDV), quoi (description du SAV, équipement,
 * compte rendu), où ça en est (état de la carte, urgence, devis, facturation),
 * et ouvre la fiche Entretien / SAV du kanban.
 *
 * Chaque chantier et chaque carte présente aussi les DOCUMENTS qu'il a produits (Eric
 * 2026-11-20) : PV de réception et de levée, certificat, attestation, rapport SAV —
 * `DocumentsIntervention.jsx`, règle dans `src/lib/documentsIntervention.js`.
 *
 * Les faits affichés viennent de `src/lib/interventionLigne.js` (pur, testé).
 * ============================================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Wrench, HardHat, Ban, CalendarDays, Users, AlertCircle, RefreshCw, ChevronRight, Receipt, Package,
} from 'lucide-react';
import { CertificatLink } from '@/apps/artisan/components/certificat/CertificatLink';
import { AttestationLink } from '@/apps/artisan/components/certificat/AttestationLink';
import { SAVUrgencyBadge } from '@/apps/artisan/components/entretiens/SAVUrgency';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectInterventions, interventionKeys } from '@hooks/useInterventions';
import { useTeamMembers } from '@hooks/useAppointments';
import { useCanAccess } from '@hooks/usePermissions';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { INTERVENTION_TYPES } from '@services/interventions.service';
import { getStatusConfig, DEVIS_STATUSES, PARTS_ORDER_STATUSES } from '@services/sav.service';
import { chantiersService, getChantierStatusConfig } from '@services/chantiers.service';
import { certificatsService } from '@services/certificats.service';
import { certificatKeys } from '@hooks/cacheKeys';
import { unwrapResult } from '@/lib/serviceHelpers';
import { certificatsParIntervention } from '@/lib/documentsIntervention';
import { formatDateFR, formatDateShortFR, formatEuro } from '@/lib/utils';
import { decrireIntervention, ordonnerInterventions } from '@/lib/interventionLigne';
import { logger } from '@lib/logger';
import { FicheInterventionCarte } from './FicheInterventionCarte';
import { DocumentsChantier, DocumentsCarte } from './DocumentsIntervention';

const STATUTS_TECHNIQUES = {
  completed: { label: 'Terminé', className: 'bg-green-100 text-green-700' },
  scheduled: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Annulé', className: 'bg-secondary-100 text-secondary-700' },
  in_progress: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
  on_hold: { label: 'En attente', className: 'bg-orange-100 text-orange-700' },
  no_show: { label: 'Absent', className: 'bg-red-100 text-red-700' },
};

/** Date locale du jour, 'YYYY-MM-DD' (jamais toISOString : il recule d'un jour après minuit). */
function aujourdhuiLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** « RDV le 20 nov. 2026 à 09:30 », « Passage le … », « Réalisé le … », « Prévu le … », « Demande du … ». */
function libelleMoment(moment, type) {
  if (!moment.date) return null;
  const date = formatDateShortFR(moment.date);
  const heure = moment.heure ? ` à ${moment.heure}` : '';
  switch (moment.kind) {
    case 'rdv_a_venir': return `RDV le ${date}${heure}`;
    case 'rdv_passe': return `Passage le ${date}${heure}`;
    case 'realise': return `Réalisé le ${date}`;
    case 'prevu': return `Prévu le ${date}`;
    default: return type === 'sav' ? `Demande du ${date}` : `Créée le ${date}`;
  }
}

/** Équipement d'une ligne : « Poêle à granulés · INVICTA Antaya » (libellés du référentiel de l'org). */
function useLibelleEquipement(intervention) {
  const { index: referentiel } = useEquipmentReferential();
  if (!intervention.equipment_id) return { label: null, detail: null };
  const label = (intervention.equipment_type_id && referentiel.labelType(intervention.equipment_type_id))
    || (intervention.equipment_category_id ? referentiel.labelCategorie(intervention.equipment_category_id) : null);
  const detail = [intervention.equipment_brand, intervention.equipment_model].filter(Boolean).join(' ') || null;
  return { label, detail };
}

/** Enfant d'un entretien : un équipement, son certificat. */
const ChildCard = ({ intervention }) => {
  const isNeant = intervention.status === 'cancelled' && intervention.workflow_status === 'realise';
  const statusInfo = isNeant
    ? { label: 'Néant', className: 'bg-gray-100 text-gray-500' }
    : (STATUTS_TECHNIQUES[intervention.status] || STATUTS_TECHNIQUES.scheduled);
  const hasEntretien = intervention.intervention_type === 'entretien'
    || (intervention.intervention_type === 'sav' && intervention.includes_entretien);
  const showCertificat = hasEntretien && !isNeant && ['planifie', 'realise'].includes(intervention.workflow_status);
  const isRealise = intervention.workflow_status === 'realise';
  const { label, detail } = useLibelleEquipement(intervention);

  return (
    <div className={`ml-6 p-3 bg-white rounded-lg border border-l-2 border-l-blue-300 border-gray-200 ${isNeant ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-medium text-gray-900">{label || 'Équipement'}</span>
          {detail && <span className="text-xs text-gray-500">{detail}</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.className}`}>{statusInfo.label}</span>
          {isNeant && <Ban className="w-3 h-3 text-gray-400" />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showCertificat && (
            <CertificatLink interventionId={intervention.id} isRealise={isRealise} label={isRealise ? 'Certificat' : 'Remplir'} />
          )}
          {showCertificat && isRealise && <AttestationLink interventionId={intervention.id} label="Attestation" />}
        </div>
      </div>
      {intervention.work_performed && <p className="text-sm text-secondary-600 mt-2 line-clamp-2">{intervention.work_performed}</p>}
      {intervention.report_notes && <p className="text-sm text-secondary-500 mt-1 line-clamp-2 italic">{intervention.report_notes}</p>}
    </div>
  );
};

/** Intervention (carte Entretien / SAV, ou ligne d'historique importée). */
const InterventionCard = ({ intervention, certificat, aujourdhui, nomsTechniciens, onOpen }) => {
  const type = intervention.intervention_type;
  const typeConfig = INTERVENTION_TYPES.find((t) => t.value === type) || INTERVENTION_TYPES[INTERVENTION_TYPES.length - 1];
  const estCarte = ['entretien', 'sav'].includes(type) && !!intervention.workflow_status;
  const wfConfig = estCarte ? getStatusConfig(type, intervention.workflow_status) : null;
  // `status` reste 'scheduled' de la création à la clôture : sur une carte, l'état du kanban fait
  // foi ; on ne garde le statut technique que s'il dit autre chose (annulé, absent, en attente…).
  const statutTechnique = (!estCarte || !['scheduled', 'completed'].includes(intervention.status))
    ? STATUTS_TECHNIQUES[intervention.status] || null
    : null;

  const faits = decrireIntervention(intervention, { aujourdhui, nomsTechniciens });
  const moment = libelleMoment(faits.moment, type);
  const { label: equipLabel, detail: equipDetail } = useLibelleEquipement(intervention);
  const devisStatut = DEVIS_STATUSES.find((s) => s.value === intervention.devis_status)?.label || null;
  const piecesStatut = PARTS_ORDER_STATUSES.find((s) => s.value === intervention.parts_order_status)?.label || null;
  const facture = !!intervention.invoiced_at && intervention.workflow_status !== 'facture';

  const contenu = (
    <>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full ${typeConfig.bgClass}`}>{typeConfig.label}</span>
          {wfConfig && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: wfConfig.color }}>
              {wfConfig.label}
            </span>
          )}
          {statutTechnique && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${statutTechnique.className}`}>{statutTechnique.label}</span>
          )}
          <SAVUrgencyBadge item={intervention} taille="fiche" />
          {type === 'sav' && intervention.sav_origin === 'entretien' && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700">Suite d&apos;entretien</span>
          )}
          {type === 'sav' && intervention.includes_entretien && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">Avec entretien</span>
          )}
          {facture && (
            <span className="text-xs px-2 py-0.5 rounded bg-violet-50 text-violet-700">
              Facturé le {formatDateShortFR(intervention.invoiced_at)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary-700">
          {moment && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-secondary-400" aria-hidden="true" />
              {moment}
              {faits.joursDeRdv > 1 && <span className="text-secondary-400">({faits.joursDeRdv} jours posés)</span>}
            </span>
          )}
          {faits.techniciens.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-4 h-4 text-secondary-400" aria-hidden="true" />
              {faits.techniciens.join(', ')}
            </span>
          )}
          {faits.demandeLe && (
            <span className="text-xs text-secondary-400">
              {type === 'sav' ? 'Demande du' : 'Créée le'} {formatDateShortFR(faits.demandeLe)}
            </span>
          )}
        </div>

        {faits.objet && <p className="text-sm text-secondary-900 line-clamp-3">{faits.objet}</p>}

        {(equipLabel || equipDetail) && (
          <p className="inline-flex items-center gap-1.5 text-sm text-secondary-600">
            <Wrench className="w-4 h-4 text-secondary-400" aria-hidden="true" />
            {[equipLabel, equipDetail].filter(Boolean).join(' · ')}
          </p>
        )}

        {(intervention.devis_amount != null || devisStatut || piecesStatut) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary-600">
            {(intervention.devis_amount != null || devisStatut) && (
              <span className="inline-flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-secondary-400" aria-hidden="true" />
                Devis{intervention.devis_amount != null ? ` ${formatEuro(intervention.devis_amount)}` : ''}{devisStatut ? ` · ${devisStatut}` : ''}
              </span>
            )}
            {piecesStatut && (
              <span className="inline-flex items-center gap-1.5">
                <Package className="w-4 h-4 text-secondary-400" aria-hidden="true" />
                Pièces : {piecesStatut}
              </span>
            )}
          </div>
        )}

        {faits.compteRendu && <p className="text-sm text-secondary-600 line-clamp-2">{faits.compteRendu}</p>}
        {faits.notes && <p className="text-sm text-secondary-500 line-clamp-2 italic">{faits.notes}</p>}
      </div>

      {onOpen && <ChevronRight className="w-5 h-5 shrink-0 self-center text-secondary-300" aria-hidden="true" />}
    </>
  );

  // Les documents sont rendus HORS du bouton qui ouvre la fiche : un bouton n'en contient pas d'autres.
  const classes = 'flex w-full items-start gap-3 p-4 text-left';
  return (
    <div className="bg-white rounded-lg border border-secondary-200 overflow-hidden">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(intervention)}
          title="Ouvrir la fiche"
          className={`${classes} transition-colors hover:bg-primary-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500`}
        >
          {contenu}
        </button>
      ) : (
        <div className={classes}>{contenu}</div>
      )}
      <DocumentsCarte intervention={intervention} certificat={certificat} />
    </div>
  );
};

/**
 * Section chantiers (lecture seule) - un bloc par chantier du client
 */
const ChantierSummary = ({ clientId }) => {
  const [chantiers, setChantiers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    try {
      const { data, error } = await chantiersService.getChantiersByClientId(clientId);
      if (error) throw error;
      setChantiers(data || []);
    } catch (err) {
      logger.error('[ChantierSummary] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (loading || chantiers.length === 0) return null;
  const orderLabels = { na: 'N/A', commande: 'Commandé', recu: 'Reçu' };

  return (
    <div className="space-y-3">
      {chantiers.map((chantier) => {
        const statusConfig = getChantierStatusConfig(chantier.chantier_status);
        return (
          <div key={chantier.id} className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <HardHat className="w-4 h-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-amber-900 truncate">
                {chantier.label ? `Chantier · ${chantier.label}` : 'Chantier'}
              </h4>
              <span
                className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium text-white"
                style={{ backgroundColor: statusConfig.color }}
              >
                {statusConfig.label}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {chantier.won_date && (
                <p className="text-secondary-600">
                  <span className="text-secondary-400">Gagné le :</span> {formatDateFR(chantier.won_date)}
                </p>
              )}
              {chantier.equipment_order_status && (
                <p className="text-secondary-600">
                  <span className="text-secondary-400">Équipement :</span> {orderLabels[chantier.equipment_order_status] || '—'}
                </p>
              )}
              {chantier.materials_order_status && (
                <p className="text-secondary-600">
                  <span className="text-secondary-400">Matériaux :</span> {orderLabels[chantier.materials_order_status] || '—'}
                </p>
              )}
            </div>
            {chantier.chantier_notes && (
              <p className="text-xs text-secondary-500 italic">{chantier.chantier_notes}</p>
            )}
            {/* PV de réception, PV de levée : le chantier porte ensuite son fichier, on relit. */}
            <DocumentsChantier chantier={chantier} onUpdated={load} />
          </div>
        );
      })}
    </div>
  );
};

export const TabInterventions = ({ projectId, clientId }) => {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const { can } = useCanAccess();
  const { interventions, isLoading, error, refresh } = useProjectInterventions(projectId);
  const { members } = useTeamMembers(orgId);
  const [ouverte, setOuverte] = useState(null); // id de l'intervention dont la fiche est ouverte

  const aujourdhui = aujourdhuiLocal();
  const nomsTechniciens = useMemo(
    () => new Map(members.map((m) => [String(m.id), m.display_name || [m.first_name, m.last_name].filter(Boolean).join(' ')])),
    [members],
  );
  const lignes = useMemo(() => ordonnerInterventions(interventions, aujourdhui), [interventions, aujourdhui]);
  const parentCount = useMemo(() => interventions.filter((i) => !i.parent_id).length, [interventions]);

  // Certificats des interventions listées : c'est eux qui disent quelle ligne a un document.
  // Liste inconnue (chargement, erreur) ≠ « aucun certificat » : l'erreur est dite plus bas.
  const idsInterventions = useMemo(() => interventions.map((i) => i.id).sort(), [interventions]);
  const { data: certificats, error: certificatsEnErreur } = useQuery({
    queryKey: [...certificatKeys.documents(orgId, projectId), idsInterventions],
    queryFn: () => unwrapResult(certificatsService.listForInterventions(orgId, idsInterventions)),
    enabled: !!orgId && !!projectId && idsInterventions.length > 0,
    staleTime: 60_000,
  });
  const certificatDe = useMemo(() => certificatsParIntervention(certificats), [certificats]);

  // La fiche Entretien / SAV ne s'ouvre que pour une carte du kanban, et pour qui a le droit de la voir.
  const peutVoirCartes = can('entretiens', 'view') || can('sav', 'view');
  const peutOuvrir = (i) => peutVoirCartes && !i.parent_id && !!i.workflow_status
    && ['entretien', 'sav'].includes(i.intervention_type);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section chantier (lecture seule) */}
      <ChantierSummary clientId={clientId} />

      {error ? (
        // Lecture refusée ou en échec : le dire. Une liste vide ici se lirait « ce client n'a jamais rien eu ».
        <div className="flex items-start justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="flex items-start gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            Les interventions de ce client n&apos;ont pas pu être lues.
          </p>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-800 bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Réessayer
          </button>
        </div>
      ) : interventions.length === 0 ? (
        <div className="text-center py-12">
          <Wrench className="w-12 h-12 text-secondary-300 mx-auto" />
          <p className="mt-4 text-secondary-700 font-medium">Aucune intervention</p>
          <p className="mt-1 text-sm text-secondary-500">Les entretiens et les demandes SAV de ce client apparaîtront ici.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-secondary-500">
            {parentCount} intervention{parentCount !== 1 ? 's' : ''}
          </p>
          {certificatsEnErreur && (
            <p className="flex items-start gap-2 p-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              Les certificats n&apos;ont pas pu être lus : les documents des entretiens ne sont pas affichés.
            </p>
          )}
          <div className="space-y-3">
            {lignes.map((i) => (i.parent_id ? (
              <ChildCard key={i.id} intervention={i} />
            ) : (
              <InterventionCard
                key={i.id}
                intervention={i}
                certificat={certificatDe.get(i.id) || null}
                aujourdhui={aujourdhui}
                nomsTechniciens={nomsTechniciens}
                onOpen={peutOuvrir(i) ? (item) => setOuverte(item.id) : null}
              />
            )))}
          </div>
        </>
      )}

      {ouverte && (
        <FicheInterventionCarte
          interventionId={ouverte}
          onClose={() => setOuverte(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: interventionKeys.byProject(orgId, projectId) })}
        />
      )}
    </div>
  );
};
