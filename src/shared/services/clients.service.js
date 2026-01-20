/**
 * clients.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des clients (projets/logements).
 * 
 * Structure réelle :
 * - projects : Clients avec identity (JSON contenant email, phone, address, etc.)
 * - majordhome_equipments : Équipements avec contrats
 * - majordhome_interventions : Historique interventions
 * 
 * @version 4.2.0 - Fix updateClient avec tous les champs + first_name/last_name
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Statuts pipeline client
 */
export const CLIENT_STATUSES = [
  { value: 'lead', label: 'Lead', color: 'bg-gray-100 text-gray-700' },
  { value: 'prospect', label: 'Prospect', color: 'bg-blue-100 text-blue-700' },
  { value: 'active', label: 'Actif', color: 'bg-green-100 text-green-700' },
  { value: 'inactive', label: 'Inactif', color: 'bg-amber-100 text-amber-700' },
  { value: 'archived', label: 'Archivé', color: 'bg-red-100 text-red-700' },
];

/**
 * Types de clients (depuis identity.client_type)
 */
export const CLIENT_TYPES = [
  { value: 'contrat_actif', label: 'Contrat actif' },
  { value: 'client_equipement', label: 'Client équipement' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'ancien_client', label: 'Ancien client' },
];

/**
 * Types d'équipements
 */
export const EQUIPMENT_TYPES = [
  { value: 'chaudiere_gaz', label: 'Chaudière gaz' },
  { value: 'chaudiere_fioul', label: 'Chaudière fioul' },
  { value: 'pac_air_eau', label: 'PAC Air/Eau' },
  { value: 'pac_air_air', label: 'PAC Air/Air' },
  { value: 'climatisation', label: 'Climatisation' },
  { value: 'vmc', label: 'VMC' },
  { value: 'chauffe_eau', label: 'Chauffe-eau' },
  { value: 'poele', label: 'Poêle' },
  { value: 'autre', label: 'Autre' },
];

/**
 * Fréquences de contrat
 */
export const CONTRACT_FREQUENCIES = [
  { value: 'annual', label: 'Annuel' },
  { value: 'biannual', label: 'Semestriel' },
  { value: 'quarterly', label: 'Trimestriel' },
  { value: 'on_demand', label: 'À la demande' },
];

/**
 * Sources de lead
 */
export const LEAD_SOURCES = [
  { value: 'website', label: 'Site internet' },
  { value: 'phone', label: 'Appel entrant' },
  { value: 'walk_in', label: 'Visite agence' },
  { value: 'referral', label: 'Bouche à oreille' },
  { value: 'partner', label: 'Partenaire/Apporteur' },
  { value: 'advertising', label: 'Publicité' },
  { value: 'existing', label: 'Client existant' },
  { value: 'other', label: 'Autre' },
];

const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extrait les données du JSON identity et les aplatit
 * Dérive contract_status depuis has_contrat
 */
