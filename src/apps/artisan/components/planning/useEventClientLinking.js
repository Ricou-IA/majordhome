/**
 * useEventClientLinking.js — client et carte pipeline liés à un RDV (sorti d'EventModal).
 * Recherche unifiée client + lead (Bouclage R2 : cartes bouclables seulement), sélection
 * (recopie les coordonnées dans le formulaire), déliaison, et fiche client complétée
 * en édition (numéro, téléphone, adresse — lecture seule, rien n'est réécrit sur le RDV).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useClientSearch } from '@hooks/useClients';
import { useLeadSearch, useRecentPipelineCards } from '@hooks/useLeads';
import { BOUCLABLE_STATUS_IDS } from '@services/leads.service';
import { logger } from '@lib/logger';
import { EMPTY_CONTACT, contactFromRecord } from './eventForm';

const clientRef = (c) => ({
  id: c.id,
  display_name: c.display_name,
  client_number: c.client_number,
  phone: c.phone,
  city: c.city,
});

export function useEventClientLinking({ orgId, isOpen, isEdit, appointment, appointmentType, setFormData }) {
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const isClosing = appointmentType === 'rdv_closing';

  const {
    query: clientSearchQuery,
    results: clientSearchResults,
    searching: clientSearching,
    search: searchClient,
    clear: clearClientSearch,
  } = useClientSearch(orgId);
  const {
    results: leadSearchResults,
    searching: leadSearching,
    search: searchLead,
    clear: clearLeadSearch,
  } = useLeadSearch(orgId, {
    // Bouclage R2 : la recherche ne remonte que des cartes bouclables (comme la liste).
    statusIds: isClosing ? BOUCLABLE_STATUS_IDS : null,
  });
  // Liste parcourable des cartes pipeline (mode Bouclage R2 uniquement) — surfacée
  // dès l'ouverture du champ, filtrée en live par la recherche.
  const { cards: recentPipelineCards } = useRecentPipelineCards(orgId, { enabled: isClosing });

  // Édition : compléter le client lié depuis sa fiche. La photo du RDV n'a ni
  // numéro client ni forcément le téléphone/adresse (selon le chemin de création).
  // État SÉPARÉ de selectedClient (que l'init du formulaire réinitialise) et recalé
  // sur l'id du RDV : passer d'un bloc à l'autre recharge toujours la fiche.
  const [linkedClientDetails, setLinkedClientDetails] = useState(null);
  useEffect(() => {
    setLinkedClientDetails(null);
    if (!isOpen || !isEdit || !appointment?.client_id || !orgId) return;
    let cancelled = false;
    supabase
      .from('majordhome_clients')
      .select('id, display_name, client_number, phone, address, postal_code, city')
      .eq('id', appointment.client_id)
      .eq('org_id', orgId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { logger.warn('[EventModal] fetch linked client error:', error); return; }
        if (data) setLinkedClientDetails(data);
      });
    return () => { cancelled = true; };
  }, [isOpen, isEdit, appointment?.id, appointment?.client_id, orgId]);

  // Client lié tel qu'affiché : sélection courante complétée par sa fiche.
  const selectedClientView = useMemo(() => {
    if (!selectedClient || linkedClientDetails?.id !== selectedClient.id) return selectedClient;
    return {
      ...selectedClient,
      display_name: selectedClient.display_name || linkedClientDetails.display_name,
      client_number: selectedClient.client_number || linkedClientDetails.client_number,
      phone: selectedClient.phone || linkedClientDetails.phone,
      address: linkedClientDetails.address,
      postal_code: linkedClientDetails.postal_code,
      city: selectedClient.city || linkedClientDetails.city,
    };
  }, [selectedClient, linkedClientDetails]);

  const handleSelectClient = useCallback(async (client) => {
    try {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, email, phone, address, postal_code, city, client_number')
        .eq('id', client.id)
        .single();

      if (error || !data) {
        logger.error('[EventModal] fetch client error:', error);
        return;
      }

      setSelectedClient(clientRef(data));
      setShowClientDropdown(false);
      clearClientSearch();
      setFormData((prev) => ({ ...prev, ...contactFromRecord(data, { nameFallback: data.display_name }) }));
    } catch (err) {
      logger.error('[EventModal] fetch client error:', err);
    }
  }, [clearClientSearch, setFormData]);

  const handleUnlinkClient = useCallback(() => {
    setSelectedClient(null);
    clearClientSearch();
    setFormData((prev) => ({ ...prev, ...EMPTY_CONTACT }));
  }, [clearClientSearch, setFormData]);

  const handleSelectLead = useCallback(async (lead) => {
    setSelectedLead({
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      display_name: lead.display_name,
      status_label: lead.status_label,
      source_name: lead.source_name,
      client_id: lead.client_id,
    });
    setShowClientDropdown(false);
    clearClientSearch();
    clearLeadSearch();
    setFormData((prev) => ({ ...prev, ...contactFromRecord(lead) }));

    // Si le lead est lié à un client, set aussi selectedClient
    if (lead.client_id) {
      try {
        const { data } = await supabase
          .from('majordhome_clients')
          .select('id, display_name, client_number, phone, city')
          .eq('id', lead.client_id)
          .single();
        if (data) setSelectedClient(clientRef(data));
      } catch (err) {
        logger.error('[EventModal] fetch lead client error:', err);
      }
    }
  }, [clearClientSearch, clearLeadSearch, setFormData]);

  const handleUnlinkLead = useCallback(() => {
    setSelectedLead(null);
  }, []);

  return {
    selectedClient, setSelectedClient, selectedClientView, selectedLead, setSelectedLead,
    showClientDropdown, setShowClientDropdown,
    clientSearchQuery, clientSearchResults, clientSearching, searchClient, clearClientSearch,
    leadSearchResults, leadSearching, searchLead, clearLeadSearch, recentPipelineCards,
    handleSelectClient, handleUnlinkClient, handleSelectLead, handleUnlinkLead,
  };
}
