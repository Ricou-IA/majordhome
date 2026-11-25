/**
 * EntretienSAVCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte individuelle pour le kanban Entretien & SAV.
 * Bandeau gauche coloré par type (bleu entretien / orange SAV) ; pastilles en tons st-*.
 * Hauteur FIXE (comme la carte chantier) : nom + montant, ville, type et repères, puis une
 * ligne du bas (suites d'un réalisé en pastilles partagées avec le chantier — RepereCarte —,
 * certificat à faire, devis fléché ou invitation). Ni tag « Contrat » ni numéro de contrat,
 * ni lien de prise de RDV (Eric 2026-11-23).
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState } from 'react';
import { MapPin, Wrench, ClipboardCheck, Euro, MessageSquare, Archive, Phone, PhoneForwarded, Receipt, Undo2, Mail, AlertTriangle, Camera, FileText } from 'lucide-react';
import { RepereCarte, RepereBouton, RangeeReperes } from '../shared/RepereCarte';
import { piecesEnAttente } from '@/lib/kanbanEntretienSav';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { savService } from '@services/sav.service';
import { invoicesService } from '@services/invoices.service';
import { PARTS_ORDER_STATUSES } from '@services/sav.service';
import { useQueryClient } from '@tanstack/react-query';
import { entretienSavKeys } from '@hooks/cacheKeys';
import { usePennylaneEnabled, useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';
import { useRetryInvoiceExport } from '@hooks/useInvoices';
import { moduleActif } from '@/lib/modules';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { invoicingSettings, invoiceErrorMessage } from '@/lib/invoiceDocumentModel';
import { anomaliesDeCarte } from '@/lib/certificatAnomalies';
import { generateInvoicePdfBlob } from '../facturation/InvoicePDF';
import CancelInvoiceDialog from '../facturation/CancelInvoiceDialog';
import SendInvoiceEmailDialog from '../facturation/SendInvoiceEmailDialog';
import FacturerEntretienDialog from './FacturerEntretienDialog';
import { SAVUrgencyBadge } from './SAVUrgency';
import { montantDevisSav, devisDeReference } from '@/lib/savDevis';
import { mentionProjet } from '@/lib/savProjet';
import { QUOTE_STATUSES } from '@services/devis.service';

// ============================================================================
// CONSTANTES VISUELLES
// ============================================================================

/** Hachures posées sur la bande de couleur : même motif à 45° que la pose provisoire du planning. */
const HACHURE_PIECES = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.35) 0 4px, transparent 4px 8px)',
};

/** Ton de la mention du projet relié à une demande SAV (mentionProjet de src/lib/savProjet.js). */
const TON_PROJET = {
  info: 'bg-st-info-bg text-st-info',
  ok: 'bg-st-ok-bg text-st-ok',
  alerte: 'bg-st-alerte-bg text-st-alerte',
  neutre: 'bg-secondary-100 text-secondary-600',
};

const TYPE_CONFIG = {
  entretien: {
    label: 'Entretien',
    color: '#3B82F6',
    bgClass: 'bg-secondary-100 text-secondary-700',
    stripeClass: 'bg-blue-500',
    Icon: ClipboardCheck,
  },
  sav: {
    label: 'SAV',
    color: '#F97316',
    bgClass: 'bg-secondary-100 text-secondary-700',
    stripeClass: 'bg-orange-500',
    Icon: Wrench,
  },
};

function PartsOrderBadge({ status }) {
  if (!status) return null;
  const config = PARTS_ORDER_STATUSES.find(s => s.value === status);
  if (!config) return null;

  const colorMap = {
    commande: 'bg-st-attente-bg text-st-attente',
    recu: 'bg-st-ok-bg text-st-ok',
  };

  return (
    <span className={`text-caption font-medium px-1.5 py-0.5 rounded ${colorMap[status] || 'bg-secondary-100 text-secondary-600'}`}>
      {config.label}
    </span>
  );
}

// ============================================================================
// COMPOSANT
// ============================================================================

/** « Invité le 1/10 · page ouverte · relancé le 8/10 · à appeler » — suivi de l'invitation auto-RDV du mois. */
function libelleInvitation(inv) {
  if (!inv) return null;
  const jour = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });
  const parts = [];
  if (inv.sent_at) parts.push(`Invité le ${jour(inv.sent_at)}`);
  else if (inv.outcome === 'phone') parts.push('Sans e-mail');
  if (inv.opened_at && !inv.booked_at) parts.push('page ouverte');
  if (inv.outcome === 'no_slot') parts.push('aucun créneau');
  if (inv.sms_relance_at) parts.push(`relancé le ${jour(inv.sms_relance_at)}`);
  if (!inv.booked_at && (inv.escalade_appel_at || inv.outcome === 'phone' || inv.outcome === 'no_slot')) parts.push('à appeler');
  if (inv.relances > 0) parts.push(`${inv.relances + 1}ᵉ mois`);
  return parts.length ? parts.join(' · ') : null;
}