function flattenClient(project) {
  const identity = project.identity || {};
  
  // Déterminer le contract_status depuis has_contrat (boolean)
  const hasContrat = identity.has_contrat === true;
  let contractStatus = 'none';
  
  if (hasContrat) {
    contractStatus = 'active';
  } else if (identity.client_type === 'ancien_client') {
    contractStatus = 'expired';
  }
  
  return {
    ...project,
    // Données extraites de identity
    first_name: identity.first_name || null,
    last_name: identity.last_name || null,
    address: identity.address || null,
    postal_code: identity.postal_code || null,
    city: identity.city || null,
    phone: identity.phone || null,
    email: identity.email || null,
    client_type: identity.client_type || null,
    has_contrat: hasContrat,
    fiable: identity.fiable || null,
    import_source: identity.import_source || null,
    // Champs supplémentaires
    housing_type: identity.housing_type || null,
    surface: identity.surface || null,
    dpe_number: identity.dpe_number || null,
    contract_frequency: identity.contract_frequency || null,
    next_maintenance_date: identity.next_maintenance_date || null,
    lead_source: identity.lead_source || null,
    // Dérivé : contract_status pour l'affichage du badge
    contract_status: contractStatus,
  };
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const clientsService = {
  // ==========================================================================
  // LECTURE - LISTE
  // ==========================================================================

  /**
   * Récupère la liste des clients avec filtres et pagination
   * Filtrage hasContract fait côté SQL (pas après pagination)
   */
  async getClients({
    orgId,
    search = '',
    status = null,
    postalCode = null,
    hasContract = null,
    orderBy = 'name',
    ascending = true,
    limit = DEFAULT_LIMIT,
    offset = DEFAULT_OFFSET,
  } = {}) {
    try {
      if (!orgId) {
        throw new Error('orgId est requis');
      }

      // Construire la requête
      let query = supabase
        .from('projects')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .neq('status', 'archived');

      // Filtre statut
      if (status) {
        query = query.eq('status', status);
      }

      // Recherche textuelle (nom client)
      if (search && search.trim()) {
        query = query.ilike('name', `%${search.trim()}%`);
      }

      // Filtre contrat côté SQL (dans le JSON identity)
      // identity->>'has_contrat' retourne 'true' ou 'false' en texte
      if (hasContract === true) {
        query = query.eq('identity->>has_contrat', 'true');
      } else if (hasContract === false) {
        query = query.eq('identity->>has_contrat', 'false');
      }

      // Filtre code postal côté SQL
      if (postalCode) {
        query = query.ilike('identity->>postal_code', `${postalCode}%`);
      }

      // Tri
      query = query.order(orderBy, { ascending });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data: projects, count, error } = await query;

      if (error) throw error;

      if (!projects || projects.length === 0) {
        return { data: [], count: 0, error: null };
      }

      // Aplatir les données identity
      const clients = projects.map(flattenClient);

      return { data: clients, count, error: null };
    } catch (error) {
      console.error('clientsService.getClients error:', error);
      return { data: null, count: null, error };
    }
  },

  // ==========================================================================
  // LECTURE - DÉTAIL
  // ==========================================================================

  /**
   * Récupère un client complet avec équipements et interventions
   */
  async getClientById(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      // 1. Récupérer le projet
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', clientId)
        .single();

      if (projectError) throw projectError;

      // 2. Récupérer les équipements
      const { data: equipments, error: equipError } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('project_id', clientId)
        .order('created_at', { ascending: false });

      if (equipError) console.warn('Erreur équipements:', equipError);

      // 3. Récupérer les interventions
      const { data: interventions, error: interError } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('project_id', clientId)
        .order('scheduled_date', { ascending: false })
        .limit(20);

      if (interError) console.warn('Erreur interventions:', interError);

      // 4. Construire l'objet client
      const client = {
        ...flattenClient(project),
        equipments: equipments || [],
        interventions: interventions || [],
        equipments_count: equipments?.length || 0,
        interventions_count: interventions?.length || 0,
        // Déterminer si contrat actif depuis les équipements
        active_contracts: (equipments || []).filter(e => e.contract_status === 'active').length,
      };

      return { data: client, error: null };
    } catch (error) {
      console.error('clientsService.getClientById error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  /**
   * Crée un nouveau client
   */
  async createClient({
    orgId,
    firstName = null,
    lastName = null,
    name = null,
    address = null,
    postalCode = null,
    city = null,
    phone = null,
    email = null,
    status = 'active',
    clientType = 'prospect',
    notes = null,
  } = {}) {
    try {
      if (!orgId) {
        throw new Error('orgId est requis');
      }

      // Construire le nom complet
      const fullName = name || `${lastName || ''} ${firstName || ''}`.trim();
      
      if (!fullName) {
        throw new Error('name ou lastName est requis');
      }

      // Nettoyer le téléphone (garder uniquement les chiffres + espaces formatés)
      const cleanPhone = phone ? phone.replace(/[^\d\s]/g, '').trim() : null;

      const slug = fullName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const { data, error } = await supabase
        .from('projects')
        .insert({
          org_id: orgId,
          name: fullName,
          slug: `${slug}-${Date.now()}`,
          status,
          identity: {
            first_name: firstName,
            last_name: lastName,
            address,
            postal_code: postalCode,
            city,
            phone: cleanPhone,
            email,
            client_type: clientType,
            has_contrat: false,
            created_from: 'artisan_app',
          },
          description: notes,
        })
        .select()
        .single();

      if (error) throw error;

      return { data: flattenClient(data), error: null };
    } catch (error) {
      console.error('clientsService.createClient error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour un client
   * Gère TOUS les champs du formulaire
   */
  async updateClient(clientId, updates = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      console.log('[clientsService] updateClient called with:', { clientId, updates });

      // Récupérer le client actuel pour merger l'identity
      const { data: current, error: fetchError } = await supabase
        .from('projects')
        .select('identity')
        .eq('id', clientId)
        .single();

      if (fetchError) throw fetchError;

      const currentIdentity = current.identity || {};

      // Préparer les updates pour la table projects
      const projectUpdates = {
        updated_at: new Date().toISOString(),
      };

      // Champ name (reconstruit depuis firstName/lastName si fournis)
      if (updates.firstName !== undefined || updates.lastName !== undefined) {
        const firstName = updates.firstName ?? currentIdentity.first_name ?? '';
        const lastName = updates.lastName ?? currentIdentity.last_name ?? '';
        projectUpdates.name = `${lastName} ${firstName}`.trim();
      } else if (updates.name !== undefined) {
        projectUpdates.name = updates.name;
      }

      // Champ status
      if (updates.status !== undefined) {
        projectUpdates.status = updates.status;
      }

      // Champ description (notes)
      if (updates.notes !== undefined) {
        projectUpdates.description = updates.notes;
      }

      // Construire le nouvel objet identity avec TOUS les champs
      const newIdentity = { ...currentIdentity };

      // Nom / Prénom
      if (updates.firstName !== undefined) {
        newIdentity.first_name = updates.firstName || null;
      }
      if (updates.lastName !== undefined) {
        newIdentity.last_name = updates.lastName || null;
      }

      // Adresse
      if (updates.address !== undefined) {
        newIdentity.address = updates.address || null;
      }
      if (updates.postalCode !== undefined) {
        newIdentity.postal_code = updates.postalCode || null;
      }
      if (updates.city !== undefined) {
        newIdentity.city = updates.city || null;
      }

      // Contact
      if (updates.phone !== undefined) {
        // Nettoyer le téléphone
        newIdentity.phone = updates.phone ? updates.phone.replace(/[^\d\s]/g, '').trim() : null;
      }
      if (updates.email !== undefined) {
        newIdentity.email = updates.email || null;
      }

      // Habitat
      if (updates.housingType !== undefined) {
        newIdentity.housing_type = updates.housingType || null;
      }
      if (updates.surface !== undefined) {
        newIdentity.surface = updates.surface ? parseFloat(updates.surface) : null;
      }
      if (updates.dpeNumber !== undefined) {
        newIdentity.dpe_number = updates.dpeNumber || null;
      }

      // Contrat
      if (updates.hasContrat !== undefined) {
        newIdentity.has_contrat = updates.hasContrat === true;
      }
      if (updates.contractFrequency !== undefined) {
        newIdentity.contract_frequency = updates.contractFrequency || null;
      }
      if (updates.nextMaintenanceDate !== undefined) {
        newIdentity.next_maintenance_date = updates.nextMaintenanceDate || null;
      }

      // Commercial
      if (updates.clientType !== undefined) {
        newIdentity.client_type = updates.clientType || null;
      }
      if (updates.leadSource !== undefined) {
        newIdentity.lead_source = updates.leadSource || null;
      }

      // Toujours mettre à jour identity
      projectUpdates.identity = newIdentity;

      console.log('[clientsService] Sending update:', projectUpdates);

      const { data, error } = await supabase
        .from('projects')
        .update(projectUpdates)
        .eq('id', clientId)
        .select()
        .single();

      if (error) throw error;

      console.log('[clientsService] Update successful:', data);

      return { data: flattenClient(data), error: null };
    } catch (error) {
      console.error('clientsService.updateClient error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  /**
   * Archive un client
   */
  async archiveClient(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { error } = await supabase
        .from('projects')
        .update({ 
          status: 'archived',
          updated_at: new Date().toISOString(),
        })
        .eq('id', clientId);

      if (error) throw error;

      return { success: true, error: null };
    } catch (error) {
      console.error('clientsService.archiveClient error:', error);
      return { success: false, error };
    }
  },

  // ==========================================================================
  // ÉQUIPEMENTS
  // ==========================================================================

  /**
   * Récupère les équipements d'un client
   */
  async getClientEquipments(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('project_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('clientsService.getClientEquipments error:', error);
      return { data: null, error };
    }
  },

  /**
   * Ajoute un équipement
   */
  async addEquipment(clientId, equipmentData = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .insert({
          project_id: clientId,
          category: equipmentData.category,
          brand: equipmentData.brand,
          model: equipmentData.model,
          serial_number: equipmentData.serialNumber,
          install_date: equipmentData.installDate,
          warranty_end_date: equipmentData.warrantyEndDate,
          maintenance_frequency_months: equipmentData.maintenanceFrequency,
          contract_type: equipmentData.contractType,
          contract_tarif: equipmentData.contractTarif,
          contract_start_date: equipmentData.contractStartDate,
          contract_status: equipmentData.contractStatus || 'none',
          notes: equipmentData.notes,
        })
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('clientsService.addEquipment error:', error);
      return { data: null, error };
    }
  },

  /**
   * Met à jour un équipement
   */
  async updateEquipment(equipmentId, updates = {}) {
    try {
      if (!equipmentId) {
        throw new Error('equipmentId est requis');
      }

      const updateData = {
        updated_at: new Date().toISOString(),
      };

      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.brand !== undefined) updateData.brand = updates.brand;
      if (updates.model !== undefined) updateData.model = updates.model;
      if (updates.serialNumber !== undefined) updateData.serial_number = updates.serialNumber;
      if (updates.installDate !== undefined) updateData.install_date = updates.installDate;
      if (updates.warrantyEndDate !== undefined) updateData.warranty_end_date = updates.warrantyEndDate;
      if (updates.maintenanceFrequency !== undefined) updateData.maintenance_frequency_months = updates.maintenanceFrequency;
      if (updates.lastMaintenanceDate !== undefined) updateData.last_maintenance_date = updates.lastMaintenanceDate;
      if (updates.nextMaintenanceDue !== undefined) updateData.next_maintenance_due = updates.nextMaintenanceDue;
      if (updates.contractType !== undefined) updateData.contract_type = updates.contractType;
      if (updates.contractTarif !== undefined) updateData.contract_tarif = updates.contractTarif;
      if (updates.contractStartDate !== undefined) updateData.contract_start_date = updates.contractStartDate;
      if (updates.contractStatus !== undefined) updateData.contract_status = updates.contractStatus;
      if (updates.notes !== undefined) updateData.notes = updates.notes;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .update(updateData)
        .eq('id', equipmentId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('clientsService.updateEquipment error:', error);
      return { data: null, error };
    }
  },

  /**
   * Supprime un équipement
   */
  async deleteEquipment(equipmentId) {
    try {
      if (!equipmentId) {
        throw new Error('equipmentId est requis');
      }

      const { error } = await supabase
        .from('majordhome_equipments')
        .delete()
        .eq('id', equipmentId);

      if (error) throw error;

      return { success: true, error: null };
    } catch (error) {
      console.error('clientsService.deleteEquipment error:', error);
      return { success: false, error };
    }
  },

  // ==========================================================================
  // INTERVENTIONS
  // ==========================================================================

  /**
   * Récupère les interventions d'un client
   */
  async getClientInterventions(clientId, { limit = 20 } = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('project_id', clientId)
        .order('scheduled_date', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('clientsService.getClientInterventions error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // STATISTIQUES
  // ==========================================================================

  /**
   * Récupère les statistiques clients
   * Compte les contrats actifs depuis identity.has_contrat
   */
  async getClientStats(orgId) {
    try {
      if (!orgId) {
        throw new Error('orgId est requis');
      }

      // Total clients (non archivés)
      const { count: totalClients, error: totalError } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'archived');

      if (totalError) throw totalError;

      // Contrats actifs (identity->>'has_contrat' = 'true')
      const { count: activeContracts, error: contractError } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'archived')
        .eq('identity->>has_contrat', 'true');

      if (contractError) throw contractError;

      // Clients par statut
      const { data: statusData, error: statusError } = await supabase
        .from('projects')
        .select('status')
        .eq('org_id', orgId)
        .neq('status', 'archived');

      if (statusError) throw statusError;

      const byStatus = (statusData || []).reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      return {
        data: {
          total_clients: totalClients || 0,
          active_contracts: activeContracts || 0,
          by_status: byStatus,
        },
        error: null,
      };
    } catch (error) {
      console.error('clientsService.getClientStats error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // RECHERCHE
  // ==========================================================================

  /**
   * Recherche rapide de clients
   */
  async searchClients(orgId, query, limit = 10) {
    try {
      if (!orgId || !query || query.length < 2) {
        return { data: [], error: null };
      }

      const { data: projects, error } = await supabase
        .from('projects')
        .select('id, name, identity')
        .eq('org_id', orgId)
        .neq('status', 'archived')
        .ilike('name', `%${query}%`)
        .limit(limit);

      if (error) throw error;

      const results = (projects || []).map(p => {
        const identity = p.identity || {};
        return {
          id: p.id,
          name: p.name,
          phone: identity.phone || null,
          city: identity.city || null,
          display: `${p.name}${identity.city ? ` - ${identity.city}` : ''}`,
        };
      });

      return { data: results, error: null };
    } catch (error) {
      console.error('clientsService.searchClients error:', error);
      return { data: null, error };
    }
  },
};

export default clientsService;
