import { useState } from 'react';
import { createPortal } from 'react-dom';
import { User, Phone, MapPin, Home, FileText, ExternalLink, Link2, X, Search, Loader2, UserCheck, Users, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FormField, TextInput, PhoneInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';
import { CLIENT_CATEGORIES, LEAD_SOURCES, HOUSING_TYPES } from '@services/clients.service';
import { useLinkedClients, useClientSearch } from '@hooks/useClients';
import { ClientModal } from '@/apps/artisan/components/clients/ClientModal';

// ============================================================================
// SOUS-COMPOSANT — Carte client lié
// ============================================================================

function LinkedClientCard({ client, role, onUnlink, isUnlinking }) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between p-3 bg-secondary-50 border border-secondary-200 rounded-lg">
      <div
        className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-1 min-w-0"
        onClick={() => navigate(`/clients/${client.id}`)}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          role === 'proprietaire' ? 'bg-blue-100' : 'bg-orange-100'
        }`}>
          {role === 'proprietaire' ? <UserCheck className="w-4 h-4 text-blue-600" /> : <Users className="w-4 h-4 text-orange-600" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-secondary-900 truncate">{client.display_name}</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full ${
              role === 'proprietaire' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
            }`}>
              {role === 'proprietaire' ? 'Propriétaire' : 'Locataire'}
            </span>
          </div>
          <p className="text-xs text-secondary-500 truncate">
            {[client.address, client.city, client.postal_code].filter(Boolean).join(', ')}
            {client.phone && ` • ${client.phone}`}
          </p>
        </div>
      </div>
      {onUnlink && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnlink(client.id); }}
          disabled={isUnlinking}
          className="p-1.5 text-secondary-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0 ml-2"
          title="Délier ce client"
        >
          {isUnlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// SOUS-COMPOSANT — Recherche et liaison
// ============================================================================

function LinkClientSearch({ clientId, orgId, onLink, isLinking }) {
  const [showSearch, setShowSearch] = useState(false);
  const [linkAs, setLinkAs] = useState(null); // 'proprietaire' | 'locataire'
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { query, results, searching, search, clear } = useClientSearch(orgId);

  const handleSelect = async (selectedClient) => {
    if (selectedClient.id === clientId) {
      toast.error('Un client ne peut pas être lié à lui-même');
      return;
    }

    try {
      if (linkAs === 'proprietaire') {
        await onLink({ tenantId: clientId, ownerId: selectedClient.id });
      } else {
        await onLink({ tenantId: selectedClient.id, ownerId: clientId });
      }
      toast.success('Clients liés avec succès');
      setShowSearch(false);
      setLinkAs(null);
      clear();
    } catch (err) {
      toast.error('Erreur lors de la liaison : ' + (err?.message || 'Erreur inconnue'));
    }
  };

  // Callback après création d'un nouveau client via la modale
  const handleClientCreated = async (newClient) => {
    if (!newClient?.id) return;
    try {
      if (linkAs === 'proprietaire') {
        await onLink({ tenantId: clientId, ownerId: newClient.id });
      } else {
        await onLink({ tenantId: newClient.id, ownerId: clientId });
      }
      toast.success('Client créé et lié avec succès');
    } catch (err) {
      toast.error('Client créé mais erreur lors de la liaison : ' + (err?.message || ''));
    }
    setShowCreateModal(false);
    setShowSearch(false);
    setLinkAs(null);
    clear();
  };

  if (!showSearch) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => { setShowSearch(true); setLinkAs('proprietaire'); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
        >
          <UserCheck className="w-3.5 h-3.5" />
          Lier un propriétaire
        </button>
        <button
          onClick={() => { setShowSearch(true); setLinkAs('locataire'); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
        >
          <Users className="w-3.5 h-3.5" />
          Lier un locataire
        </button>
      </div>
    );
  }

  const filteredResults = results.filter(c => c.id !== clientId);
  const noResults = query.length >= 2 && !searching && filteredResults.length === 0;

  return (
    <>
      <div className="border border-secondary-200 rounded-lg p-3 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-secondary-700">
            {linkAs === 'proprietaire' ? 'Rechercher le propriétaire' : 'Rechercher le locataire'}
          </span>
          <button
            onClick={() => { setShowSearch(false); setLinkAs(null); clear(); }}
            className="p-1 text-secondary-400 hover:text-secondary-600 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Rechercher par nom, téléphone, email..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            autoFocus
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400 animate-spin" />}
        </div>
        {filteredResults.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredResults.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                disabled={isLinking}
                className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-secondary-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <User className="w-4 h-4 text-secondary-400 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-secondary-900 truncate block">{c.display_name}</span>
                  <span className="text-xs text-secondary-500">{[c.city, c.postal_code].filter(Boolean).join(' ')}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {noResults && (
          <p className="text-xs text-secondary-500 text-center py-2">Aucun client trouvé</p>
        )}
        {/* Bouton créer un nouveau client — toujours visible pendant la recherche */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Créer un nouveau client
        </button>
      </div>

      {/* Modale création client — Portal pour éviter les conflits z-index */}
      {showCreateModal && createPortal(
        <ClientModal
          isOpen={true}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleClientCreated}
        />,
        document.body
      )}
    </>
  );
}

// ============================================================================
// SOUS-COMPOSANT — Section clients liés
// ============================================================================

function LinkedClientsSection({ clientId, orgId, isLocked }) {
  const { owner, tenants, isLoading, linkClient, unlinkClient, isUnlinking } = useLinkedClients(clientId, orgId);

  const hasLinks = owner || tenants.length > 0;

  const handleUnlink = async (targetId) => {
    if (!window.confirm('Voulez-vous vraiment délier ce client ?')) return;
    try {
      const { error } = await unlinkClient(targetId);
      if (error) throw error;
      toast.success('Client délié');
    } catch (err) {
      toast.error('Erreur : ' + (err?.message || 'Erreur inconnue'));
    }
  };

  return (
    <section>
      <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-secondary-500" />
        Clients liés
        {hasLinks && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-secondary-100 text-secondary-600 rounded-full">
            {(owner ? 1 : 0) + tenants.length}
          </span>
        )}
      </h3>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-secondary-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement...
        </div>
      ) : (
        <div className="space-y-3">
          {/* Propriétaire */}
          {owner && (
            <LinkedClientCard
              client={owner}
              role="proprietaire"
              onUnlink={!isLocked ? () => handleUnlink(clientId) : null}
              isUnlinking={isUnlinking}
            />
          )}

          {/* Locataires */}
          {tenants.map((tenant) => (
            <LinkedClientCard
              key={tenant.id}
              client={tenant}
              role="locataire"
              onUnlink={!isLocked ? () => handleUnlink(tenant.id) : null}
              isUnlinking={isUnlinking}
            />
          ))}

          {/* Aucun lien */}
          {!hasLinks && (
            <p className="text-sm text-secondary-500 italic">Aucun client lié</p>
          )}

          {/* Boutons de liaison (en mode édition) */}
          {!isLocked && !owner && (
            <LinkClientSearch
              clientId={clientId}
              orgId={orgId}
              onLink={linkClient}
              isLinking={false}
            />
          )}
          {/* Si déjà locataire (a un owner), pas de bouton "lier propriétaire" */}
          {/* Si propriétaire, on peut ajouter d'autres locataires */}
          {!isLocked && owner && !tenants.length && (
            <p className="text-xs text-secondary-400">Ce client est un locataire. Pour ajouter d'autres liens, délier d'abord le propriétaire.</p>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL — TabInfo
// ============================================================================

export const TabInfo = ({ formData, setFormData, isLocked, clientId, orgId }) => {
  const u = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-8">
      {/* Identité */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-secondary-500" />
          Identité
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Nom" required>
            <TextInput value={formData.lastName} onChange={(v) => u('lastName', v.toUpperCase())} placeholder="DUPONT" disabled={isLocked} />
          </FormField>
          <FormField label="Prénom">
            <TextInput value={formData.firstName} onChange={(v) => u('firstName', v.toUpperCase())} placeholder="JEAN" disabled={isLocked} />
          </FormField>
          <FormField label="Catégorie">
            <SelectInput value={formData.clientCategory} onChange={(v) => u('clientCategory', v)} options={CLIENT_CATEGORIES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <FormField label="Société">
            <TextInput value={formData.companyName} onChange={(v) => u('companyName', v)} placeholder="Entreprise (optionnel)" disabled={isLocked} />
          </FormField>
          <FormField label="Source">
            <SelectInput value={formData.leadSource} onChange={(v) => u('leadSource', v)} options={LEAD_SOURCES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4 text-secondary-500" />
          Contact
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Téléphone">
            <PhoneInput value={formData.phone} onChange={(v) => u('phone', v)} disabled={isLocked} />
          </FormField>
          <FormField label="Téléphone secondaire">
            <PhoneInput value={formData.phoneSecondary} onChange={(v) => u('phoneSecondary', v)} placeholder="Fixe, bureau..." disabled={isLocked} />
          </FormField>
          <FormField label="Email">
            <TextInput value={formData.email} onChange={(v) => u('email', v)} placeholder="client@email.com" type="email" disabled={isLocked} />
          </FormField>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-secondary-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={formData.mailOptin !== false}
            onChange={(e) => u('mailOptin', e.target.checked)}
            disabled={isLocked}
            className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
          />
          Accepte de recevoir des emails (optin mailing)
        </label>
      </section>

      {/* Adresse */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-secondary-500" />
          Adresse
        </h3>
        <div className="space-y-4">
          <FormField label="Adresse">
            <TextInput value={formData.address} onChange={(v) => u('address', v)} placeholder="12 rue des Lilas" disabled={isLocked} />
          </FormField>
          <FormField label="Complément">
            <TextInput value={formData.addressComplement} onChange={(v) => u('addressComplement', v)} placeholder="Bâtiment, étage..." disabled={isLocked} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code postal">
              <TextInput value={formData.postalCode} onChange={(v) => u('postalCode', v)} placeholder="40100" disabled={isLocked} />
            </FormField>
            <FormField label="Ville">
              <TextInput value={formData.city} onChange={(v) => u('city', v)} placeholder="Dax" disabled={isLocked} />
            </FormField>
          </div>
          <FormField label="Instructions d'accès">
            <TextInput value={formData.accessInstructions} onChange={(v) => u('accessInstructions', v)} placeholder="Digicode, portail, code clé..." disabled={isLocked} />
          </FormField>
        </div>
      </section>

      {/* Logement */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <Home className="w-4 h-4 text-secondary-500" />
          Logement
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Type">
            <SelectInput value={formData.housingType} onChange={(v) => u('housingType', v)} options={HOUSING_TYPES} placeholder="Sélectionner..." disabled={isLocked} />
          </FormField>
          <FormField label="Surface (m²)">
            <TextInput value={formData.surface} onChange={(v) => u('surface', v)} placeholder="120" type="number" disabled={isLocked} />
          </FormField>
          <FormField label="N° DPE ADEME">
            <div className="flex gap-2">
              <TextInput value={formData.dpeNumber} onChange={(v) => u('dpeNumber', v)} placeholder="2341E0000000X" disabled={isLocked} />
              {formData.dpeNumber && (
                <a
                  href={`https://observatoire-dpe.ademe.fr/trouver-dpe#${formData.dpeNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                  title="Voir sur ADEME"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              )}
            </div>
          </FormField>
        </div>
      </section>

      {/* Clients liés (Propriétaire / Locataire) */}
      {clientId && orgId && (
        <LinkedClientsSection clientId={clientId} orgId={orgId} isLocked={isLocked} />
      )}

      {/* Notes */}
      <section>
        <h3 className="text-sm font-semibold text-secondary-900 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-secondary-500" />
          Notes
        </h3>
        <TextArea value={formData.notes} onChange={(v) => u('notes', v)} placeholder="Notes visibles par toute l'équipe..." rows={3} disabled={isLocked} />
        <div className="mt-4">
          <FormField label="Notes internes">
            <TextArea value={formData.internalNotes} onChange={(v) => u('internalNotes', v)} placeholder="Notes internes (non visibles par le client)" rows={2} disabled={isLocked} />
          </FormField>
        </div>
      </section>
    </div>
  );
};
