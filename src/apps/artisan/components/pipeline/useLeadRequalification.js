/**
 * useLeadRequalification.js — requalifier un lead en Entretien (sorti de LeadModal).
 * Crée (ou reprend) la fiche client, un contrat `pending`, une carte Entretien
 * « Demande de contrat », puis retire le lead du pipeline (soft delete).
 * Filet anti-doublon CLIENT avant de créer une fiche : `duplicateCandidates`.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { leadsService } from '@services/leads.service';
import { clientsService } from '@services/clients.service';
import { contractsService } from '@services/contracts.service';
import { savService } from '@services/sav.service';
import { entretienSavKeys } from '@hooks/cacheKeys';
import { logger } from '@lib/logger';

export function useLeadRequalification({ orgId, userId, lead, form, deleteLead, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isRequalifying, setIsRequalifying] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState([]);

  // existingClientId : fiche choisie dans le filet anti-doublon client ;
  // skipDuplicateCheck : « Créer quand même ».
  const requalify = useCallback(async ({ existingClientId = null, skipDuplicateCheck = false } = {}) => {
    if (isRequalifying || !orgId || !lead) return;
    setIsRequalifying(true);
    try {
      let clientId = lead.client_id || existingClientId;
      let projectId = null;

      if (!clientId && !skipDuplicateCheck) {
        const { data: duplicates, error: dupError } = await clientsService.findPotentialDuplicates({
          orgId,
          phone: form.phone, email: form.email,
          firstName: form.first_name, lastName: form.last_name || form.company_name,
          postalCode: form.postal_code,
        });
        if (dupError) {
          toast.warning('Vérification des doublons clients indisponible — contrôlez la liste des clients');
        } else if (duplicates?.length) {
          setDuplicateCandidates(duplicates);
          return;
        }
      }

      if (!clientId) {
        const { data: newClient, error: clientError } = await clientsService.createClient({
          orgId,
          lastName: form.last_name || form.company_name || 'Client',
          firstName: form.first_name || '',
          email: form.email || null,
          phone: form.phone || null,
          address: form.address || null,
          postalCode: form.postal_code || null,
          city: form.city || null,
          clientCategory: 'particulier',
          leadSource: 'appointment_legacy',
        });
        if (clientError) throw clientError;
        clientId = newClient?.id;
        projectId = newClient?.project_id || null;
        if (!clientId) throw new Error('Client non créé');

        // Lier le lead au client (traçabilité + pas de doublon client si retry après échec)
        const { error: linkError } = await leadsService.updateLead(lead.id, { client_id: clientId });
        if (linkError) logger.warn('[LeadModal] requalify: lien lead→client non posé:', linkError);
      } else {
        const { data: clientRow } = await supabase
          .from('majordhome_clients')
          .select('project_id')
          .eq('id', clientId)
          .maybeSingle();
        projectId = clientRow?.project_id || null;

        // Fiche existante choisie dans le filet : y rattacher le lead (traçabilité).
        if (existingClientId && !lead.client_id) {
          const { error: linkError } = await leadsService.updateLead(lead.id, { client_id: clientId });
          if (linkError) logger.warn('[LeadModal] requalify: lien lead→client existant non posé:', linkError);
        }
      }

      if (!projectId) throw new Error('Projet client introuvable — requalification impossible');

      const { data: newContract, error: contractError } = await contractsService.createContract({
        orgId,
        clientId,
        status: 'pending',
        workflowStatus: 'nouveau',
        frequency: 'annuel',
        startDate: new Date().toISOString().split('T')[0],
        source: 'pipeline',
        notes: form.notes || null,
      });
      if (contractError) throw contractError;

      // Carte Kanban Entretien « Demande de contrat » — la demande reste visible côté
      // Entretien sans être planifiable (pas de contrat actif). Elle bascule en
      // « À planifier » à l'activation du contrat (trigger DB) ou manuellement.
      const { error: entretienError } = await savService.createEntretien({
        orgId,
        clientId,
        contractId: newContract?.id || null,
        projectId,
        scheduledDate: null,
        createdBy: userId,
        workflowStatus: 'demande_contrat',
      });
      if (entretienError) throw entretienError;

      // Mutation du hook (rejette sur refus). Le contrat et la carte Entretien
      // existent déjà : un refus ici laisse le lead dans le pipeline — le dire,
      // pour que personne ne relance la requalification (2ᵉ contrat, 2ᵉ carte).
      try {
        await deleteLead(lead.id);
      } catch (deleteError) {
        logger.error('[LeadModal] softDeleteLead refusé:', deleteError);
        throw new Error('Demande de contrat créée, mais le lead n’a pas pu être retiré du pipeline');
      }

      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      toast.success('Lead requalifié → demande de contrat créée (Kanban Entretien)');
      onClose();
      navigate(`/clients/${clientId}?tab=contract`);
    } catch (err) {
      logger.error('[LeadModal] requalify error:', err);
      toast.error(`Erreur : ${err.message || 'Requalification échouée'}`);
    } finally {
      setIsRequalifying(false);
    }
  }, [orgId, lead, form, isRequalifying, navigate, onClose, userId, queryClient, deleteLead]);

  return { requalify, isRequalifying, duplicateCandidates, setDuplicateCandidates };
}
