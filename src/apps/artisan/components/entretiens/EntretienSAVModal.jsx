/**
 * EntretienSAVModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale détail pour un item Entretien ou SAV.
 *
 * Features :
 * - Header avec tag type + statut + lien fiche client
 * - Infos client + date dernier entretien
 * - Toggle "Réaliser Entretien" (tag la carte SAV, pas de nouvelle carte)
 * - Description SAV (SAV uniquement)
 * - Commande pièces : Commandé / Reçu (Reçu → auto-transition a_planifier)
 * - Devis : Envoyé → devis_envoye, Accepté → pieces_commandees, Refusé → stocké
 * - Notes
 * - Bouton "Enregistrer" unique pour sauvegarder tous les champs modifiés
 * - Footer : boutons transition back/forward
 * - Transition "Planifié" → ouvre la fenêtre « Nouveau RDV » rattachée à la carte
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Loader2, ArrowLeft, ArrowRight, Save,
  User, Phone, ClipboardCheck, Wrench, Mail, FileText,
  ExternalLink, Calendar, Check, UserPlus, Archive, Link2, AlertTriangle, Zap, CheckCircle2, Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { anomaliesDeCarte } from '@/lib/certificatAnomalies';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { formatEuro, formatDateShortFR } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { entretienSavKeys } from '@hooks/cacheKeys';
import { AdresseItineraire } from '@/apps/artisan/components/shared/AdresseItineraire';
import { formaterAdresse } from '@/lib/itineraire';
import {
  savService,
  getStatusConfig,
  getTransitions,
  KANBAN_COLUMNS,
} from '@services/sav.service';
import { autoRdvService } from '@services/autoRdv.service';
import { clientsService } from '@services/clients.service';
import { equipmentsService } from '@services/equipments.service';
import { contractsService } from '@services/contracts.service';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { libelleEquipement } from '@/lib/equipmentReferential';
import { EntretienPartsSection } from './EntretienPartsSection';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { useTeamMembers } from '@hooks/useAppointments';
import { FormField, TextArea } from '@apps/artisan/components/FormFields';
import { PoserRdvModal } from '@apps/artisan/components/planning/PoserRdvModal';
import { clientDepuisCarte } from '@/lib/eventForm';
import { MODAL_PANEL_PHONE, MODAL_FOOTER_PHONE } from '@/lib/modalClasses';
import { SAVPartsSection } from './SAVPartsSection';
import { SAVDevisSection } from './SAVDevisSection';
import { SAVUrgencySelect, SAVUrgencyBadge } from './SAVUrgency';
import { urgenceDe } from '@/lib/savUrgency';
import { peutCloturerSansPlanifier, limiteALaCloture, peutIdentifierPieces } from '@/lib/savCloture';
import { SAVInterventionFaiteModal } from './SAVInterventionFaiteModal';
import { SAVLinkedQuotes } from './SAVLinkedQuotes';
import { SAVModelPartsSection } from './SAVModelPartsSection';
import { CertificatsSection } from './CertificatsSection';
import { PhotoPlaqueAnomalie } from './PhotoPlaqueAnomalie';
import { logger } from '@lib/logger';

// ============================================================================
// CONSTANTES
// ============================================================================

const TYPE_LABELS = {
  entretien: { label: 'Entretien', bgClass: 'bg-blue-100 text-blue-700', Icon: ClipboardCheck },
  sav:       { label: 'SAV',       bgClass: 'bg-orange-100 text-orange-700', Icon: Wrench },
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretienSAVModal({ item, onClose, onUpdated, initialScheduling = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const { can, effectiveRole } = useCanAccess();
  const orgId = organization?.id;
  const [lienBusy, setLienBusy] = useState(false); // copie du lien de prise de RDV (auto-RDV)
  const [atelierOuvert, setAtelierOuvert] = useState(false); // mode atelier des pièces : la fiche s'élargit

  const {
    updateWorkflowStatus,
    unscheduleEntretien,
    updateFields,
    isUpdatingStatus: isUpdatingWorkflow,
    isUnscheduling,
    isSavingFields,
  } = useEntretienSAVMutations();
  // Les boutons de transition se figent pendant une transition OU une déplanification
  const isUpdatingStatus = isUpdatingWorkflow || isUnscheduling;

  // Techniciens pour le SchedulingAssistant (mode SAV-Entretien)
  const { members: teamMembers } = useTeamMembers(orgId);

  // État local — tous les champs éditables
  const [notes, setNotes] = useState(item?.report_notes || '');
  const [savDesc, setSavDesc] = useState(item?.sav_description || '');
  const [partsOrder, setPartsOrder] = useState(item?.parts_order_status || null);
  const [devisAmount, setDevisAmount] = useState(item?.devis_amount || null);
  const [devisStatus, setDevisStatus] = useState(item?.devis_status || null);
  const [includesEntretien, setIncludesEntretien] = useState(item?.includes_entretien || false);
  const [urgence, setUrgence] = useState(() => urgenceDe(item)); // SAV uniquement (null sinon)
  const [lastEntretienDate, setLastEntretienDate] = useState(null);

  // État planification
  const [showScheduling, setShowScheduling] = useState(initialScheduling); // ouverte sur l'assistant après « Créer et planifier »
  const [showCloture, setShowCloture] = useState(false); // fenêtre « Intervention faite » (SAV sans planification)
  const [confirmAnnuler, setConfirmAnnuler] = useState(false); // « Annuler la demande » (SAV, org_admin)
  const [annulation, setAnnulation] = useState(false);

  // --- Certificats multi-équipements ---
  const isEntretien = item?.intervention_type === 'entretien';

  // Contrat EFFECTIF (vue `majordhome_entretien_sav`, migration 20260728_1) :
  // `interventions.contract_id` n'est qu'une photo prise à la création de la carte.
  // Elle est vide quand le contrat a été saisi APRÈS le RDV — la vue retombe alors
  // sur le contrat actif du client. Tout ce qui suit doit consommer CETTE valeur,
  // jamais `item.contract_id` brut, sinon la section certificats reste muette.
  const contractId = item?.effective_contract_id || item?.contract_id || null;


  // Certificats : seulement une fois le RDV planifié (déclencheur de la suite),
  // pas en "Demande de contrat" ni "À planifier"
  const showCertificatsSection = isEntretien && contractId
    && !['demande_contrat', 'a_planifier'].includes(item?.workflow_status);

  // Charger la date du dernier entretien réalisé via maintenance_visits (source de vérité)
  useEffect(() => {
    if (!contractId) return;

    supabase
      .from('majordhome_maintenance_visits')
      .select('visit_date')
      .eq('contract_id', contractId)
      .eq('status', 'completed')
      .order('visit_date', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0 && data[0].visit_date) {
          setLastEntretienDate(data[0].visit_date);
        }
      });
  }, [contractId]);

  // Équipements du client (marque, modèle) et ceux sous contrat (recette Eric 2026-10-10 :
  // « indiquer la marque et le modèle ; sous contrat d'une couleur, hors contrat d'une autre »).
  // Sans `contract_equipments` (contrat legacy) on ne peut pas distinguer : chips neutres.
  const [equipementsClient, setEquipementsClient] = useState([]);
  const [idsSousContrat, setIdsSousContrat] = useState(null);
  const { index: referentiel } = useEquipmentReferential();
  useEffect(() => {
    if (!item?.client_id) return;
    let actif = true;
    Promise.all([
      equipmentsService.getClientEquipments(item.client_id),
      contractId ? contractsService.getContractEquipments(contractId) : Promise.resolve({ data: [] }),
    ]).then(([client, contrat]) => {
      if (!actif) return;
      setEquipementsClient(client?.data || []);
      const liens = contrat?.data || [];
      setIdsSousContrat(liens.length ? new Set(liens.map((eq) => eq.id)) : null);
    });
    return () => { actif = false; };
  }, [item?.client_id, contractId]);

  // --- Dirty check : savoir si quelque chose a changé ---
  // (déclaré AVANT early return — règle React Hooks : ordre stable)
  const isDirty = useMemo(() => {
    if (!item) return false;
    if (notes !== (item.report_notes || '')) return true;
    if (savDesc !== (item.sav_description || '')) return true;
    if (partsOrder !== (item.parts_order_status || null)) return true;
    if (devisAmount !== (item.devis_amount || null)) return true;
    if (devisStatus !== (item.devis_status || null)) return true;
    if (includesEntretien !== (item.includes_entretien || false)) return true;
    if (urgence !== urgenceDe(item)) return true;
    return false;
  }, [notes, savDesc, partsOrder, devisAmount, devisStatus, includesEntretien, urgence, item]);


  if (!item) return null;

  const type = item.intervention_type;
  const typeConfig = TYPE_LABELS[type] || TYPE_LABELS.entretien;
  const statusConfig = getStatusConfig(type, item.workflow_status);
  const canEditSAV = can('sav', 'edit') || can('entretiens', 'edit');
  const _canCreateSAV = can('sav', 'create');
  // Anomalies relevées sur les certificats de la carte (source = certificat, agrégé par la vue)
  const anomalies = anomaliesDeCarte(item);

  const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

  // Équipements rangés sous le contrat ou à part (sans liens contrat ↔ équipements : tous à part)
  const equipementsSousContrat = idsSousContrat ? equipementsClient.filter((eq) => idsSousContrat.has(eq.id)) : [];
  const autresEquipements = idsSousContrat ? equipementsClient.filter((eq) => !idsSousContrat.has(eq.id)) : equipementsClient;
  // SAV : colonnes flex (gap, pas space-y) pour que `mt-auto` cale description et notes en bas
  const colonneClass = item.intervention_type === 'sav' ? 'flex flex-col gap-6' : 'space-y-6';

  // --- Handlers ---
  const handleTransition = async (newStatus) => {
    // Intercepter "planifie" → ouvrir le panneau de planification
    if (newStatus === 'planifie') {
      setShowScheduling(true);
      return;
    }

    // Retour Planifié → À planifier = déplanifier : les RDV liés sont supprimés
    // du planning avec la carte (sinon créneaux fantômes — vécu 2026-09-18).
    if (newStatus === 'a_planifier' && item.workflow_status === 'planifie') {
      try {
        const { deleted } = await unscheduleEntretien(item);
        toast.success(
          deleted > 0
            ? `Carte remise à planifier · ${deleted} RDV supprimé${deleted > 1 ? 's' : ''} du planning`
            : 'Carte remise à planifier',
        );
        onUpdated?.();
        onClose();
      } catch {
        // Toast d'erreur déjà émis par la mutation (useEntretienSAVMutations)
      }
      return;
    }

    try {
      await updateWorkflowStatus(item.id, newStatus);
      toast.success('Statut mis à jour');
      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur de transition');
    }
  };

  // Commande « personnes × jours » du SAV (spec 2026-09-21) : l'entretien est
  // dimensionné par le barème, le SAV « peut être 3 jours ou 1 h ». Persistée sur
  // l'intervention (allowlist savService.updateFields), l'assistant en dérive.
  const isSav = type === 'sav';
  const plannedTeamSize = isSav ? (item?.planned_team_size ?? null) : null;
  const plannedDays = isSav ? (item?.planned_days ?? null) : null;
  const handlePlannedOrderChange = async ({ teamSize, days }) => {
    try {
      await updateFields(item.id, { planned_team_size: teamSize, planned_days: days });
      onUpdated?.();
    } catch {
      toast.error('Impossible d\'enregistrer la commande');
    }
  };

  // RDV posés depuis la fenêtre « Nouveau RDV » (fenêtre unique, rattachée à la carte) :
  // elle crée les RDV (createAppointmentBatch, carte avancée en Planifié par le service) ;
  // ici, ce qui est propre à la carte : sa date, la fiche client web confirmée.
  const handleRdvPoses = async (slots) => {
    if (!slots?.length) return;
    try {
      await updateWorkflowStatus(item.id, 'planifie');
      await updateFields(item.id, { scheduled_date: slots[0].date });
    } catch {
      toast.warning('RDV posé, mais la carte n’a pas pu être mise à jour : vérifiez-la dans le kanban');
    }
    // Le service ne throw pas (`{ data, error }`) : un refus laisserait la fiche masquée en silence.
    if (item.client_id && item.tags?.includes('Web')) {
      const { error: draftError } = await clientsService.confirmWebDraft(item.client_id);
      if (draftError) {
        logger.error('[EntretienSAVModal] confirmWebDraft refusé:', draftError);
        toast.warning('RDV planifié, mais la fiche client web n’a pas pu être confirmée — elle reste masquée dans la liste clients');
      }
    }
    onUpdated?.();
    onClose();
  };

  // Bouton Enregistrer — sauvegarde groupée de tous les champs
  const handleSave = async () => {
    try {
      const fields = {};

      // Collecter les champs modifiés
      if (notes !== (item.report_notes || '')) {
        fields.report_notes = notes;
      }
      if (type === 'sav') {
        if (savDesc !== (item.sav_description || '')) {
          fields.sav_description = savDesc;
        }
        if (partsOrder !== (item.parts_order_status || null)) {
          fields.parts_order_status = partsOrder;
        }
        if (devisAmount !== (item.devis_amount || null)) {
          fields.devis_amount = devisAmount;
        }
        if (devisStatus !== (item.devis_status || null)) {
          fields.devis_status = devisStatus;
        }
        if (includesEntretien !== (item.includes_entretien || false)) {
          fields.includes_entretien = includesEntretien;
        }
        if (urgence !== urgenceDe(item)) {
          fields.sav_urgency = urgence;
        }
      }

      // Sauvegarder les champs (rejette sur refus → catch ci-dessous)
      await updateFields(item.id, fields);

      // Auto-transitions basées sur le devis/pièces
      let workflowChanged = false;

      // Pièces "Reçu" → a_planifier
      if (fields.parts_order_status === 'recu' && item.parts_order_status !== 'recu') {
        await updateWorkflowStatus(item.id, 'a_planifier');
        toast.success('Enregistré — pièces reçues, carte en À planifier');
        workflowChanged = true;
      }

      // Devis "Envoyé" → devis_envoye
      if (fields.devis_status === 'envoye' && item.devis_status !== 'envoye') {
        await updateWorkflowStatus(item.id, 'devis_envoye');
        toast.success('Enregistré — devis envoyé');
        workflowChanged = true;
      }

      // Devis "Accepté" → pieces_commandees
      if (fields.devis_status === 'accepte' && item.devis_status !== 'accepte') {
        await updateWorkflowStatus(item.id, 'pieces_commandees');
        toast.success('Enregistré — devis accepté, carte en Pièces commandées');
        workflowChanged = true;
      }

      if (!workflowChanged) {
        toast.success('Enregistré');
      }

      onUpdated?.();
      onClose();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  // Toggle "Réaliser Entretien" — tag la carte + ajoute/retire montant contrat au devis
  const handleToggleEntretien = () => {
    const contractAmount = Number(item.contract_amount) || 0;
    setIncludesEntretien((prev) => {
      const willInclude = !prev;
      if (contractAmount > 0) {
        setDevisAmount((currentAmount) => {
          const current = Number(currentAmount) || 0;
          return willInclude ? current + contractAmount : Math.max(0, current - contractAmount);
        });
      }
      return willInclude;
    });
  };

  // Ouvrir fiche client — confirme le draft si besoin puis navigue
  const handleOpenClient = async () => {
    if (item.client_id) {
      // Confirmer le client draft (le rend visible dans la liste clients). La fiche
      // se lit via majordhome_clients_all (drafts inclus) : on y va quand même,
      // mais un refus se dit — sinon la fiche reste masquée en silence.
      if (item.tags?.includes('Web')) {
        const { error: draftError } = await clientsService.confirmWebDraft(item.client_id);
        if (draftError) {
          logger.error('[EntretienSAVModal] confirmWebDraft refusé:', draftError);
          toast.warning('La fiche client web n’a pas pu être confirmée — elle reste masquée dans la liste clients');
        }
      }
      onClose();
      navigate(`/clients/${item.client_id}`);
    }
  };

  // Lien de prise de rendez-vous (auto-RDV) : la page que le client verra depuis
  // son mail. Miroir du maillon de EntretienSAVCard, ici lisible en clair.
  const handleCopierLien = async () => {
    if (lienBusy || !contractId) return;
    setLienBusy(true);
    try {
      const { data, error } = await autoRdvService.signerLien({ orgId, contractId });
      if (error || !data?.url) throw error || new Error('lien indisponible');
      await navigator.clipboard.writeText(data.url);
      const fin = data.expires_at ? new Date(data.expires_at).toLocaleDateString('fr-FR') : null;
      toast.success(fin ? `Lien de prise de rendez-vous copié — valable jusqu'au ${fin}` : 'Lien de prise de rendez-vous copié');
    } catch (err) {
      toast.error(`Lien non copié : ${err?.message || 'erreur'}`);
    } finally {
      setLienBusy(false);
    }
  };

  // "Ranger" la carte (À planifier) depuis la fiche : suppression + undo toast.
  // Miroir du bouton Archive de EntretienSAVCard — le contrat redevient
  // planifiable dans l'outil secteur (il sort de plannedContractIds).
  const handleRanger = async () => {
    const snapshot = {
      orgId,
      clientId: item.client_id,
      contractId,
      projectId: item.project_id || item.client_project_id,
      scheduledDate: item.scheduled_date || null,
    };
    const { error } = await savService.deleteEntretienCard(item.id);
    if (error) {
      toast.error('Impossible de ranger la carte');
      return;
    }
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    onUpdated?.();
    onClose?.();
    toast('Carte rangée', {
      description: name,
      action: {
        label: 'Annuler',
        onClick: async () => {
          const { error: rErr } = await savService.createEntretien(snapshot);
          if (rErr) toast.error('Annulation impossible');
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
          onUpdated?.();
        },
      },
    });
  };

  // « Annuler la demande » : suppression de la carte SAV (org_admin seul, comme toute suppression)
  const peutAnnulerDemande = type === 'sav' && effectiveRole === 'org_admin'
    && !['realise', 'facture'].includes(item.workflow_status);
  const handleAnnulerDemande = async () => {
    setAnnulation(true);
    const { error } = await savService.annulerDemandeSav(item.id);
    setAnnulation(false);
    if (error) {
      const messages = {
        rdv_actif: 'Un RDV est posé pour cette demande : supprimez-le du planning (ou remettez la carte « À planifier ») avant d’annuler.',
        lie: 'Cette demande est liée à un SMS ou une demande client : elle ne peut pas être supprimée.',
        non_autorise: 'Suppression refusée : réservée à l’administrateur.',
      };
      toast.error(messages[error.code] || 'Impossible d’annuler la demande');
      return;
    }
    setConfirmAnnuler(false);
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    toast.success('Demande SAV annulée');
    onUpdated?.();
    onClose?.();
  };

  // --- Transitions ---
  // Technicien sur une demande SAV en attente : un seul geste, « Intervention faite ».
  // Planifier, envoyer un devis, ranger ou déplacer la carte restent au bureau.
  const clotureSeule = limiteALaCloture(item, effectiveRole);
  const allTransitions = clotureSeule ? [] : getTransitions(type, item.workflow_status);

  const currentColumn = KANBAN_COLUMNS.find(c => c.value === item.workflow_status);
  const currentOrder = currentColumn
    ? KANBAN_COLUMNS.indexOf(currentColumn)
    : 0;

  const backTransitions = allTransitions.filter((t) => {
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    if (!col) return false; // Pas de retour vers des statuts hors-Kanban
    return KANBAN_COLUMNS.indexOf(col) < currentOrder;
  });

  const forwardTransitions = allTransitions.filter((t) => {
    // Bloquer transition → réalisé pour entretiens (certificat obligatoire)
    if (type === 'entretien' && t === 'realise') return false;
    // SAV : « Devis envoyé » suit le devis (créé depuis la fiche, statut reporté sur la carte), plus un bouton
    if (type === 'sav' && t === 'devis_envoye') return false;
    const col = KANBAN_COLUMNS.find(c => c.value === t);
    // Statut hors-Kanban (ex: facturé) = toujours forward
    if (!col) return true;
    return KANBAN_COLUMNS.indexOf(col) > currentOrder;
  });

  // Planifier = la fenêtre unique « Nouveau RDV », rattachée à cette carte (type figé)
  if (showScheduling) {
    return (
      <PoserRdvModal
        client={item.client_id ? clientDepuisCarte(item) : null}
        members={teamMembers}
        orgId={orgId}
        attachContext={{
          interventionId: item.id,
          lockedType: isSav ? 'service' : 'maintenance',
          // La demande décrite sur la fiche reste visible dans la fenêtre RDV
          demandeSav: isSav ? { description: savDesc, urgence } : null,
          subjectLabel: isSav ? (includesEntretien ? 'SAV + Entretien' : 'SAV') : 'Entretien',
          multi: true,
          mergeOverlapping: isSav,
          plannedOrder: isSav ? {
            teamSize: plannedTeamSize, days: plannedDays, onChange: handlePlannedOrderChange, disabled: isSavingFields,
          } : null,
        }}
        onCreated={handleRdvPoses}
        onClose={() => setShowScheduling(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 pb-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className={`relative bg-white rounded-xl shadow-2xl w-full max-h-[calc(100vh-4rem)] flex flex-col ${isSav ? (atelierOuvert ? 'max-w-[calc(100vw-2rem)]' : 'max-w-4xl') : 'max-w-lg'} ${MODAL_PANEL_PHONE}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: statusConfig.color }}
            />
            <div className="min-w-0 flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 truncate">{name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${typeConfig.bgClass}`}>
                {typeConfig.label}
              </span>
              <SAVUrgencyBadge item={{ ...item, sav_urgency: urgence }} taille="fiche" />
              {type === 'sav' && includesEntretien && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                  Entretien à faire
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <>
              {/* SAV : deux colonnes (client, urgence, problème | devis, pièces, notes) — pas d'ascenseur sur un écran de bureau */}
              <div className={isSav ? 'space-y-6 md:space-y-0 md:grid md:grid-cols-2 md:gap-x-8' : 'space-y-6'}>
              {/* Colonnes en flex : description (gauche) et notes (droite) calées en bas, zones de saisie alignées */}
              <div className={colonneClass}>
              {/* Infos client */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>{name}</span>
                  {/* Lien vers la fiche client */}
                  {item.client_id && (
                    <button
                      type="button"
                      onClick={handleOpenClient}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                      title="Ouvrir la fiche client"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Fiche client
                    </button>
                  )}
                </div>
                {(item.client_postal_code || item.client_city) && (
                  <AdresseItineraire
                    adresse={formaterAdresse({ address: item.client_address, postalCode: item.client_postal_code, city: item.client_city })}
                    lat={item.client_latitude}
                    lng={item.client_longitude}
                    className="text-sm text-gray-500 [&>svg]:text-gray-400 [&>svg]:h-4 [&>svg]:w-4"
                  />
                )}
                {/* Téléphone et e-mail cliquables (appel / messagerie depuis le téléphone) */}
                {item.client_phone && (
                  <a href={`tel:${item.client_phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 w-fit">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{item.client_phone}</span>
                  </a>
                )}
                {item.client_email && (
                  <a href={`mailto:${item.client_email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 w-fit break-all">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span>{item.client_email}</span>
                  </a>
                )}

                {/* Contrat : ses équipements et le dernier entretien, puis les autres équipements à part
                    (recette Eric 2026-11-11 : plus de code couleur à décoder). Contrat legacy sans liens
                    d'équipement : impossible de distinguer, tout part dans « Équipements ». */}
                {item.contract_number && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span>Contrat {item.contract_number}</span>
                      {item.contract_amount > 0 && (
                        <span className="ml-auto text-sm font-semibold text-emerald-700">
                          {formatEuro(item.contract_amount)}
                        </span>
                      )}
                    </div>
                    <div className="pl-6 space-y-1.5">
                      {equipementsSousContrat.length > 0 && (
                        <ChipsEquipements equipements={equipementsSousContrat} referentiel={referentiel} />
                      )}
                      <DernierEntretien date={lastEntretienDate} />
                    </div>
                  </div>
                )}
                {!item.contract_number && <DernierEntretien date={lastEntretienDate} icone />}

                {autresEquipements.length > 0 && (
                  <div className="flex items-start gap-2 text-sm text-gray-500">
                    <Wrench className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <span>{idsSousContrat && item.contract_number ? 'Autres équipements' : 'Équipements'}</span>
                      <ChipsEquipements equipements={autresEquipements} referentiel={referentiel} />
                    </div>
                  </div>
                )}

                {/* Pièces de rechange : détail + toggle « Offert » (team_leader+) */}
                <EntretienPartsSection item={item} orgId={item.org_id} />

                {/* CTA Compléter fiche client (contacts Web) */}
                {item.tags?.includes('Web') && item.client_id && (
                  <button
                    type="button"
                    onClick={handleOpenClient}
                    className="mt-1 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Compléter la fiche client
                  </button>
                )}
              </div>

              {/* Degré d'urgence (SAV uniquement) */}
              {type === 'sav' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Degré d&apos;urgence
                  </h3>
                  <SAVUrgencySelect value={urgence} onChange={setUrgence} disabled={!canEditSAV || clotureSeule} />
                </div>
              )}

              {/* Description SAV */}
              {type === 'sav' && (
                <div className="space-y-3 md:mt-auto">
                  <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                    <Wrench className="w-4 h-4" />
                    Description du problème
                  </h3>
                  <FormField>
                    <TextArea
                      value={savDesc}
                      onChange={canEditSAV ? setSavDesc : undefined}
                      placeholder="Description du problème..."
                      rows={3}
                      disabled={!canEditSAV}
                    />
                  </FormField>
                </div>
              )}

              </div>

              {/* Colonne droite (SAV) : devis d'abord, la commande de pièces en découle */}
              <div className={colonneClass}>
              {/* Section Devis (SAV uniquement) */}
              {type === 'sav' && (
                <SAVDevisSection
                  devisAmount={devisAmount}
                  devisStatus={devisStatus}
                  onAmountChange={setDevisAmount}
                  onStatusChange={setDevisStatus}
                  disabled={!canEditSAV || clotureSeule}
                  hideAmount={(item.sav_quotes?.length || 0) > 0}
                >
                  {/* Devis créés depuis la fiche, fléchés vers la carte (jamais dans le pipeline) */}
                  <SAVLinkedQuotes
                    item={item}
                    canEdit={canEditSAV && !clotureSeule}
                    onUpdated={onUpdated}
                    onCardSynced={setDevisStatus}
                    actions={canEditSAV && !clotureSeule ? (
                      // Entretien fait pendant le passage SAV (début de saison) : tag la carte, ajoute le montant du contrat
                      <button
                        type="button"
                        onClick={handleToggleEntretien}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
                          includesEntretien
                            ? 'text-blue-700 bg-blue-100 border-blue-300'
                            : 'text-blue-700 bg-white border-blue-200 hover:bg-blue-50'
                        }`}
                        title={includesEntretien ? 'Entretien inclus — cliquer pour retirer' : 'Faire l’entretien pendant le même passage'}
                      >
                        {includesEntretien ? <Check className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
                        {includesEntretien ? 'Entretien inclus' : 'Ajouter l’entretien'}
                      </button>
                    ) : null}
                  />
                </SAVDevisSection>
              )}

              {/* Pièces détachées de l'appareil (vue éclatée, nomenclature, ajout au devis) — SAV uniquement */}
              {type === 'sav' && (
                <SAVModelPartsSection
                  item={item}
                  equipements={equipementsClient}
                  referentiel={referentiel}
                  canEdit={canEditSAV && !clotureSeule}
                  peutIdentifier={peutIdentifierPieces(item, { role: effectiveRole, canEditSAV, canEditClient: can('clients', 'edit') })}
                  membres={teamMembers}
                  onUpdated={onUpdated}
                  onAtelierChange={setAtelierOuvert}
                />
              )}

              {/* Section Pièces (SAV uniquement) — après le devis */}
              {type === 'sav' && (
                <SAVPartsSection
                  partsOrderStatus={partsOrder}
                  onChange={setPartsOrder}
                  disabled={!canEditSAV || clotureSeule}
                />
              )}

              {/* Anomalie constatée sur un certificat (lecture seule : la source reste le certificat) */}
              {anomalies.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Anomalie constatée
                  </h3>
                  {/* Lecture seule : le bouton « Voir certificat » vit dans la section Certificats (recette Eric 2026-10-10, pas de doublon) */}
                  <p className="text-xs text-gray-400">Relevée par le technicien sur le certificat d&apos;entretien (section Certificats ci-dessous). Se corrige dans le certificat.</p>
                  {anomalies.map((a) => (
                    <div key={a.certificatId} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      {a.equipement && <div className="text-xs font-medium text-amber-800">{a.equipement}</div>}
                      <div className="text-sm text-amber-900 whitespace-pre-line">{a.detail || a.bilanLabel}</div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        {[a.bilanLabel, a.actionLabel].filter(Boolean).join(' · ')}
                        {a.savId ? ' · Demande SAV créée' : ''}
                      </div>
                      {/* La photo de la plaque suit la carte (lue sur le certificat) */}
                      {(a.photoPlaquePath || a.action === 'devis') && (
                        <div className="mt-2">
                          <PhotoPlaqueAnomalie anomalie={a} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              <div className={`space-y-3 ${isSav ? 'md:mt-auto' : ''}`}>
                <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Notes internes
                </h3>
                <p className="text-xs text-gray-400">Visibles dans la fiche client (Notes internes)</p>
                <FormField>
                  <TextArea
                    value={notes}
                    onChange={canEditSAV ? setNotes : undefined}
                    placeholder="Notes internes..."
                    rows={3}
                    disabled={!canEditSAV}
                  />
                </FormField>
              </div>
              </div>
              </div>

              {/* Section certificats multi-équipements (entretien uniquement) */}
              {showCertificatsSection && (
                <CertificatsSection item={item} onCloseModal={onClose} />
              )}
          </>
        </div>

        {/* Footer : Enregistrer + transitions */}
          <div className={`px-5 py-3 border-t bg-gray-50 rounded-b-xl space-y-2 ${MODAL_FOOTER_PHONE}`}>
            {/* CTA Envoyer par mail (entretien réalisé avec email client) */}
            {isEntretien && item.workflow_status === 'realise' && item.client_email && (
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => toast.info('Envoi par mail — fonctionnalité à connecter avec N8N')}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  Envoyer par mail
                </button>
              </div>
            )}

            {/* Une seule ligne : retours et rangement à gauche, Enregistrer puis les avancées à droite */}
            {canEditSAV && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Retour arrière à gauche */}
                {backTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus)
                    || getStatusConfig(type, targetStatus);
                  if (!col) return null;
                  return (
                    <button
                      key={targetStatus}
                      type="button"
                      onClick={() => handleTransition(targetStatus)}
                      disabled={isUpdatingStatus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {col.label}
                    </button>
                  );
                })}

                {/* Ranger (À planifier uniquement) : retire la carte du kanban, undo via toast */}
                {item.workflow_status === 'a_planifier' && !clotureSeule && (
                  <button
                    type="button"
                    onClick={handleRanger}
                    disabled={isUpdatingStatus}
                    title="Ranger la carte (la retirer de « À planifier »)"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-500 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Ranger
                  </button>
                )}

                {/* Lien de prise de RDV (À planifier, contrat requis) : page client de l'auto-RDV */}
                {item.workflow_status === 'a_planifier' && contractId && !clotureSeule && (
                  <button
                    type="button"
                    onClick={handleCopierLien}
                    disabled={lienBusy}
                    title="Copier le lien de la page où le client choisit sa demi-journée"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white transition-colors hover:shadow-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    {lienBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    Lien de RDV client
                  </button>
                )}

                {peutAnnulerDemande && (
                  <button
                    type="button"
                    onClick={() => setConfirmAnnuler(true)}
                    disabled={isUpdatingStatus || annulation}
                    title="Supprimer cette demande SAV"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Annuler la demande
                  </button>
                )}

                <div className="flex-1" />

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isSavingFields}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${
                    isDirty
                      ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSavingFields ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {isSavingFields ? 'Enregistrement...' : 'Enregistrer'}
                </button>

                {/* SAV traité sans planification : clôture + inscription au planning après coup */}
                {peutCloturerSansPlanifier(item) && (
                  <button
                    type="button"
                    onClick={() => setShowCloture(true)}
                    disabled={isUpdatingStatus}
                    title="Le technicien est déjà intervenu : clôturer et inscrire l'intervention au planning"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-600 text-emerald-700 bg-emerald-50 transition-colors hover:shadow-sm hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Intervention faite
                  </button>
                )}

                {/* Avancer à droite */}
                {forwardTransitions.map((targetStatus) => {
                  const col = KANBAN_COLUMNS.find(c => c.value === targetStatus)
                    || getStatusConfig(type, targetStatus);
                  if (!col) return null;
                  return (
                    <button
                      key={targetStatus}
                      type="button"
                      onClick={() => handleTransition(targetStatus)}
                      disabled={isUpdatingStatus}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:shadow-sm disabled:opacity-50"
                      style={{
                        borderColor: col.color,
                        color: col.color,
                        backgroundColor: `${col.color}08`,
                      }}
                    >
                      {targetStatus === 'planifie' ? 'Planifier' : col.label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
      </div>

      <ConfirmDialog
        open={confirmAnnuler}
        onOpenChange={(o) => { if (!o) setConfirmAnnuler(false); }}
        title="Annuler la demande SAV"
        description={`La carte SAV de ${name} sera définitivement supprimée.${(item.sav_quotes?.length || 0) > 0 ? ' Ses devis restent sur la fiche client, détachés de la carte.' : ''}`}
        confirmLabel="Annuler la demande"
        cancelLabel="Garder la demande"
        variant="destructive"
        onConfirm={handleAnnulerDemande}
        loading={annulation}
      />

      {showCloture && (
        <SAVInterventionFaiteModal
          item={item}
          onClose={() => setShowCloture(false)}
          onDone={() => { onUpdated?.(); onClose(); }}
        />
      )}
    </div>
  );
}

/** Pastilles d'équipements : type · marque modèle. */
function ChipsEquipements({ equipements, referentiel }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {equipements.map((eq) => {
        const marqueModele = [eq.brand, eq.model].filter(Boolean).join(' ');
        return (
          <span key={eq.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
            {libelleEquipement(eq, referentiel)}
            {marqueModele && <span className="font-normal">&nbsp;· {marqueModele}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** « Dernier entretien : date » (icône calendrier hors bloc contrat). */
function DernierEntretien({ date, icone = false }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      {icone && <Calendar className="w-4 h-4 text-gray-400" />}
      <span>
        Dernier entretien :{' '}
        {date
          ? <span className="font-medium text-gray-700">{formatDateShortFR(date)}</span>
          : <span className="italic text-gray-400">Aucun</span>}
      </span>
    </div>
  );
}

export default EntretienSAVModal;
