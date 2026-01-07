/**
 * clients.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des clients (projets/logements).
 * 
 * Tables utilisées :
 * - core.projects : Entité client principale
 * - majordhome.home_details : Détails habitat (1:1)
 * - majordhome.equipments : Équipements sous contrat (1:N)
 * - majordhome.interventions : Historique interventions (1:N)
 * 
 * PATTERN D'ACCÈS :
 * - Utilisation de .schema('core') et .schema('majordhome')
 * - Requêtes séparées + merge JS (pas de jointures cross-schema)
 * 
 * @version 2.0.0 - Correction pattern schémas Supabase
 * 
 * @example
 * import { clientsService } from '@/shared/services/clients.service';
 * const { data, error } = await clientsService.getClients({ orgId: 'xxx' });
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
  { value: 'lead_qualified', label: 'Lead qualifié', color: 'bg-blue-100 text-blue-700' },
  { value: 'prospect', label: 'Prospect', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'prospect_qualified', label: 'Prospect qualifié', color: 'bg-purple-100 text-purple-700' },
  { value: 'quote_accepted', label: 'Devis accepté', color: 'bg-amber-100 text-amber-700' },
  { value: 'in_progress', label: 'En cours', color: 'bg-orange-100 text-orange-700' },
  { value: 'completed', label: 'Terminé', color: 'bg-green-100 text-green-700' },
  { value: 'invoiced', label: 'Facturé', color: 'bg-teal-100 text-teal-700' },
  { value: 'paid', label: 'Payé', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'lost', label: 'Perdu', color: 'bg-red-100 text-red-700' },
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

/**
 * Types d'équipements
 */
