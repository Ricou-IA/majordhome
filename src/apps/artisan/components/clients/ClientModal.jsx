/**
 * ClientModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale fiche client complète avec système de verrouillage.
 * Onglets : Informations / Équipements / Historique
 *
 * Orchestrateur : état, hooks, handlers. Le JSX des onglets est dans :
 *   - ClientModalTabs.jsx (TabInfo, TabEquipments, TabHistory, CategoryBadge)
 *
 * @version 3.0.0 - Extraction onglets + suppression form fields dupliqués
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, User, Wrench, History, Save, Loader2,
  AlertCircle, CheckCircle, Lock, Unlock, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/shared/hooks/useClients';
import { clientsService } from '@/shared/services/clients.service';
import { geocodeAndUpdateByProjectId } from '@/shared/services/geocoding.service';
import { TabInfo, TabEquipments, TabHistory, CategoryBadge } from './ClientModalTabs';

// ============================================================================
// CONSTANTES
// ============================================================================

const TABS = [
  { id: 'info', label: 'Informations', icon: User },
  { id: 'equipments', label: 'Équipements', icon: Wrench },
  { id: 'history', label: 'Historique', icon: History },
];

const EMPTY_FORM = {
  firstName: '', lastName: '', clientCategory: 'particulier',
  companyName: '', address: '', postalCode: '', city: '',
  phone: '', phoneSecondary: '', email: '',
  housingType: '', surface: '', dpeNumber: '',
  leadSource: '', notes: '', createdAt: null,
};

const FIELDS_TO_COMPARE = [
  'firstName', 'lastName', 'clientCategory', 'address', 'postalCode', 'city',
  'phone', 'email', 'housingType', 'surface', 'dpeNumber', 'leadSource', 'notes',
];

/**
 * Parse le nom complet en nom/prénom
 */
