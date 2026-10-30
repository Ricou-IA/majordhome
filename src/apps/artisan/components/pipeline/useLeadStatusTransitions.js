/**
 * useLeadStatusTransitions.js — gestes de statut de LeadModal (sorti du composant).
 * Chaque transition enregistre d'abord le formulaire en cours (`persistForm`), puis
 * passe par la modale propre à la cible : appel (Contacté), assistant (RDV planifié),
 * devis MDH ou rattachement Pennylane (Devis envoyé), motif (Perdu), devis canonique
 * Pennylane (Gagné). Garde Pennylane : sur une org PL, Gagné exige un devis rattaché.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { appointmentsService } from '@services/appointments.service';
import { leadsService } from '@services/leads.service';
import { devisService } from '@services/devis.service';
import { logger } from '@lib/logger';
import { hasPhoneNumber } from '@/lib/phoneUtils';

// Une visite technique sans numéro = un commercial qui ne peut ni confirmer ni
// prévenir d'un retard (vécu : lead LOLLENFANT, 2026-09-14).
export const VT_PHONE_REQUIRED_MESSAGE = 'Téléphone requis : renseignez le numéro du client avant de planifier la visite technique';

export function useLeadStatusTransitions({
  leadId, isEditing, orgId, userId, form, setForm, statuses, linkedClientId,
  pennylaneActive, linkedQuotes, persistForm,
  updateLeadStatus, convertLead, sendQuote, onSaved, onClose,
}) {
  const [pendingLostStatusId, setPendingLostStatusId] = useState(null);
  const [lostReasonInput, setLostReasonInput] = useState('');
  const [pendingRdvStatusId, setPendingRdvStatusId] = useState(null);
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [pendingContactStatusId, setPendingContactStatusId] = useState(null);
  const [callModalForLog, setCallModalForLog] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [followupModalOpen, setFollowupModalOpen] = useState(false);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [pendingQuoteStatusId, setPendingQuoteStatusId] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [showQuoteCandidates, setShowQuoteCandidates] = useState(false);
  const [showMarkWon, setShowMarkWon] = useState(false);

  const currentStatus = statuses.find((s) => s.id === form.status_id);

  const done = () => {
    onSaved?.();
    onClose();
  };

  const handleStatusChange = async (newStatusId) => {
    if (!isEditing || newStatusId === form.status_id) return;
    const targetStatus = statuses.find((s) => s.id === newStatusId);
    if (targetStatus?.label === 'Perdu') {
      setPendingLostStatusId(newStatusId);
      setLostReasonInput('');
      return;
    }
    if (targetStatus?.label === 'Contacté') {
      // Forward (Nouveau → Contacté) : modale d'appel pour qualifier le contact.
      // Régression (ex. RDV planifié → Contacté après annulation de RDV) : retour
      // direct sans modale d'appel (un résultat d'appel n'aurait pas de sens ici).
      const isRegression = currentStatus && targetStatus.display_order < currentStatus.display_order;
      if (!isRegression) {
        setPendingContactStatusId(newStatusId);
        return;
      }
      // régression → on tombe dans le flux de changement direct ci-dessous
    }
    if (targetStatus?.label === 'RDV planifié') {
      if (!hasPhoneNumber(form.phone)) {
        toast.error(VT_PHONE_REQUIRED_MESSAGE);
        return;
      }
      setPendingRdvStatusId(newStatusId);
      return;
    }
    if (targetStatus?.label === 'Devis envoyé') {
      // PR 4 bridge : si Pennylane actif, multi-attach via QuoteCandidatesModal
      // (RPC PR 2 fait la bascule statut + activity transactionnellement).
      // Sinon flow MDH classique : QuoteModal (montant + date manuels).
      if (pennylaneActive) {
        setShowQuoteCandidates(true);
      } else {
        setPendingQuoteStatusId(newStatusId);
      }
      return;
    }
    if (targetStatus?.label === 'Gagné' && pennylaneActive) {
      // PR 5 bridge : si Pennylane actif, choix du devis canonique via
      // MarkWonQuoteModal (RPC PR 3 fait la bascule statut + activity +
      // is_winning_quote flag transactionnellement).
      // Si org sans Pennylane → flow MDH actuel (default ci-dessous).
      const attachedCount = linkedQuotes?.length || 0;
      if (attachedCount === 0) {
        toast.error(
          'Aucun devis Pennylane attaché à ce lead. Rattache d\'abord un devis via « Devis envoyé ».'
        );
        return;
      }
      setShowMarkWon(true);
      return;
    }
    try {
      await persistForm();
      const result = await updateLeadStatus(leadId, newStatusId, userId);
      const targetLabel = statuses.find((s) => s.id === newStatusId)?.label;
      if (result?.clientCreated) {
        const clientName = result.clientCreated.display_name || result.clientCreated.client_number;
        toast.success(`Lead passé en "${targetLabel}" — Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success(`Lead passé en "${targetLabel}"`);
      }
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur statut:', err);
      toast.error('Erreur lors du changement de statut');
    }
  };

  const handleConfirmLost = async () => {
    if (!lostReasonInput) {
      toast.error('Veuillez sélectionner un motif de perte');
      return;
    }
    try {
      await persistForm();
      await updateLeadStatus(leadId, pendingLostStatusId, userId, {
        lostReason: lostReasonInput.trim(),
      });
      setPendingLostStatusId(null);
      toast.success('Lead marqué comme perdu');
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur passage perdu:', err);
      toast.error('Erreur lors du changement de statut');
    }
  };

  // VT pipeline (Bloc B stage 2) : l'assistant remonte slots[] (mode commercial,
  // 1 créneau). On crée le(s) RDV via createAppointmentBatch (assigned_commercial_id
  // = owner de la carte, technicianIds vide), puis on bascule le lead en
  // « RDV planifié » avec le PREMIER appointment créé.
  const handleConfirmScheduling = async (slots) => {
    if (!pendingRdvStatusId) return;
    if (!slots || slots.length === 0) return;
    if (!hasPhoneNumber(form.phone)) {
      toast.error(VT_PHONE_REQUIRED_MESSAGE);
      return;
    }
    setSchedulingLoading(true);
    try {
      await persistForm();
      const { data: created, error: aptError } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId: orgId,
        appointment_type: 'rdv_technical',
        lead_id: leadId,
        client_id: linkedClientId || null,
        assigned_commercial_id: form.assigned_user_id || null,
        client_name: form.last_name || 'Sans nom',
        client_first_name: form.first_name || null,
        client_phone: form.phone || '',
        client_email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        postal_code: form.postal_code || null,
        subjectPrefix: 'Visite technique',
      });
      if (aptError) {
        logger.error('[LeadModal] Erreur création RDV:', aptError);
        toast.error('Erreur lors de la création du RDV');
        setSchedulingLoading(false);
        return;
      }
      await updateLeadStatus(leadId, pendingRdvStatusId, userId, {
        appointmentDate: slots[0].date,
        appointmentId: created?.[0]?.id || null,
      });
      setPendingRdvStatusId(null);
      toast.success('RDV planifié avec succès');
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur planification RDV:', err);
      toast.error('Erreur lors de la planification du RDV');
    } finally {
      setSchedulingLoading(false);
    }
  };

  // Confirmer transition vers Contacté (depuis bouton statut)
  const handleConfirmContact = async (callData) => {
    if (!pendingContactStatusId) return;
    setCallLoading(true);
    try {
      await persistForm();
      await updateLeadStatus(leadId, pendingContactStatusId, userId, {
        callResult: callData.result,
        callDate: callData.date,
      });
      setPendingContactStatusId(null);
      toast.success('Lead passé en "Contacté"');
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur passage contacté:', err);
      toast.error('Erreur lors du changement de statut');
    } finally {
      setCallLoading(false);
    }
  };

  // Confirmer transition vers Devis envoyé (depuis bouton statut)
  const handleConfirmQuote = async (quoteData) => {
    if (!pendingQuoteStatusId) return;
    setQuoteLoading(true);
    try {
      await persistForm();
      const result = await updateLeadStatus(leadId, pendingQuoteStatusId, userId, {
        quoteSentDate: quoteData.date,
        quoteAmount: quoteData.amount,
      });
      setPendingQuoteStatusId(null);
      if (result?.clientCreated) {
        const clientName = result.clientCreated.display_name || result.clientCreated.client_number;
        toast.success(`Lead passé en "Devis envoyé" — Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success('Lead passé en "Devis envoyé"');
      }
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur passage devis:', err);
      toast.error('Erreur lors du changement de statut');
    } finally {
      setQuoteLoading(false);
    }
  };

  // Envoyer le devis (marquer brouillons comme envoyés + transition lead → Devis envoyé)
  const handleSendDevis = async () => {
    // Org Pennylane : « Devis envoyé » exige le rattachement d'un devis PL
    // (invariant DB). On route vers la modale d'attache plutôt que le flux MDH.
    if (pennylaneActive) {
      setShowQuoteCandidates(true);
      return;
    }
    try {
      // 1. Marquer tous les devis brouillon comme envoyés. Une lecture refusée
      // renverrait `[]` : on ne passe pas le lead en « Devis envoyé » sans savoir.
      const { data: quotes, error: quotesError } = await devisService.getQuotesByLead(leadId);
      if (quotesError) throw quotesError;
      const brouillons = (quotes || []).filter((q) => q.status === 'brouillon');
      for (const q of brouillons) {
        await sendQuote(q.id); // rejette sur refus → catch, pas de transition
      }

      // 2. Calculer le montant total des devis envoyés
      const totalHt = brouillons.reduce((sum, q) => sum + (parseFloat(q.total_ht) || 0), 0);

      // 3. Passer le lead en "Devis envoyé"
      const devisEnvoyeStatus = statuses.find((s) => s.label === 'Devis envoyé');
      if (devisEnvoyeStatus) {
        await persistForm();
        await updateLeadStatus(leadId, devisEnvoyeStatus.id, userId, {
          quoteSentDate: new Date().toISOString().split('T')[0],
          quoteAmount: totalHt || null,
        });
      }

      toast.success('Devis envoyé — lead mis à jour');
      done();
    } catch (err) {
      logger.error('[LeadModal] handleSendDevis:', err);
      toast.error('Erreur lors de l\'envoi du devis');
    }
  };

  // Ajouter un appel supplémentaire (lead déjà en Contacté ou +)
  const handleLogCall = async (callData) => {
    setCallLoading(true);
    try {
      const result = await leadsService.logCall(leadId, {
        orgId,
        userId,
        result: callData.result,
        callDate: callData.date,
      });
      if (result?.data) {
        setForm((prev) => ({
          ...prev,
          call_count: result.data.call_count ?? (prev.call_count || 0) + 1,
          last_call_date: result.data.last_call_date || new Date().toISOString(),
          last_call_result: callData.result,
        }));
      }
      setCallModalForLog(false);
      toast.success('Appel enregistré');
      onSaved?.();
    } catch (err) {
      logger.error('[LeadModal] Erreur logCall:', err);
      toast.error('Erreur lors de l\'enregistrement de l\'appel');
    } finally {
      setCallLoading(false);
    }
  };

  // Enregistrer une relance (suivi devis envoyé)
  const handleLogFollowup = async (callData) => {
    setFollowupLoading(true);
    try {
      const result = await leadsService.logFollowup(leadId, {
        orgId,
        userId,
        result: callData.result,
        callDate: callData.date,
      });
      if (result?.data) {
        setForm((prev) => ({
          ...prev,
          followup_count: result.data.followup_count ?? (prev.followup_count || 0) + 1,
          last_followup_date: result.data.last_followup_date || new Date().toISOString(),
        }));
      }
      setFollowupModalOpen(false);
      toast.success('Relance enregistrée');
      onSaved?.();
    } catch (err) {
      logger.error('[LeadModal] Erreur logFollowup:', err);
      toast.error('Erreur lors de l\'enregistrement de la relance');
    } finally {
      setFollowupLoading(false);
    }
  };

  const handleConvert = async () => {
    try {
      await persistForm();
      const result = await convertLead(leadId, orgId, userId);
      if (result?.skipped) {
        toast.info('Ce lead est déjà lié à un client');
      } else if (result?.client) {
        const clientName = result.client.display_name || result.client.client_number;
        toast.success(`Fiche client créée : ${clientName}`, { duration: 5000 });
      } else {
        toast.success('Lead converti en client !');
      }
      done();
    } catch (err) {
      logger.error('[LeadModal] Erreur conversion:', err);
      toast.error('Erreur lors de la conversion');
    }
  };

  return {
    pendingLostStatusId, setPendingLostStatusId, lostReasonInput, setLostReasonInput,
    pendingRdvStatusId, setPendingRdvStatusId, schedulingLoading, setSchedulingLoading,
    pendingContactStatusId, setPendingContactStatusId,
    callModalForLog, setCallModalForLog, callLoading,
    followupModalOpen, setFollowupModalOpen, followupLoading,
    pendingQuoteStatusId, setPendingQuoteStatusId, quoteLoading,
    showQuoteCandidates, setShowQuoteCandidates, showMarkWon, setShowMarkWon,
    handleStatusChange, handleConfirmLost, handleConfirmScheduling, handleConfirmContact,
    handleConfirmQuote, handleSendDevis, handleLogCall, handleLogFollowup, handleConvert,
  };
}
