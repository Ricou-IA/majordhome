/**
 * CreateSAVModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale de création rapide d'un SAV.
 * Recherche client + description du problème.
 * Peut être pré-rempli (depuis une fiche intervention).
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Wrench, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// HOOK : RECHERCHE CLIENT
// ============================================================================

function useClientSearch(orgId, searchTerm) {
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!orgId || !searchTerm || searchTerm.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const term = `%${searchTerm.trim()}%`;
        const { data } = await supabase
          .from('majordhome_clients')
          .select('id, display_name, first_name, last_name, postal_code, city, phone, project_id, has_active_contract')
          .eq('org_id', orgId)
          .or(`display_name.ilike.${term},postal_code.ilike.${term},city.ilike.${term}`)
          .order('display_name')
          .limit(10);
        setResults(data || []);
      } catch (err) {
        console.error('[CreateSAVModal] search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [orgId, searchTerm]);

  return { results, isSearching };
}

// ============================================================================
// COMPOSANT
// ============================================================================

export function CreateSAVModal({
  isOpen,
  onClose,
  onCreated,
  // Pré-remplissage optionnel (depuis fiche intervention)
  prefillClient = null,
  prefillContractId = null,
  savOrigin = 'appel_client',
}) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { createSAV, isCreatingSAV } = useEntretienSAVMutations();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState(prefillClient);
  const [description, setDescription] = useState('');
  const searchRef = useRef(null);

  const { results, isSearching } = useClientSearch(orgId, searchTerm);

  // Focus on search input when opening
  useEffect(() => {
    if (isOpen && !prefillClient) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen, prefillClient]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSelectedClient(prefillClient);
      setDescription('');
    }
  }, [isOpen, prefillClient]);

  const handleSubmit = async () => {
    if (!selectedClient || !description.trim()) return;

    try {
      // Récupérer le contract_id si le client a un contrat actif
      let contractId = prefillContractId;
      if (!contractId && selectedClient.has_active_contract) {
        const { data: contractData } = await supabase
          .from('majordhome_contracts')
          .select('id')
          .eq('client_id', selectedClient.id)
          .eq('status', 'active')
          .maybeSingle();
        contractId = contractData?.id || null;
      }

      await createSAV({
        orgId,
        clientId: selectedClient.id,
        contractId,
        projectId: selectedClient.project_id,
        savDescription: description.trim(),
        savOrigin,
        createdBy: user?.id,
      });

      onCreated?.();
      onClose();
    } catch (err) {
      console.error('[CreateSAVModal] submit error:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Contenu */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
              <Wrench className="w-4 h-4 text-orange-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Nouvelle demande SAV</h2>
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Sélection client */}
          {selectedClient ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Client</label>
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{selectedClient.display_name}</p>
                    <p className="text-xs text-gray-500">
                      {[selectedClient.postal_code, selectedClient.city].filter(Boolean).join(' ')}
                    </p>
                  </div>
                </div>
                {!prefillClient && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClient(null);
                      setSearchTerm('');
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Changer
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Rechercher un client</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Nom, code postal, ville..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
                )}
              </div>

              {/* Résultats */}
              {results.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                  {results.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setSelectedClient(client);
                        setSearchTerm('');
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900">{client.display_name}</p>
                      <p className="text-xs text-gray-500">
                        {[client.postal_code, client.city].filter(Boolean).join(' ')}
                        {client.has_active_contract && (
                          <span className="ml-2 text-green-600 font-medium">Contrat actif</span>
                        )}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {searchTerm.length >= 2 && results.length === 0 && !isSearching && (
                <p className="text-xs text-gray-400 italic py-2">Aucun client trouvé</p>
              )}
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Description du problème <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Décrivez le problème signalé par le client..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedClient || !description.trim() || isCreatingSAV}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreatingSAV ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wrench className="w-4 h-4" />
            )}
            Créer la demande SAV
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateSAVModal;