const parseFullName = (fullName) => {
  if (!fullName) return { lastName: '', firstName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { lastName: parts[0] || '', firstName: '' };
  return { lastName: parts[0], firstName: parts.slice(1).join(' ') };
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function ClientModal({ clientId, isOpen, onClose, onSaved, onCreated }) {
  const isCreateMode = !clientId;
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  // State
  const [activeTab, setActiveTab] = useState('info');
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isLocked, setIsLocked] = useState(true);

  const originalDataRef = useRef({});
  const contentRef = useRef(null);

  // Hook données (désactivé en mode création)
  const { client, isLoading: loading, updateClient } = useClient(clientId);

  // Construire formData depuis le client DB
  const buildFormData = useCallback((c) => {
    let firstName = c.first_name || '';
    let lastName = c.last_name || '';
    if (!firstName && !lastName && c.display_name) {
      const parsed = parseFullName(c.display_name);
      firstName = parsed.firstName;
      lastName = parsed.lastName;
    }
    return {
      firstName, lastName,
      clientCategory: c.client_category || 'particulier',
      address: c.address || '', postalCode: c.postal_code || '', city: c.city || '',
      phone: c.phone || '', email: c.email || '',
      housingType: c.housing_type || '', surface: c.surface || '',
      dpeNumber: c.dpe_number || '', leadSource: c.lead_source || '',
      notes: c.notes || '', createdAt: c.created_at,
    };
  }, []);

  // Init quand le client est chargé
  useEffect(() => {
    if (client) {
      const data = buildFormData(client);
      setFormData(data);
      originalDataRef.current = data;
    }
  }, [client, buildFormData]);

  // Reset à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setActiveTab('info');
      setErrors({});
      setSaveSuccess(false);
      if (isCreateMode) {
        setFormData({ ...EMPTY_FORM });
        originalDataRef.current = { ...EMPTY_FORM };
        setIsLocked(false);
      } else {
        setIsLocked(true);
      }
    }
  }, [clientId, isOpen, isCreateMode]);

  // Détection modifications
  const hasUnsavedChanges = useCallback(() => {
    const orig = originalDataRef.current;
    return FIELDS_TO_COMPARE.some(f => String(orig[f] ?? '') !== String(formData[f] ?? ''));
  }, [formData]);

  // Toggle cadenas
  const handleToggleLock = useCallback(() => {
    if (!isLocked) {
      setFormData({ ...originalDataRef.current });
      setErrors({});
    }
    setIsLocked(!isLocked);
  }, [isLocked]);

  // Validation
  const validate = useCallback(() => {
    const newErrors = {};
    if (!formData.lastName?.trim()) newErrors.lastName = 'Le nom est requis';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Sauvegarde
  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveSuccess(false);

    try {
      if (isCreateMode) {
        if (!orgId) throw new Error('Organisation non disponible');
        const { data: newClient, error } = await clientsService.createClient({
          orgId,
          firstName: formData.firstName, lastName: formData.lastName,
          companyName: formData.companyName || null,
          email: formData.email || null, phone: formData.phone || null,
          phoneSecondary: formData.phoneSecondary || null,
          address: formData.address || null, postalCode: formData.postalCode || null,
          city: formData.city || null, housingType: formData.housingType || null,
          surface: formData.surface || null, dpeNumber: formData.dpeNumber || null,
          clientCategory: formData.clientCategory || 'particulier',
          leadSource: formData.leadSource || null, notes: formData.notes || null,
          createdBy: user?.id,
        });
        if (error) throw error;

        if (formData.postalCode && formData.city && newClient?.project_id) {
          geocodeAndUpdateByProjectId(newClient.project_id, formData.address, formData.postalCode, formData.city)
            .catch(err => console.warn('[ClientModal] Auto-geocode failed:', err));
        }
        toast.success('Client créé avec succès');
        onCreated?.(newClient);
        onClose();
      } else {
        const updates = {
          firstName: formData.firstName, lastName: formData.lastName,
          clientCategory: formData.clientCategory,
          address: formData.address, postalCode: formData.postalCode, city: formData.city,
          phone: formData.phone, email: formData.email,
          housingType: formData.housingType, surface: formData.surface,
          dpeNumber: formData.dpeNumber, leadSource: formData.leadSource,
          notes: formData.notes,
        };
        const { error } = await updateClient(updates);
        if (error) throw error;

        if (formData.postalCode && formData.city && client?.project_id) {
          geocodeAndUpdateByProjectId(client.project_id, formData.address, formData.postalCode, formData.city)
            .catch(err => console.warn('[ClientModal] Auto-geocode failed:', err));
        }
        originalDataRef.current = { ...formData };
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (error) {
      console.error('[ClientModal] Erreur sauvegarde:', error);
      setErrors({ general: 'Erreur lors de la sauvegarde: ' + (error.message || 'Erreur inconnue') });
    } finally {
      setSaving(false);
    }
  };

  // Fermeture
  const handleClose = useCallback(() => {
    if (!isLocked && hasUnsavedChanges()) {
      const confirmed = window.confirm(
        'Vous avez des modifications non enregistrées.\n\nVoulez-vous vraiment fermer et perdre ces modifications ?'
      );
      if (!confirmed) return;
    }
    if (saveSuccess) onSaved?.();
    onClose();
  }, [isLocked, hasUnsavedChanges, onClose, onSaved, saveSuccess]);

  if (!isOpen) return null;

  const displayName = isCreateMode
    ? (`${formData.lastName || ''} ${formData.firstName || ''}`.trim() || 'Nouveau client')
    : (`${formData.lastName || ''} ${formData.firstName || ''}`.trim() || 'Client');

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={handleClose} />

      {/* Modale */}
      <div className="fixed inset-4 md:inset-8 lg:inset-16 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isCreateMode ? 'bg-green-100' : 'bg-blue-100'
            }`}>
              {isCreateMode
                ? <Plus className="w-5 h-5 text-green-600" />
                : <User className="w-5 h-5 text-blue-600" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isCreateMode ? 'Nouveau client' : (loading ? 'Chargement...' : displayName)}
              </h2>
              {!isCreateMode && client && (
                <div className="flex items-center gap-2 mt-0.5">
                  <CategoryBadge clientCategory={formData.clientCategory} />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isCreateMode && (
              <button
                onClick={handleToggleLock}
                className={`p-2 rounded-lg transition-colors ${
                  isLocked
                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                }`}
                title={isLocked ? 'Déverrouiller pour modifier' : 'Verrouiller (annule les modifications)'}
              >
                {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Onglets */}
        {!isCreateMode && (
          <div className="flex border-b border-gray-200 px-6">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'text-blue-600 border-blue-600'
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.id === 'equipments' && client?.equipments_count > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                      {client.equipments_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Contenu */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'info' && (
                <TabInfo formData={formData} setFormData={setFormData} errors={errors} isLocked={isLocked} />
              )}
              {activeTab === 'equipments' && <TabEquipments clientId={clientId} />}
              {activeTab === 'history' && <TabHistory interventions={client?.interventions || []} />}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div>
            {errors.general && (
              <p className="text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {errors.general}
              </p>
            )}
            {saveSuccess && (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Modifications enregistrées
              </p>
            )}
            {!isLocked && !errors.general && !saveSuccess && !isCreateMode && (
              <p className="text-sm text-amber-600 flex items-center gap-1">
                <Unlock className="w-4 h-4" /> Mode édition actif
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Fermer
            </button>
            {!isLocked && activeTab === 'info' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className={`inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  isCreateMode ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isCreateMode ? 'Création...' : 'Enregistrement...'}
                  </>
                ) : (
                  <>
                    {isCreateMode ? <Plus className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {isCreateMode ? 'Créer le client' : 'Enregistrer'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default ClientModal;