export const EQUIPMENT_TYPES = [
  { value: 'chaudiere_gaz', label: 'Chaudière gaz' },
  { value: 'chaudiere_fioul', label: 'Chaudière fioul' },
  { value: 'chaudiere_bois', label: 'Chaudière bois' },
  { value: 'pac_air_eau', label: 'PAC Air/Eau' },
  { value: 'pac_air_air', label: 'PAC Air/Air' },
  { value: 'pac_geothermie', label: 'PAC Géothermie' },
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
 * Pagination par défaut
 */
const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Fusionne un projet avec ses home_details
 * @param {Object} project - Projet core.projects
 * @param {Object|null} homeDetails - Détails majordhome.home_details
 * @returns {Object} Client fusionné
 */
function mergeProjectWithDetails(project, homeDetails) {
  return {
    ...project,
    home_details: homeDetails || null,
    // Données aplaties pour accès direct
    address: homeDetails?.address || null,
    postal_code: homeDetails?.postal_code || null,
    city: homeDetails?.city || null,
    phone: homeDetails?.phone || null,
    email: homeDetails?.email || null,
    surface: homeDetails?.surface || null,
    housing_type: homeDetails?.housing_type || null,
    dpe_number: homeDetails?.dpe_number || null,
    dpe_data: homeDetails?.dpe_data || null,
    contract_status: homeDetails?.contract_status || null,
    contract_frequency: homeDetails?.contract_frequency || null,
    contract_start_date: homeDetails?.contract_start_date || null,
    last_maintenance_date: homeDetails?.last_maintenance_date || null,
    next_maintenance_date: homeDetails?.next_maintenance_date || null,
    notes: homeDetails?.notes || null,
  };
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

/**
 * Service de gestion des clients
 */
export const clientsService = {
  // ==========================================================================
  // LECTURE - LISTE
  // ==========================================================================

  /**
   * Récupère la liste des clients avec filtres et pagination
   * 
   * @param {Object} params - Paramètres de recherche
   * @param {string} params.orgId - ID organisation (requis)
   * @param {string} [params.search] - Recherche texte (nom)
   * @param {string} [params.status] - Filtre par statut pipeline
   * @param {string} [params.postalCode] - Filtre par code postal (préfixe)
   * @param {boolean} [params.hasContract] - Filtre clients avec contrat actif
   * @param {string} [params.orderBy='name'] - Colonne de tri
   * @param {boolean} [params.ascending=true] - Ordre croissant
   * @param {number} [params.limit=25] - Nombre de résultats
   * @param {number} [params.offset=0] - Offset pagination
   * @returns {Promise<{data: Array|null, count: number|null, error: Error|null}>}
   * 
   * @example
   * const { data, count, error } = await clientsService.getClients({
   *   orgId: 'xxx',
   *   search: 'Dupont',
   *   postalCode: '40',
   *   limit: 25
   * });
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

      // 1. Récupérer les projets (core.projects)
      let projectQuery = supabase
        .schema('core')
        .from('projects')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .neq('status', 'archived');

      // Filtre statut
      if (status) {
        projectQuery = projectQuery.eq('status', status);
      }

      // Recherche textuelle (nom client)
      if (search && search.trim()) {
        projectQuery = projectQuery.ilike('name', `%${search.trim()}%`);
      }

      // Tri
      projectQuery = projectQuery.order(orderBy, { ascending });

      // Pagination
      projectQuery = projectQuery.range(offset, offset + limit - 1);

      const { data: projects, count, error: projectError } = await projectQuery;

      if (projectError) throw projectError;

      if (!projects || projects.length === 0) {
        return { data: [], count: 0, error: null };
      }

      // 2. Récupérer les home_details pour ces projets
      const projectIds = projects.map(p => p.id);
      
      const { data: homeDetailsList, error: homeError } = await supabase
        .schema('majordhome')
        .from('home_details')
        .select('*')
        .in('project_id', projectIds);

      if (homeError) throw homeError;

      // 3. Créer un map pour accès rapide
      const homeDetailsMap = (homeDetailsList || []).reduce((acc, hd) => {
        acc[hd.project_id] = hd;
        return acc;
      }, {});

      // 4. Fusionner les données
      let mergedData = projects.map(project => 
        mergeProjectWithDetails(project, homeDetailsMap[project.id])
      );

      // 5. Filtrage côté client pour home_details (postal_code, hasContract)
      if (postalCode) {
        mergedData = mergedData.filter(client => 
          client.postal_code?.startsWith(postalCode)
        );
      }

      if (hasContract !== null) {
        mergedData = mergedData.filter(client => {
          const hasActiveContract = client.contract_status === 'active';
          return hasContract ? hasActiveContract : !hasActiveContract;
        });
      }

      return { data: mergedData, count, error: null };
    } catch (error) {
      console.error('clientsService.getClients error:', error);
      return { data: null, count: null, error };
    }
  },

  // ==========================================================================
  // LECTURE - DÉTAIL
  // ==========================================================================

  /**
   * Récupère un client complet avec tous ses détails
   * 
   * @param {string} clientId - ID du projet/client
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   * 
   * @example
   * const { data: client, error } = await clientsService.getClientById('xxx');
   * console.log(client.equipments); // Liste équipements
   */
  async getClientById(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      // 1. Récupérer le projet
      const { data: project, error: projectError } = await supabase
        .schema('core')
        .from('projects')
        .select('*')
        .eq('id', clientId)
        .single();

      if (projectError) throw projectError;

      // 2. Récupérer les home_details
      const { data: homeDetails, error: homeError } = await supabase
        .schema('majordhome')
        .from('home_details')
        .select('*')
        .eq('project_id', clientId)
        .maybeSingle();

      if (homeError) throw homeError;

      // 3. Récupérer les équipements
      const { data: equipments, error: equipmentsError } = await supabase
        .schema('majordhome')
        .from('equipments')
        .select('*')
        .eq('project_id', clientId)
        .order('created_at', { ascending: false });

      if (equipmentsError) throw equipmentsError;

      // 4. Récupérer les dernières interventions (limité à 10)
      const { data: interventions, error: interventionsError } = await supabase
        .schema('majordhome')
        .from('interventions')
        .select('*')
        .eq('project_id', clientId)
        .order('intervention_date', { ascending: false })
        .limit(10);

      if (interventionsError) throw interventionsError;

      // 5. Construire l'objet client complet
      const client = {
        ...mergeProjectWithDetails(project, homeDetails),
        // Relations
        equipments: equipments || [],
        interventions: interventions || [],
        // Méta
        equipments_count: equipments?.length || 0,
        interventions_count: interventions?.length || 0,
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
   * Crée un nouveau client (projet + home_details)
   * 
   * @param {Object} clientData - Données du client
   * @param {string} clientData.orgId - ID organisation
   * @param {string} clientData.name - Nom du client
   * @param {string} [clientData.address] - Adresse
   * @param {string} [clientData.postalCode] - Code postal
   * @param {string} [clientData.city] - Ville
   * @param {string} [clientData.phone] - Téléphone
   * @param {string} [clientData.email] - Email
   * @param {string} [clientData.status='lead'] - Statut pipeline
   * @param {string} [clientData.leadSource] - Source du lead
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   * 
   * @example
   * const { data, error } = await clientsService.createClient({
   *   orgId: 'xxx',
   *   name: 'M. Dupont',
   *   address: '12 rue des Lilas',
   *   postalCode: '40100',
   *   city: 'Dax'
   * });
   */
  async createClient({
    orgId,
    name,
    address = null,
    postalCode = null,
    city = null,
    phone = null,
    email = null,
    status = 'lead',
    leadSource = null,
    surface = null,
    housingType = null,
    notes = null,
  } = {}) {
    try {
      if (!orgId || !name) {
        throw new Error('orgId et name sont requis');
      }

      // Créer le slug à partir du nom
      const slug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // 1. Créer le projet (client)
      const { data: project, error: projectError } = await supabase
        .schema('core')
        .from('projects')
        .insert({
          org_id: orgId,
          name,
          slug: `${slug}-${Date.now()}`,
          status,
          identity: {
            lead_source: leadSource,
            created_from: 'artisan_app',
          },
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // 2. Créer les home_details
      const { data: homeDetails, error: homeError } = await supabase
        .schema('majordhome')
        .from('home_details')
        .insert({
          project_id: project.id,
          org_id: orgId,
          address,
          postal_code: postalCode,
          city,
          phone,
          email,
          surface,
          housing_type: housingType,
          notes,
          contract_status: 'none',
        })
        .select()
        .single();

      if (homeError) {
        // Rollback : supprimer le projet créé
        await supabase
          .schema('core')
          .from('projects')
          .delete()
          .eq('id', project.id);
        throw homeError;
      }

      return {
        data: mergeProjectWithDetails(project, homeDetails),
        error: null,
      };
    } catch (error) {
      console.error('clientsService.createClient error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour un client (projet et/ou home_details)
   * 
   * @param {string} clientId - ID du projet/client
   * @param {Object} updates - Données à mettre à jour
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   * 
   * @example
   * const { data, error } = await clientsService.updateClient('xxx', {
   *   name: 'M. Dupont Jean',
   *   phone: '06 12 34 56 78',
   *   contractStatus: 'active'
   * });
   */
  async updateClient(clientId, updates = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const {
        // Champs projet
        name,
        status,
        identity,
        // Champs home_details
        address,
        postalCode,
        city,
        phone,
        email,
        surface,
        housingType,
        dpeNumber,
        dpeData,
        contractStatus,
        contractFrequency,
        contractStartDate,
        lastMaintenanceDate,
        nextMaintenanceDate,
        notes,
      } = updates;

      // 1. Mettre à jour le projet si nécessaire
      const projectUpdates = {};
      if (name !== undefined) projectUpdates.name = name;
      if (status !== undefined) projectUpdates.status = status;
      if (identity !== undefined) projectUpdates.identity = identity;

      if (Object.keys(projectUpdates).length > 0) {
        projectUpdates.updated_at = new Date().toISOString();
        
        const { error: projectError } = await supabase
          .schema('core')
          .from('projects')
          .update(projectUpdates)
          .eq('id', clientId);

        if (projectError) throw projectError;
      }

      // 2. Mettre à jour home_details si nécessaire
      const homeUpdates = {};
      if (address !== undefined) homeUpdates.address = address;
      if (postalCode !== undefined) homeUpdates.postal_code = postalCode;
      if (city !== undefined) homeUpdates.city = city;
      if (phone !== undefined) homeUpdates.phone = phone;
      if (email !== undefined) homeUpdates.email = email;
      if (surface !== undefined) homeUpdates.surface = surface;
      if (housingType !== undefined) homeUpdates.housing_type = housingType;
      if (dpeNumber !== undefined) homeUpdates.dpe_number = dpeNumber;
      if (dpeData !== undefined) homeUpdates.dpe_data = dpeData;
      if (contractStatus !== undefined) homeUpdates.contract_status = contractStatus;
      if (contractFrequency !== undefined) homeUpdates.contract_frequency = contractFrequency;
      if (contractStartDate !== undefined) homeUpdates.contract_start_date = contractStartDate;
      if (lastMaintenanceDate !== undefined) homeUpdates.last_maintenance_date = lastMaintenanceDate;
      if (nextMaintenanceDate !== undefined) homeUpdates.next_maintenance_date = nextMaintenanceDate;
      if (notes !== undefined) homeUpdates.notes = notes;

      if (Object.keys(homeUpdates).length > 0) {
        homeUpdates.updated_at = new Date().toISOString();
        
        const { error: homeError } = await supabase
          .schema('majordhome')
          .from('home_details')
          .update(homeUpdates)
          .eq('project_id', clientId);

        if (homeError) throw homeError;
      }

      // 3. Récupérer le client mis à jour
      return await this.getClientById(clientId);
    } catch (error) {
      console.error('clientsService.updateClient error:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  /**
   * Archive un client (soft delete via statut)
   * 
   * @param {string} clientId - ID du projet/client
   * @returns {Promise<{success: boolean, error: Error|null}>}
   */
  async archiveClient(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { error } = await supabase
        .schema('core')
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
   * 
   * @param {string} clientId - ID du projet/client
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async getClientEquipments(clientId) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { data, error } = await supabase
        .schema('majordhome')
        .from('equipments')
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
   * Ajoute un équipement à un client
   * 
   * @param {string} clientId - ID du projet/client
   * @param {Object} equipmentData - Données de l'équipement
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async addEquipment(clientId, equipmentData = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      // Récupérer org_id du projet
      const { data: project, error: projectError } = await supabase
        .schema('core')
        .from('projects')
        .select('org_id')
        .eq('id', clientId)
        .single();

      if (projectError) throw projectError;

      const { data, error } = await supabase
        .schema('majordhome')
        .from('equipments')
        .insert({
          project_id: clientId,
          org_id: project.org_id,
          equipment_type: equipmentData.type,
          brand: equipmentData.brand,
          model: equipmentData.model,
          serial_number: equipmentData.serialNumber,
          installation_date: equipmentData.installationDate,
          warranty_end_date: equipmentData.warrantyEndDate,
          contract_status: equipmentData.contractStatus || 'none',
          contract_frequency: equipmentData.contractFrequency,
          last_maintenance_date: equipmentData.lastMaintenanceDate,
          next_maintenance_date: equipmentData.nextMaintenanceDate,
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
   * 
   * @param {string} equipmentId - ID de l'équipement
   * @param {Object} updates - Données à mettre à jour
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async updateEquipment(equipmentId, updates = {}) {
    try {
      if (!equipmentId) {
        throw new Error('equipmentId est requis');
      }

      const updateData = {
        updated_at: new Date().toISOString(),
      };

      if (updates.type !== undefined) updateData.equipment_type = updates.type;
      if (updates.brand !== undefined) updateData.brand = updates.brand;
      if (updates.model !== undefined) updateData.model = updates.model;
      if (updates.serialNumber !== undefined) updateData.serial_number = updates.serialNumber;
      if (updates.installationDate !== undefined) updateData.installation_date = updates.installationDate;
      if (updates.warrantyEndDate !== undefined) updateData.warranty_end_date = updates.warrantyEndDate;
      if (updates.contractStatus !== undefined) updateData.contract_status = updates.contractStatus;
      if (updates.contractFrequency !== undefined) updateData.contract_frequency = updates.contractFrequency;
      if (updates.lastMaintenanceDate !== undefined) updateData.last_maintenance_date = updates.lastMaintenanceDate;
      if (updates.nextMaintenanceDate !== undefined) updateData.next_maintenance_date = updates.nextMaintenanceDate;
      if (updates.notes !== undefined) updateData.notes = updates.notes;

      const { data, error } = await supabase
        .schema('majordhome')
        .from('equipments')
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
   * 
   * @param {string} equipmentId - ID de l'équipement
   * @returns {Promise<{success: boolean, error: Error|null}>}
   */
  async deleteEquipment(equipmentId) {
    try {
      if (!equipmentId) {
        throw new Error('equipmentId est requis');
      }

      const { error } = await supabase
        .schema('majordhome')
        .from('equipments')
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
   * 
   * @param {string} clientId - ID du projet/client
   * @param {Object} options - Options
   * @param {number} [options.limit=20] - Limite
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async getClientInterventions(clientId, { limit = 20 } = {}) {
    try {
      if (!clientId) {
        throw new Error('clientId est requis');
      }

      const { data, error } = await supabase
        .schema('majordhome')
        .from('interventions')
        .select('*')
        .eq('project_id', clientId)
        .order('intervention_date', { ascending: false })
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
   * Récupère les statistiques clients d'une organisation
   * 
   * @param {string} orgId - ID organisation
   * @returns {Promise<{data: Object|null, error: Error|null}>}
   */
  async getClientStats(orgId) {
    try {
      if (!orgId) {
        throw new Error('orgId est requis');
      }

      // Total clients (non archivés)
      const { count: totalClients, error: totalError } = await supabase
        .schema('core')
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .neq('status', 'archived');

      if (totalError) throw totalError;

      // Clients avec contrat actif
      const { count: activeContracts, error: contractError } = await supabase
        .schema('majordhome')
        .from('home_details')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('contract_status', 'active');

      if (contractError) throw contractError;

      // Clients par statut pipeline
      const { data: statusData, error: statusError } = await supabase
        .schema('core')
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
  // RECHERCHE RAPIDE
  // ==========================================================================

  /**
   * Recherche rapide de clients (pour autocomplete)
   * 
   * @param {string} orgId - ID organisation
   * @param {string} query - Terme de recherche
   * @param {number} [limit=10] - Limite de résultats
   * @returns {Promise<{data: Array|null, error: Error|null}>}
   */
  async searchClients(orgId, query, limit = 10) {
    try {
      if (!orgId || !query || query.length < 2) {
        return { data: [], error: null };
      }

      // 1. Rechercher les projets par nom
      const { data: projects, error: projectError } = await supabase
        .schema('core')
        .from('projects')
        .select('id, name')
        .eq('org_id', orgId)
        .neq('status', 'archived')
        .ilike('name', `%${query}%`)
        .limit(limit);

      if (projectError) throw projectError;

      if (!projects || projects.length === 0) {
        return { data: [], error: null };
      }

      // 2. Récupérer les home_details
      const projectIds = projects.map(p => p.id);
      
      const { data: homeDetailsList, error: homeError } = await supabase
        .schema('majordhome')
        .from('home_details')
        .select('project_id, address, postal_code, city')
        .in('project_id', projectIds);

      if (homeError) throw homeError;

      // 3. Créer un map
      const homeDetailsMap = (homeDetailsList || []).reduce((acc, hd) => {
        acc[hd.project_id] = hd;
        return acc;
      }, {});

      // 4. Transformer pour un affichage simple
      const results = projects.map(project => {
        const hd = homeDetailsMap[project.id];
        return {
          id: project.id,
          name: project.name,
          address: hd?.address || null,
          city: hd?.city || null,
          postal_code: hd?.postal_code || null,
          display: `${project.name}${hd?.city ? ` - ${hd.city}` : ''}`,
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