export function EntretienSAVCard({ item, onClick, onRefresh, orgId, invitation = null, canRanger = true }) {
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(item.sms_avis_sent === true);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const { isTeamLeaderOrAbove } = useAuth();
  const pennylaneEnabled = usePennylaneEnabled();
  const { settings } = useOrgSettings();
  const isHubMode = pennylaneInvoiceSettings(settings).mode === 'hub';
  const retryExport = useRetryInvoiceExport(orgId);
  const needsExportRetry = isHubMode && !!item.invoice_id && (item.invoice_import_status === 'pending' || item.invoice_import_status === 'error');
  const queryClient = useQueryClient();
  const type = item.intervention_type;
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.entretien;
  // Anomalies relevées sur les certificats (racine + enfants), agrégées par la vue — la
  // source reste le certificat (spec 2026-10-10). Visibles sans ouvrir la fiche.
  const anomalies = anomaliesDeCarte(item);
  // Push MDH → Pennylane (spec 2026-09-21) : entretiens seulement, org avec PL activé.
  // Les SAV restent hors périmètre (montant issu d'un devis PL).
  // Mode hub : Majord'home émet lui-même, l'intégration Pennylane n'est pas requise.
  const canPushInvoice = (pennylaneEnabled || isHubMode) && type === 'entretien';
  // Envoi de la facture par e-mail (module Communication, spec 2026-09-23) : renvoi depuis
  // la carte facturée, indépendant du mode hub/Pennylane.
  const canSendInvoiceEmail = moduleActif(settings, 'communication') && !!item.invoice_id && type === 'entretien';

  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';
  // Montant : SAV = devis + contrat si entretien inclus, Entretien = contrat
  const devis = montantDevisSav(item);
  const devisFleche = type === 'sav' ? devisDeReference(item.sav_quotes) : null;
  const contrat = Number(item.contract_amount) || 0;
  const amount = type === 'sav'
    ? devis + (item.includes_entretien ? contrat : 0)
    : contrat;

  // Date pertinente : RDV actif (vue dérivée) > scheduled_date > created_at
  const dateStr = (item.has_active_rdv && item.next_rdv_date)
    ? item.next_rdv_date
    : (item.scheduled_date || item.created_at);
  const dateObj = dateStr ? new Date(dateStr) : null;
  const dayNum = dateObj ? dateObj.getDate() : '';
  const monthShort = dateObj
    ? dateObj.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
    : '';

  // "Ranger" la carte (À planifier) : suppression + undo toast. Le contrat redevient
  // planifiable dans l'outil secteur (il sort de plannedContractIds).
  const handleRanger = async (e) => {
    e.stopPropagation();
    // Rafraîchit le kanban ET l'outil de programmation (plannedContractIds est une
    // query sous entretienSavKeys.all → invalidation = dégrisement instant du secteur).
    const refreshAll = () => {
      onRefresh?.();
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    };
    const snapshot = {
      orgId,
      clientId: item.client_id,
      contractId: item.effective_contract_id || item.contract_id || null,
      projectId: item.project_id || item.client_project_id,
      scheduledDate: item.scheduled_date || null,
    };
    const { error } = await savService.deleteEntretienCard(item.id);
    if (error) {
      toast.error('Impossible de ranger la carte');
      return;
    }
    refreshAll();
    toast('Carte rangée', {
      description: name,
      action: {
        label: 'Annuler',
        onClick: async () => {
          const { error: rErr } = await savService.createEntretien(snapshot);
          if (rErr) toast.error('Annulation impossible');
          refreshAll();
        },
      },
    });
  };

  const invoiced = !!item.invoice_id || !!item.invoiced_at;

  // Encaissé : la carte part dans la colonne « Encaissé » (repliée) ; « Annuler » la ramène.
  const handleEncaisser = async () => {
    const { error } = await savService.updateWorkflowStatus(item.id, 'facture');
    if (error) {
      toast.error('Erreur mise à jour encaissement — la carte reste ouverte');
      return;
    }
    onRefresh?.();
    toast.success('Carte encaissée', {
      description: `${name} · rangée dans « Encaissé »`,
      action: {
        label: 'Annuler',
        onClick: async () => {
          const { error: rErr } = await savService.updateWorkflowStatus(item.id, 'realise');
          if (rErr) toast.error('Retour en « Réalisé » impossible');
          onRefresh?.();
        },
      },
    });
  };

  const handleMarquageFacture = async () => {
    const next = item.invoiced_at ? null : new Date().toISOString();
    const { error } = await savService.updateFields(item.id, { invoiced_at: next });
    if (error) {
      toast.error('Erreur mise à jour facturation');
      return;
    }
    toast.success(next ? 'Marqué facturé' : 'Marquage facturé retiré');
    onRefresh?.();
  };

  const handleFacture = async () => {
    if (item.invoice_id) {
      // Mode hub : `invoice_id` pointe une facture Majord'home archivée ; mode Pennylane : id PL, rien à ouvrir.
      if (!isHubMode) return;
      const { data: url, error } = await invoicesService.getPdfUrl(orgId, item.invoice_id);
      if (error) toast.error(error.message || 'PDF non archivé');
      else window.open(url, '_blank', 'noopener');
      return;
    }
    if (!item.invoiced_at && canPushInvoice) { setInvoiceOpen(true); return; }
    await handleMarquageFacture();
  };

  const handleAvis = async () => {
    if (smsSent) return;
    setSmsLoading(true);
    const { data, error } = await savService.sendAvisRequest({
      interventionId: item.id,
      clientId: item.client_id,
      clientFirstName: item.client_first_name,
      clientPhone: item.client_phone,
      clientPhoneSecondary: item.client_phone_secondary,
      orgId,
    });
    setSmsLoading(false);
    if (error) {
      toast.error(error.message || 'Erreur envoi demande d\'avis');
    } else {
      setSmsSent(true);
      const count = data?.sentCount || 1;
      toast.success(count > 1 ? `${count} demandes d'avis envoyées` : 'Demande d\'avis envoyée');
    }
  };

  const handleRejeuImport = async () => {
    try {
      const r = await retryExport.mutateAsync({
        invoiceId: item.invoice_id,
        company: buildCompanyInfo(settings),
        invoicing: invoicingSettings(settings),
        renderPdf: generateInvoicePdfBlob,
        pennylaneEnabled,
      });
      toast.success(
        r.alreadyImported && !r.imported
          ? `Facture ${r.number} déjà importée dans Pennylane`
          : `Facture ${r.number}${r.pdfRegenerated ? ' — PDF régénéré,' : ''} importée dans Pennylane`,
      );
    } catch (err) {
      toast.error(invoiceErrorMessage(err, 'Le rejeu de l’export a échoué'), { duration: 15000 });
    }
  };

  const titreFacture = item.invoice_id
    ? (isHubMode ? 'Facture émise — ouvrir le PDF' : 'Facture créée sur Pennylane')
    : item.invoiced_at
      ? 'Facturé — cliquer pour retirer le marquage'
      : (canPushInvoice ? (isHubMode ? 'Émettre la facture' : 'Créer la facture sur Pennylane') : 'Marquer comme facturé');
  const repereFacture = { etat: invoiced ? 'fait' : 'a_faire', libelle: 'Facturé', titre: titreFacture };

  // Ligne du bas (hauteur fixe) : une seule information, par ordre d'utilité.
  const certificatAFaire = (type === 'entretien' || (type === 'sav' && item.includes_entretien))
    && item.workflow_status === 'planifie'
    && !!(item.effective_contract_id || item.contract_id);
  const invitationLibelle = item.workflow_status === 'a_planifier' ? libelleInvitation(invitation) : null;
  // SAV dont les pièces ne sont pas reçues : bande hachurée, comme la pose provisoire d'un chantier.
  const attentePieces = piecesEnAttente(item);
  const projetMention = mentionProjet(item.projet);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') onClick?.(item);
      }}
      className="relative w-full h-[112px] text-left bg-white rounded-lg border border-secondary-200 shadow-sm hover:shadow-md transition-all overflow-hidden group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      {item.workflow_status === 'a_planifier' && canRanger && (
        <button
          type="button"
          onClick={handleRanger}
          title="Ranger la carte (la retirer de « À planifier »)"
          className="absolute bottom-1 left-1 z-10 p-1 rounded-md text-white/70 hover:text-white hover:bg-white/25 transition-all"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex h-full">
        {/* Bandeau gauche coloré avec date (gris une fois encaissée) */}
        <div
          className={`w-12 flex-shrink-0 flex flex-col items-center justify-center py-2 text-white ${item.workflow_status === 'facture' ? 'bg-secondary-400' : config.stripeClass}`}
          style={attentePieces ? HACHURE_PIECES : undefined}
          title={attentePieces ? 'Pièces commandées, pas encore reçues' : undefined}
        >
          <span className="text-sm font-bold leading-none">{dayNum}</span>
          <span className="text-caption uppercase leading-tight mt-0.5">{monthShort}</span>
        </div>

        {/* Contenu : quatre lignes, la dernière collée en bas */}
        <div className="flex-1 min-w-0 px-3 py-2 flex flex-col">
          {/* Ligne 1 : Nom + montant */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm leading-5 text-secondary-900 truncate">
              {name}
            </span>
            {(amount > 0 || Number(item.parts_total_ttc) > 0) && (
              <span className="flex items-baseline gap-1 flex-shrink-0">
                {amount > 0 && (
                  <span className="text-xs font-semibold text-secondary-900">
                    {formatEuro(amount)}
                  </span>
                )}
                {Number(item.parts_total_ttc) > 0 && (
                  <span className="text-caption font-medium text-st-attente" title="Pièces de rechange (à facturer en plus)">
                    +{formatEuro(Number(item.parts_total_ttc))}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Ligne 2 : Code postal + ville */}
          <div className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-secondary-500">
            <MapPin className="w-3 h-3 text-secondary-400 flex-shrink-0" />
            <span className="truncate">
              {[item.client_postal_code, item.client_city].filter(Boolean).join(' ') || '—'}
            </span>
          </div>

          {/* Ligne 3 : type + repères, sur une seule ligne */}
          <div className="mt-1.5 flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap">
            <span className={`text-caption font-semibold px-1.5 py-0.5 rounded shrink-0 ${config.bgClass}`}>
              {config.label}
            </span>
            <SAVUrgencyBadge item={item} />
            {item.tags?.includes('Web') && (
              <span className="text-caption font-semibold px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-600 shrink-0">
                Web
              </span>
            )}
            {type === 'sav' && item.includes_entretien && (
              <span className="text-caption font-semibold px-1.5 py-0.5 rounded bg-st-info-bg text-st-info shrink-0">
                Entretien à faire
              </span>
            )}
            {/* Demande reliée à un projet (devis de remplacement) : où il en est dans Leads */}
            {projetMention && (
              <span
                className={`text-caption font-semibold px-1.5 py-0.5 rounded shrink-0 ${TON_PROJET[projetMention.ton]}`}
                title="Devis de remplacement : la demande se suit dans Leads, le chantier se crée à l'acceptation"
              >
                {projetMention.texte}
              </span>
            )}
            {/* Anomalie relevée sur un certificat : une icône seulement, le détail en infobulle
                (recette Eric 2026-10-10 : « pas tout le commentaire, ça fait trop chargé ») */}
            {anomalies.length > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-caption font-semibold px-1.5 py-0.5 rounded bg-st-attente-bg text-st-attente shrink-0"
                title={anomalies.map((a) => `${a.equipement ? `${a.equipement} : ` : ''}${a.detail || a.bilanLabel}${a.actionLabel ? ` · ${a.actionLabel}` : ''}${a.savId ? ' · SAV créé' : ''}${a.photoPlaquePath ? ' · photo de plaque' : (a.photoPlaqueAbsence ? ` · pas de photo de plaque (${a.photoPlaqueAbsence})` : '')}`).join('\n')}
              >
                <AlertTriangle className="w-3 h-3" />
                {anomalies.length > 1 ? anomalies.length : null}
                {/* La photo de la plaque suit la carte : un appareil photo dès qu'un certificat en porte une */}
                {anomalies.some((a) => a.photoPlaquePath) && <Camera className="w-3 h-3" />}
              </span>
            )}
            {type === 'sav' && item.sav_origin === 'entretien' && (
              <span className="text-caption font-semibold px-1.5 py-0.5 rounded bg-st-attente-bg text-st-attente shrink-0" title="Demande ouverte à la suite d'un entretien (certificat)">
                Suite d&apos;entretien
              </span>
            )}
            {type === 'sav' && item.parts_order_status && (
              <PartsOrderBadge status={item.parts_order_status} />
            )}
            {item.call_count > 0 && (
              <span className="text-xs flex items-center gap-0.5 text-st-attente shrink-0"
                    title={`${item.call_count} appel${item.call_count > 1 ? 's' : ''}${item.last_call_result === 'voicemail' ? ' · répondeur' : ''}`}>
                <Phone className="h-3 w-3" />{item.call_count}
              </span>
            )}
            {item.last_call_result === 'callback' && (
              <span className="text-xs flex items-center gap-0.5 text-st-attente shrink-0" title="À rappeler">
                <PhoneForwarded className="h-3 w-3" />
              </span>
            )}
          </div>

          {/* Ligne 4 (bas de carte) : suites d'un réalisé — mêmes pastilles que le chantier
              réceptionné —, certificat à faire, devis fléché ou invitation */}
          <RangeeReperes actif={item.workflow_status === 'realise'} className="mt-auto flex items-center gap-0.5 min-w-0 overflow-hidden">
            {item.workflow_status === 'realise' ? (
              <>
                {isTeamLeaderOrAbove ? (
                  <RepereBouton
                    repere={repereFacture}
                    icone={Receipt}
                    disabled={!!item.invoice_id && !isHubMode}
                    onClick={handleFacture}
                  />
                ) : <RepereCarte repere={repereFacture} />}
                <RepereBouton
                  repere={{ etat: 'a_faire', libelle: 'Encaissé', titre: 'Marquer comme encaissé (la carte passe dans « Encaissé »)' }}
                  icone={Euro}
                  onClick={handleEncaisser}
                />
                {smsSent ? (
                  <RepereCarte repere={{ etat: 'fait', libelle: 'Avis', titre: 'Demande d\'avis déjà envoyée' }} />
                ) : (
                  <RepereBouton
                    repere={{ etat: 'a_faire', libelle: 'Avis', titre: 'Envoyer une demande d\'avis au client par SMS' }}
                    icone={MessageSquare}
                    enCours={smsLoading}
                    onClick={handleAvis}
                  />
                )}
                {isTeamLeaderOrAbove && needsExportRetry && pennylaneEnabled && (
                  <RepereBouton
                    repere={{
                      etat: 'attention',
                      libelle: 'Import PL',
                      titre: item.invoice_import_status === 'error' ? 'L’import Pennylane a échoué : rejouer' : 'Import Pennylane non fait : rejouer',
                    }}
                    enCours={retryExport.isPending}
                    onClick={handleRejeuImport}
                  />
                )}
                {isTeamLeaderOrAbove && canSendInvoiceEmail && (
                  <RepereBouton
                    repere={{ etat: 'a_faire', libelle: 'E-mail', titre: 'Envoyer la facture par e-mail au client' }}
                    icone={Mail}
                    onClick={() => setSendEmailOpen(true)}
                  />
                )}
                {isTeamLeaderOrAbove && isHubMode && item.invoice_id && item.invoice_import_status != null && type === 'entretien' && (
                  <RepereBouton
                    repere={{ etat: 'a_faire', libelle: 'Avoir', titre: 'Annuler cette facture par un avoir' }}
                    icone={Undo2}
                    onClick={() => setCancelOpen(true)}
                  />
                )}
              </>
            ) : item.workflow_status === 'facture' ? (
              <span className="text-xs text-secondary-500 truncate" title="Glisser la carte dans « Réalisé » pour la rouvrir">
                Encaissé{invoiced ? ' · facturé' : ''}
              </span>
            ) : certificatAFaire ? (
              <span className="inline-flex min-w-0 items-center gap-1 px-2 py-0.5 bg-st-info text-white text-xs font-medium rounded-md whitespace-nowrap">
                <ClipboardCheck className="w-3 h-3 shrink-0" />
                <span className="truncate">Certificat à faire</span>
              </span>
            ) : devisFleche ? (
              <span className="flex items-center gap-1 text-xs text-secondary-600 min-w-0">
                <FileText className="w-3 h-3 text-secondary-400 flex-shrink-0" />
                <span className="truncate">
                  {devisFleche.quote_number || 'Devis'}
                  {' · '}
                  {QUOTE_STATUSES.find((s) => s.value === devisFleche.status)?.label || devisFleche.status}
                </span>
              </span>
            ) : invitationLibelle ? (
              <span className="text-xs text-st-info truncate" title={invitationLibelle}>{invitationLibelle}</span>
            ) : null}
          </RangeeReperes>
        </div>
      </div>

      {/* Fenêtres ouvertes depuis la carte : le portail Radix remonte les clics React jusqu'à la carte, on les arrête ici. */}
      {invoiceOpen && (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <FacturerEntretienDialog
            item={item}
            orgId={orgId}
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            onCreated={() => onRefresh?.()}
          />
        </div>
      )}
      {cancelOpen && (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <CancelInvoiceDialog item={item} orgId={orgId} open={cancelOpen} onOpenChange={setCancelOpen} onDone={() => onRefresh?.()} />
        </div>
      )}
      {sendEmailOpen && (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <SendInvoiceEmailDialog item={item} orgId={orgId} open={sendEmailOpen} onOpenChange={setSendEmailOpen} />
        </div>
      )}
    </div>
  );
}

export default EntretienSAVCard;
