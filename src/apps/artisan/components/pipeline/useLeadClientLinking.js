/**
 * useLeadClientLinking.js — liaison d'un lead à une fiche client (sorti de LeadModal).
 * Recherche MDH + Pennylane en éventail, import d'un customer Pennylane comme client,
 * sélection (recopie les coordonnées de la fiche dans le formulaire) et déliage.
 */
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useClientSearch } from '@hooks/useClients';
import { usePennylaneClientSearch, useImportPennylaneCustomer } from '@hooks/usePennylane';
import { logger } from '@lib/logger';

export function useLeadClientLinking({ orgId, pennylaneActive, sources, setForm }) {
  const [linkedClient, setLinkedClient] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [editClientMode, setEditClientMode] = useState(false);
  const [showLinkSearch, setShowLinkSearch] = useState(false);

  const { query: clientSearchQuery, results: clientResults, searching: clientSearching, search: searchClientMdh, clear: clearClientMdhSearch } = useClientSearch(orgId);
  // Bug #5 ROGERO : search customer Pennylane (cache D.5 + fallback live)
  const { results: pennylaneResults, searching: pennylaneSearching, search: searchPennylane, clear: clearPennylaneSearch } = usePennylaneClientSearch();
  const { importCustomer, isImporting: isImportingPennylane } = useImportPennylaneCustomer();

  // Fan-out search MDH + Pennylane (search PL skip si org sans PL)
  const searchClient = useCallback((value) => {
    searchClientMdh(value);
    if (pennylaneActive) searchPennylane(value);
  }, [searchClientMdh, searchPennylane, pennylaneActive]);
  const clearClientSearch = useCallback(() => {
    clearClientMdhSearch();
    clearPennylaneSearch();
  }, [clearClientMdhSearch, clearPennylaneSearch]);

  const handleSelectClient = useCallback(async (client) => {
    try {
      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, company_name, email, phone, phone_secondary, address, address_complement, postal_code, city, client_number')
        .eq('id', client.id)
        .single();

      if (error || !data) {
        logger.error('[LeadModal] fetch client error:', error);
        return;
      }

      setLinkedClient(data);
      setShowClientDropdown(false);
      setEditClientMode(false);
      setShowLinkSearch(false);
      clearClientSearch();

      const clientExistantSource = sources.find((s) => s.name === 'Client Existant');

      setForm((prev) => ({
        ...prev,
        first_name: data.first_name || '',
        last_name: data.last_name || data.display_name || '',
        company_name: data.company_name || '',
        email: data.email || '',
        phone: data.phone || '',
        phone_secondary: data.phone_secondary || '',
        address: data.address || '',
        address_complement: data.address_complement || '',
        postal_code: data.postal_code || '',
        city: data.city || '',
        source_id: clientExistantSource?.id || prev.source_id,
      }));
    } catch (err) {
      logger.error('[LeadModal] fetch client error:', err);
    }
  }, [clearClientSearch, sources, setForm]);

  const handleUnlinkClient = useCallback(() => {
    setLinkedClient(null);
    setEditClientMode(false);
    setShowLinkSearch(false);
    clearClientSearch();
    toast.info('Client délié — vous pouvez en rechercher un autre ou laisser vide');
  }, [clearClientSearch]);

  // Bug #5 ROGERO — import un customer Pennylane comme nouveau client MDH +
  // lie automatiquement au lead courant (via handleSelectClient).
  const handleImportPennylane = useCallback(async (plCustomer) => {
    try {
      const result = await importCustomer(plCustomer);
      const client = result?.client;
      if (!client?.id) {
        toast.error('Import depuis Pennylane échoué');
        return;
      }
      // Lie le lead au client (existant ou nouvellement créé)
      await handleSelectClient(client);
      toast.success(
        result.alreadyExisted
          ? `Client existant lié (${client.display_name || 'sans nom'})`
          : `Client importé depuis Pennylane (${client.display_name || 'sans nom'})`,
      );
    } catch (err) {
      logger.error('[LeadModal] import Pennylane error:', err);
      toast.error(err?.message || 'Erreur lors de l\'import du client Pennylane');
    }
  }, [importCustomer, handleSelectClient]);

  return {
    linkedClient, setLinkedClient, showClientDropdown, setShowClientDropdown,
    editClientMode, setEditClientMode, showLinkSearch, setShowLinkSearch,
    clientSearchQuery, clientResults, clientSearching, searchClient, clearClientSearch,
    pennylaneResults, pennylaneSearching, isImportingPennylane,
    handleSelectClient, handleUnlinkClient, handleImportPennylane,
  };
}
