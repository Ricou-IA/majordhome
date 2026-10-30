/**
 * useEventSaveActions.js — les quatre chemins d'enregistrement d'EventModal :
 *   - classique (édition d'un RDV, création « Autre ») : handleSave → onSave ;
 *   - assistant (création VT/entretien/SAV/install) : handleCreateFromAssistant → N RDV ;
 *   - re-planification (édition) : handleRescheduleSave → 1 créneau, type modifiable ;
 *   - suite (édition) : handleContinuationSave → N RDV ajoutés sur la même carte.
 * Filet anti-doublon walk-in : `duplicatePrompt` + `resumeDuplicate` relancent le chemin d'origine.
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getAppointmentTypeConfig, appointmentsService } from '@services/appointments.service';
import { leadKeys } from '@hooks/useLeads';
import { appointmentKeys, interventionKeys, entretienSavKeys, kanbanCardKeys, chantierKeys } from '@hooks/cacheKeys';
import { PHONE_REQUIRED_TYPES } from '@/lib/planningEvents';
import { hasPhoneNumber } from '@/lib/phoneUtils';
import { logger } from '@lib/logger';
import { resolveEventActivation, reportActivationError } from './eventActivation';
import { VT_PHONE_REQUIRED_MESSAGE, dupDecisionOf, clientLabelOf, autoSubjectFor } from './eventForm';

export function useEventSaveActions({
  orgId, userId, isEdit, appointment, attachContext, formData, setErrors, validate,
  selectedClient, selectedLead, isCommercialType, isFreeType, isLeave, isClosing, fromFiche,
  commercialMemberId, allTeamMembers, assistantSlots, onSave, onClose,
}) {
  const queryClient = useQueryClient();
  const [batchSaving, setBatchSaving] = useState(false);
  // Filet anti-doublon walk-in : { candidates, source: 'save'|'assistant'|'reschedule' }
  // — candidats trouvés au moment de sauver + chemin de reprise après décision.
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);

  const resolveActivation = useCallback(({ rdvDate, dupDecision } = {}) => resolveEventActivation({
    orgId, userId, formData, selectedClient, selectedLead, attachContext, rdvDate, dupDecision,
  }), [orgId, userId, formData, selectedClient, selectedLead, attachContext]);

  // --------------------------------------------------------------------------
  // Enregistrer (chemin CLASSIQUE) : édition (1 RDV) + création « Autre ».
  // Les types VT/entretien/SAV/install en création passent par l'assistant
  // intégré (handleCreateFromAssistant), bouton « Créer le RDV ».
  // --------------------------------------------------------------------------
  const handleSave = useCallback(async (maybeDecision) => {
    const dupDecision = dupDecisionOf(maybeDecision);
    if (!validate()) return;

    let leadId = selectedLead?.id || attachContext?.leadId || null;
    let interventionId = isEdit
      ? (appointment?.intervention_id || null)
      : (attachContext?.interventionId || null);

    // Correction de type inline par un org_admin sur un RDV existant (god-mode) :
    // un RDV mal catégorisé (ex. « Autre » au lieu d'« Entretien ») ne déclenche pas
    // le workflow lié. On re-résout la carte cible comme à la re-planification —
    // mais SANS re-choix de créneau (date/heure conservées).
    const typeChangedInEdit = isEdit && formData.appointment_type !== appointment?.appointment_type;

    let subject = formData.subject?.trim() || null;

    if (!isEdit || typeChangedInEdit) {
      const act = await resolveActivation({ rdvDate: formData.scheduled_date, dupDecision });
      if (act.error === 'duplicate') {
        setDuplicatePrompt({ candidates: act.candidates, source: 'save' });
        return;
      }
      if (reportActivationError(act.error)) return;
      leadId = act.leadId;
      interventionId = act.interventionId;
    }
    if (typeChangedInEdit) {
      // Rafraîchir l'objet auto (type — client) si l'utilisateur n'a pas saisi
      // d'objet custom (un objet écrit à la main reste intact).
      const oldLabel = getAppointmentTypeConfig(appointment?.appointment_type).label;
      const looksAuto = !subject || subject === oldLabel
        || subject.startsWith(`${oldLabel} —`) || subject.startsWith(`${oldLabel}—`);
      if (looksAuto) subject = autoSubjectFor(formData.appointment_type, formData);
    }

    // Construire les données à envoyer
    const data = {
      subject,
      appointment_type: formData.appointment_type,
      priority: formData.priority,
      status: formData.status,
      client_name: formData.client_name?.trim() || null,
      client_first_name: formData.client_first_name?.trim() || null,
      client_phone: formData.client_phone || null,
      client_email: formData.client_email || null,
      address: formData.client_address || null,
      city: formData.client_city || null,
      postal_code: formData.client_postal_code || null,
      client_id: selectedClient?.id || null,
      lead_id: leadId,
      intervention_id: interventionId,
      scheduled_date: formData.scheduled_date,
      scheduled_start: formData.scheduled_start,
      scheduled_end: formData.scheduled_end || null,
      duration_minutes: Number(formData.duration_minutes) || 60,
      description: formData.description || null,
      internal_notes: formData.internal_notes || null,
      // RDV commercial : la personne est assigned_commercial_id — l'id stocké est
      // conservé tel quel s'il n'a pas été modifié (pas de réécriture d'un id pipeline),
      // le legacy « commercial rangé en technicien » est reporté ; technicianIds vidé
      // (même règle que l'assistant en mode commercial : purge du lien fantôme).
      technicianIds: isCommercialType ? [] : formData.technicianIds,
      assigned_commercial_id: formData.assigned_commercial_id || commercialMemberId || null,
      // Souplesse : figé (0) ⇒ heure communiquée au client (conservée si déjà
      // posée) ; adaptable ⇒ on efface la confirmation.
      time_flex_minutes: formData.time_flex_minutes ?? null,
      hour_confirmed_at: formData.time_flex_minutes === 0
        ? (formData.hour_confirmed_at || new Date().toISOString())
        : null,
    };

    await onSave(data);

    if (leadId) {
      queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    }
    // Re-typage : la carte cible a changé (ancienne refluée, nouvelle avancée par le
    // service appointments) → rafraîchir kanbans / interventions / entretiens.
    if (typeChangedInEdit) {
      queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
      if (interventionId || appointment?.intervention_id) {
        queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      }
    }
  }, [validate, selectedLead, attachContext, isEdit, appointment, resolveActivation, formData, isCommercialType, commercialMemberId, onSave, selectedClient, orgId, queryClient]);

  // --------------------------------------------------------------------------
  // Créer depuis l'assistant INTÉGRÉ (chemin CRÉATION VT/entretien/SAV/install).
  // `assistantSlots` est alimenté en continu par l'assistant inline ; on résout
  // la carte UNE fois, puis on crée N RDV via createAppointmentBatch (réutilise
  // createAppointment → syncCardStateOnCreate + sync Google par RDV, cycle Bloc A préservé).
  // --------------------------------------------------------------------------
  const handleCreateFromAssistant = useCallback(async (maybeDecision) => {
    const dupDecision = dupDecisionOf(maybeDecision);
    if (assistantSlots.length === 0) {
      toast.error('Choisissez au moins un créneau');
      return;
    }
    // Bouclage R2 : une carte pipeline existante DOIT être sélectionnée (jamais de doublon).
    if (isClosing && !selectedLead) {
      toast.error('Sélectionnez la carte du pipeline à boucler.');
      return;
    }
    // Nom client requis pour les RDV liés à un client (VT/entretien/SAV/install) hors fiche.
    // « Autre » / « Congés » : client optionnel (RDV perso / interne). R2 : identité portée par la carte.
    if (!isFreeType && !isClosing && !fromFiche && !formData.client_name?.trim()) {
      setErrors((prev) => ({ ...prev, client_name: 'Nom requis' }));
      toast.error('Nom du client requis');
      return;
    }
    if (PHONE_REQUIRED_TYPES.includes(formData.appointment_type) && !hasPhoneNumber(formData.client_phone)) {
      setErrors((prev) => ({ ...prev, client_phone: 'Téléphone requis pour ce type de RDV' }));
      toast.error(VT_PHONE_REQUIRED_MESSAGE);
      return;
    }
    setBatchSaving(true);
    try {
      const act = await resolveActivation({ rdvDate: assistantSlots[0]?.date, dupDecision });
      if (act.error === 'duplicate') {
        setDuplicatePrompt({ candidates: act.candidates, source: 'assistant' });
        setBatchSaving(false);
        return;
      }
      if (reportActivationError(act.error)) { setBatchSaving(false); return; }

      // VT depuis EventModal = commercial sélectionnable → le commercial choisi
      // (colonne) est porté par slot.assignedCommercialId. Entretien/SAV/install : null.
      const assignedCommercialId = isCommercialType ? (assistantSlots[0]?.assignedCommercialId || null) : null;

      // Objet AUTO (type + client) — pas de champ Objet/Notes dans le flux assistant
      // (RDV rapide = type + créneau). Notes éditables après coup via l'édition du RDV.
      // Congés : « Congés — Prénom » par créneau (la personne, pas un client).
      const typeLabel = getAppointmentTypeConfig(formData.appointment_type).label;
      const clientLabel = clientLabelOf(formData);
      const autoSubject = clientLabel
        ? `${typeLabel} — ${clientLabel}`
        : (formData.appointment_type === 'other' ? 'Rendez-vous' : typeLabel);
      const prenomsDe = (ids) => (ids || [])
        .map((id) => (allTeamMembers || []).find((m) => m.id === id)?.display_name?.trim().split(' ')[0])
        .filter(Boolean).join(', ');
      const subjectFor = (s) => (isLeave && prenomsDe(s.technicianIds) ? `${typeLabel} — ${prenomsDe(s.technicianIds)}` : autoSubject);
      const slots = assistantSlots.map((s) => ({ ...s, subject: subjectFor(s), notes: null }));

      const { error: batchErr } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId: orgId,
        appointment_type: formData.appointment_type,
        lead_id: act.leadId,
        intervention_id: act.interventionId,
        client_id: selectedClient?.id || null,
        client_name: formData.client_name?.trim() || null,
        client_first_name: formData.client_first_name?.trim() || null,
        client_phone: formData.client_phone || null,
        client_email: formData.client_email || null,
        address: formData.client_address || null,
        city: formData.client_city || null,
        postal_code: formData.client_postal_code || null,
        assigned_commercial_id: assignedCommercialId,
        description: null,
        subjectPrefix: autoSubject,
      });
      if (batchErr) {
        logger.error('[EventModal] batch create error:', batchErr);
        toast.error('Erreur lors de la création du RDV');
        setBatchSaving(false);
        return;
      }

      // Invalidations ciblées selon la destination de la carte.
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      if (act.leadId) {
        queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
        if (formData.appointment_type === 'installation') {
          queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
        }
      }
      if (act.interventionId) {
        queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      }

      toast.success(slots.length > 1 ? `${slots.length} RDV créés` : 'RDV créé avec succès');
      onClose();
    } catch (err) {
      logger.error('[EventModal] handleCreateFromAssistant error:', err);
      toast.error('Une erreur est survenue');
      setBatchSaving(false);
    }
  }, [assistantSlots, fromFiche, isClosing, selectedLead, resolveActivation, isCommercialType, isFreeType, isLeave, allTeamMembers, orgId, formData, selectedClient, queryClient, onClose, setErrors]);

  // --------------------------------------------------------------------------
  // Re-planifier (édition) : 1 créneau choisi dans l'assistant → update du RDV
  // existant. Si le type change, la carte cible est re-résolue (resolveActivation)
  // et appointments.service refait le sync carte (reflux ancienne / avancée nouvelle).
  // Le drag & drop calendrier reste l'autre chemin (date/heure uniquement).
  // --------------------------------------------------------------------------
  const handleRescheduleSave = useCallback(async (maybeDecision) => {
    const dupDecision = dupDecisionOf(maybeDecision);
    const slot = assistantSlots[0];
    if (!slot) {
      toast.error('Choisissez un créneau');
      return;
    }
    setBatchSaving(true);
    try {
      const typeChanged = formData.appointment_type !== appointment?.appointment_type;
      let leadId = appointment?.lead_id || null;
      let interventionId = appointment?.intervention_id || null;

      if (typeChanged) {
        const act = await resolveActivation({ rdvDate: slot.date, dupDecision });
        if (act.error === 'duplicate') {
          setDuplicatePrompt({ candidates: act.candidates, source: 'reschedule' });
          setBatchSaving(false);
          return;
        }
        if (reportActivationError(act.error)) {
          setBatchSaving(false);
          return;
        }
        leadId = act.leadId;
        interventionId = act.interventionId;
      }

      // Objet recalculé si le type change (cohérence type — client), conservé sinon
      const subject = typeChanged
        ? autoSubjectFor(formData.appointment_type, formData)
        : (formData.subject || null);

      const ok = await onSave({
        appointment_type: formData.appointment_type,
        subject,
        scheduled_date: slot.date,
        scheduled_start: slot.startTime,
        scheduled_end: slot.endTime || null,
        duration_minutes: slot.duration || Number(formData.duration_minutes) || 60,
        status: 'scheduled', // un RDV re-planifié redevient actif (ex: no_show)
        lead_id: leadId,
        intervention_id: interventionId,
        technicianIds: slot.technicianIds || [],
        assigned_commercial_id: isCommercialType
          ? (slot.assignedCommercialId || null)
          : (formData.assigned_commercial_id || null),
      });

      if (ok !== false) {
        // Cartes liées (ancienne et nouvelle cible) : rafraîchir les kanbans
        if (leadId || appointment?.lead_id) {
          queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
        }
        if (interventionId || appointment?.intervention_id) {
          queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
          queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
        }
      }
    } catch (err) {
      logger.error('[EventModal] handleRescheduleSave error:', err);
      toast.error('Une erreur est survenue');
    } finally {
      setBatchSaving(false);
    }
  }, [assistantSlots, formData, appointment, resolveActivation, isCommercialType, onSave, orgId, queryClient]);

  // --------------------------------------------------------------------------
  // Programmer une suite (édition) : AJOUTE N RDV sur la même carte que le RDV
  // courant (lead_id / intervention_id / client copiés tels quels), sans le
  // modifier. Pas de resolveActivation : la carte est déjà connue, aucun filet
  // doublon à rejouer. createAppointmentBatch refait le sync carte forward-only
  // (une carte déjà « planifiée » / « en cours » ne bouge pas).
  // --------------------------------------------------------------------------
  const handleContinuationSave = useCallback(async () => {
    if (assistantSlots.length === 0) {
      toast.error('Choisissez au moins un créneau');
      return;
    }
    setBatchSaving(true);
    try {
      const baseSubject = (appointment?.subject || '').trim()
        || getAppointmentTypeConfig(appointment?.appointment_type).label;
      const subject = /\(suite\)$/i.test(baseSubject) ? baseSubject : `${baseSubject} (suite)`;
      const slots = assistantSlots.map((s) => ({ ...s, subject, notes: null }));

      const { error: batchErr } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId: orgId,
        appointment_type: appointment?.appointment_type,
        lead_id: appointment?.lead_id || null,
        chantier_id: appointment?.chantier_id || null,
        intervention_id: appointment?.intervention_id || null,
        client_id: appointment?.client_id || null,
        client_name: appointment?.client_name || null,
        client_first_name: appointment?.client_first_name || null,
        client_phone: appointment?.client_phone || null,
        client_email: appointment?.client_email || null,
        address: appointment?.address || null,
        city: appointment?.city || null,
        postal_code: appointment?.postal_code || null,
        assigned_commercial_id: isCommercialType
          ? (assistantSlots[0]?.assignedCommercialId || appointment?.assigned_commercial_id || null)
          : null,
        description: appointment?.description || null,
        subjectPrefix: subject,
      });
      if (batchErr) {
        logger.error('[EventModal] continuation batch error:', batchErr);
        toast.error('Erreur lors de la création de la suite');
        setBatchSaving(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(orgId) });
      if (appointment?.lead_id) {
        queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
        if (appointment?.appointment_type === 'installation') {
          queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
        }
      }
      if (appointment?.intervention_id) {
        queryClient.invalidateQueries({ queryKey: interventionKeys.all(orgId) });
        queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      }

      toast.success(slots.length > 1 ? `${slots.length} RDV ajoutés` : 'Suite programmée');
      onClose();
    } catch (err) {
      logger.error('[EventModal] handleContinuationSave error:', err);
      toast.error('Une erreur est survenue');
      setBatchSaving(false);
    }
  }, [assistantSlots, appointment, isCommercialType, orgId, queryClient, onClose]);

  // Reprise après décision du dialogue doublon : relance le chemin d'origine
  // avec la décision ({ action: 'link', leadId } ou { action: 'create' }).
  const resumeDuplicate = useCallback((decision) => {
    const source = duplicatePrompt?.source;
    setDuplicatePrompt(null);
    if (source === 'assistant') handleCreateFromAssistant(decision);
    else if (source === 'reschedule') handleRescheduleSave(decision);
    else handleSave(decision);
  }, [duplicatePrompt, handleCreateFromAssistant, handleRescheduleSave, handleSave]);

  return {
    batchSaving, setBatchSaving, duplicatePrompt, setDuplicatePrompt, resumeDuplicate,
    handleSave, handleCreateFromAssistant, handleRescheduleSave, handleContinuationSave,
  };
}
