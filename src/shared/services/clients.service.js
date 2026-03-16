/**
 * clients.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des clients.
 *
 * Utilise la table majordhome.clients (colonnes typées) via la vue publique
 * majordhome_clients. Les équipements et interventions restent liés via
 * project_id (FK vers core.projects).
 *
 * @version 5.0.0 - Refonte complète : table clients dédiée
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { cleanPhone, formatPhoneForSearch } from '@/lib/phoneUtils';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Catégories de clients (ENUM majordhome.client_category)
 */
export const CLIENT_CATEGORIES = [
  { value: 'particulier', label: 'Particulier', color: 'bg-blue-100 text-blue-700' },
  { value: 'entreprise', label: 'Entreprise', color: 'bg-purple-100 text-purple-700' },
];

/**
 * Types d'équipements — legacy (catégories simplifiées, utilisées par import Excel)
 */
export const EQUIPMENT_TYPES = [
  { value: 'heating', label: 'Chauffage' },
  { value: 'cooling', label: 'Climatisation' },
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'water_heating', label: 'Eau chaude' },
  { value: 'renewable_energy', label: 'Énergie renouvelable' },
  { value: 'other', label: 'Autre' },
];

/**
 * Catégories d'équipements (ENUM majordhome.equipment_category — valeurs DB)
 * Utilisées dans le formulaire d'ajout et les contrats d'entretien
 */
export const EQUIPMENT_CATEGORIES = [
  { value: 'pac_air_air', label: 'PAC Air-Air' },
  { value: 'pac_air_eau', label: 'PAC Air-Eau' },
  { value: 'chaudiere_gaz', label: 'Chaudière Gaz' },
  { value: 'chaudiere_fioul', label: 'Chaudière Fioul' },
  { value: 'chaudiere_bois', label: 'Chaudière Bois' },
  { value: 'vmc', label: 'VMC' },
  { value: 'climatisation', label: 'Climatisation' },
  { value: 'chauffe_eau_thermo', label: 'Chauffe-eau Thermodynamique' },
  { value: 'ballon_ecs', label: 'Ballon ECS' },
  { value: 'poele', label: 'Poêle' },
  { value: 'autre', label: 'Autre' },
];

/**
 * Types de logement (ENUM majordhome.housing_type)
 */
export const HOUSING_TYPES = [
  { value: 'maison', label: 'Maison' },
  { value: 'appartement', label: 'Appartement' },
  { value: 'local_commercial', label: 'Local commercial' },
  { value: 'immeuble', label: 'Immeuble' },
  { value: 'autre', label: 'Autre' },
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
  { value: 'facebook', label: 'Facebook Ads' },
  { value: 'google', label: 'Fiche Google' },
  { value: 'existing', label: 'Client existant' },
  { value: 'other', label: 'Autre' },
];

const DEFAULT_LIMIT = 25;

// ============================================================================
// HELPERS — Phone utilities imported from @/lib/phoneUtils
// ============================================================================

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const clientsService = {
  // ==========================================================================
  // LECTURE - LISTE
  // ==========================================================================

  /**
   * Récupère la liste des clients avec filtres, recherche et pagination
   * Utilise la vue publique majordhome_clients
   */
  async getClients({
    orgId,
    search = '',
    clientCategory = null,
    postalCode = null,
    city = null,
    hasContract = null,
    equipmentCategory = null,
    showArchived = false,
    onlyArchived = false,
    orderBy = 'display_name',
    ascending = true,
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = {}) {
    try {
      if (!orgId) throw new Error('[clientsService] orgId est requis');

      let query = supabase
        .from('majordhome_clients')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId);

      // Filtre archivage
      if (onlyArchived) {
        query = query.eq('is_archived', true);
      } else if (!showArchived) {
        query = query.eq('is_archived', false);
      }

      // Recherche full-text (nom, email, téléphone, ville)
      if (search && search.trim().length >= 2) {
        const term = search.trim();
        // Si le terme ressemble à un numéro de téléphone, ajouter la version formatée avec espaces
        const phoneSpaced = formatPhoneForSearch(term);
        const conditions = [
          `display_name.ilike.%${term}%`,
          `email.ilike.%${term}%`,
          `phone.ilike.%${term}%`,
          `city.ilike.%${term}%`,
          `postal_code.ilike.%${term}%`,
        ];
        if (phoneSpaced && phoneSpaced !== term) {
          conditions.push(`phone.ilike.%${phoneSpaced}%`);
        }
        query = query.or(conditions.join(','));
      }

      // Filtre catégorie client
      if (clientCategory) {
        query = query.eq('client_category', clientCategory);
      }

      // Filtre contrat actif (colonne calculée dans la vue)
      if (hasContract === true) {
        query = query.eq('has_active_contract', true);
      } else if (hasContract === false) {
        query = query.eq('has_active_contract', false);
      }

      // Filtre code postal (préfixe)
      if (postalCode) {
        query = query.ilike('postal_code', `${postalCode}%`);
      }

      // Filtre ville
      if (city) {
        query = query.ilike('city', `%${city}%`);
      }

      // Tri
      query = query.order(orderBy, { ascending });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;
      if (error) throw error;

      // Si filtre équipement demandé, on filtre côté client (post-query)
      // TODO: optimiser avec une sous-requête ou une vue quand nécessaire
      let clients = data || [];

      if (equipmentCategory && clients.length > 0) {
        const projectIds = clients.map(c => c.project_id);
        const { data: equipments } = await supabase
          .from('majordhome_equipments')
          .select('project_id')
          .in('project_id', projectIds)
          .eq('category', equipmentCategory);

        if (equipments) {
          const matchingProjectIds = new Set(equipments.map(e => e.project_id));
          clients = clients.filter(c => matchingProjectIds.has(c.project_id));
        }
      }

      return { data: clients, count, error: null };
    } catch (error) {
      console.error('[clientsService] getClients:', error);
      return { data: null, count: null, error };
    }
  },

  // ==========================================================================
  // LECTURE - DÉTAIL
  // ==========================================================================

  /**
   * Récupère un client complet avec équipements, interventions et activités
   * @param {string} clientId - UUID du client (majordhome.clients.id)
   */
  async getClientById(clientId) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Requêtes en parallèle
      const [clientResult, equipResult, interResult, activitiesResult] = await Promise.all([
        // 1. Client
        supabase
          .from('majordhome_clients')
          .select('*')
          .eq('id', clientId)
          .single(),

        // 2. Équipements (via project_id)
        supabase
          .from('majordhome_clients')
          .select('project_id')
          .eq('id', clientId)
          .single()
          .then(({ data }) => {
            if (!data?.project_id) return { data: [], error: null };
            return supabase
              .from('majordhome_equipments')
              .select('*')
              .eq('project_id', data.project_id)
              .order('created_at', { ascending: false });
          }),

        // 3. Interventions (via project_id)
        supabase
          .from('majordhome_clients')
          .select('project_id')
          .eq('id', clientId)
          .single()
          .then(({ data }) => {
            if (!data?.project_id) return { data: [], error: null };
            return supabase
              .from('majordhome_interventions')
              .select('*')
              .eq('project_id', data.project_id)
              .order('scheduled_date', { ascending: false })
              .limit(50);
          }),

        // 4. Activités (timeline)
        supabase
          .from('majordhome_client_activities')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (clientResult.error) throw clientResult.error;

      const client = {
        ...clientResult.data,
        equipments: equipResult.data || [],
        interventions: interResult.data || [],
        activities: activitiesResult.data || [],
        equipments_count: equipResult.data?.length || 0,
        interventions_count: interResult.data?.length || 0,
        active_contracts: (equipResult.data || []).filter(e => e.contract_status === 'active').length,
      };

      return { data: client, error: null };
    } catch (error) {
      console.error('[clientsService] getClientById:', error);
      return { data: null, error };
    }
  },

  /**
   * Récupère un client par son project_id (pour compatibilité)
   */
  async getClientByProjectId(projectId) {
    try {
      if (!projectId) throw new Error('[clientsService] projectId est requis');

      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] getClientByProjectId:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  /**
   * Crée un nouveau client
   * Crée d'abord le project dans core.projects puis le client dans majordhome.clients
   */
  async createClient({
    orgId,
    firstName = null,
    lastName = null,
    displayName = null,
    companyName = null,
    email = null,
    phone = null,
    phoneSecondary = null,
    address = null,
    addressComplement = null,
    postalCode = null,
    city = null,
    housingType = null,
    surface = null,
    dpeNumber = null,
    clientCategory = 'particulier',
    leadSource = null,
    notes = null,
    createdBy = null,
  } = {}) {
    try {
      if (!orgId) throw new Error('[clientsService] orgId est requis');

      // Construire le nom affiché (forcer majuscules)
      const upperFirst = firstName ? firstName.toUpperCase() : '';
      const upperLast = lastName ? lastName.toUpperCase() : '';
      const name = displayName ? displayName.toUpperCase() : `${upperLast} ${upperFirst}`.trim();
      if (!name) throw new Error('[clientsService] displayName ou lastName est requis');

      // 1. Créer le project dans core.projects (pour les FK existantes)
      const slug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          org_id: orgId,
          name: name,
          slug: `${slug}-${Date.now()}`,
          status: 'active',
          identity: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone: cleanPhone(phone),
            address,
            postal_code: postalCode,
            city,
            client_category: clientCategory,
            created_from: 'artisan_app_v5',
          },
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // 2. Créer le client dans majordhome.clients (via vue publique)
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .insert({
          project_id: project.id,
          org_id: orgId,
          first_name: upperFirst || null,
          last_name: upperLast || null,
          display_name: name,
          company_name: companyName,
          email,
          phone: cleanPhone(phone),
          phone_secondary: cleanPhone(phoneSecondary),
          address,
          address_complement: addressComplement,
          postal_code: postalCode,
          city,
          housing_type: housingType,
          surface: surface ? parseFloat(surface) : null,
          dpe_number: dpeNumber,
          client_category: clientCategory,
          lead_source: leadSource,
          notes,
          created_by: createdBy,
        })
        .select()
        .single();

      if (clientError) throw clientError;

      // 3. Créer l'activité de création
      await supabase
        .from('majordhome_client_activities')
        .insert({
          client_id: client.id,
          org_id: orgId,
          activity_type: 'client_created',
          title: 'Client créé',
          description: `Fiche client créée depuis l'application`,
          is_system: true,
          created_by: createdBy,
        });

      return { data: client, error: null };
    } catch (error) {
      console.error('[clientsService] createClient:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour un client
   * Synchronise également core.projects.identity pour compatibilité
   */
  async updateClient(clientId, updates = {}) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Construire les données de mise à jour
      const updateData = {};

      // Identité (forcer majuscules sur nom/prénom)
      if (updates.firstName !== undefined) updateData.first_name = updates.firstName ? updates.firstName.toUpperCase() : null;
      if (updates.lastName !== undefined) updateData.last_name = updates.lastName ? updates.lastName.toUpperCase() : null;
      if (updates.displayName !== undefined) updateData.display_name = updates.displayName ? updates.displayName.toUpperCase() : null;
      if (updates.companyName !== undefined) updateData.company_name = updates.companyName || null;

      // Reconstruire display_name si nom/prénom changé
      if ((updates.firstName !== undefined || updates.lastName !== undefined) && !updates.displayName) {
        const currentFirst = updates.firstName !== undefined ? updates.firstName : null;
        const currentLast = updates.lastName !== undefined ? updates.lastName : null;

        if (currentFirst !== null || currentLast !== null) {
          if (currentFirst === null || currentLast === null) {
            const { data: current } = await supabase
              .from('majordhome_clients')
              .select('first_name, last_name')
              .eq('id', clientId)
              .single();

            const first = updates.firstName !== undefined ? updates.firstName : current?.first_name || '';
            const last = updates.lastName !== undefined ? updates.lastName : current?.last_name || '';
            updateData.display_name = `${last} ${first}`.trim().toUpperCase();
          } else {
            updateData.display_name = `${currentLast} ${currentFirst}`.trim().toUpperCase();
          }
        }
      }

      // Contact
      if (updates.email !== undefined) updateData.email = updates.email || null;
      if (updates.phone !== undefined) updateData.phone = cleanPhone(updates.phone);
      if (updates.phoneSecondary !== undefined) updateData.phone_secondary = cleanPhone(updates.phoneSecondary);

      // Adresse
      if (updates.address !== undefined) updateData.address = updates.address || null;
      if (updates.addressComplement !== undefined) updateData.address_complement = updates.addressComplement || null;
      if (updates.postalCode !== undefined) updateData.postal_code = updates.postalCode || null;
      if (updates.city !== undefined) updateData.city = updates.city || null;

      // Logement
      if (updates.housingType !== undefined) updateData.housing_type = updates.housingType || null;
      if (updates.surface !== undefined) updateData.surface = updates.surface ? parseFloat(updates.surface) : null;
      if (updates.dpeNumber !== undefined) updateData.dpe_number = updates.dpeNumber || null;
      if (updates.dpeRating !== undefined) updateData.dpe_rating = updates.dpeRating || null;
      if (updates.accessInstructions !== undefined) updateData.access_instructions = updates.accessInstructions || null;
      if (updates.constructionYear !== undefined) updateData.construction_year = updates.constructionYear || null;
      if (updates.floorCount !== undefined) updateData.floor_count = updates.floorCount || null;

      // Classification
      if (updates.clientCategory !== undefined) updateData.client_category = updates.clientCategory;
      if (updates.leadSource !== undefined) updateData.lead_source = updates.leadSource || null;
      if (updates.tags !== undefined) updateData.tags = updates.tags || [];

      // Notes
      if (updates.notes !== undefined) updateData.notes = updates.notes || null;
      if (updates.internalNotes !== undefined) updateData.internal_notes = updates.internalNotes || null;

      // Archivage
      if (updates.isArchived !== undefined) {
        updateData.is_archived = updates.isArchived;
        updateData.archived_at = updates.isArchived ? new Date().toISOString() : null;
      }

      // Mise à jour dans majordhome.clients (via vue publique)
      const { data, error } = await supabase
        .from('majordhome_clients')
        .update(updateData)
        .eq('id', clientId)
        .select()
        .single();

      if (error) throw error;

      // Synchroniser core.projects.identity pour compatibilité
      if (data?.project_id) {
        const identitySync = {};
        if (updateData.first_name !== undefined) identitySync.first_name = updateData.first_name;
        if (updateData.last_name !== undefined) identitySync.last_name = updateData.last_name;
        if (updateData.email !== undefined) identitySync.email = updateData.email;
        if (updateData.phone !== undefined) identitySync.phone = updateData.phone;
        if (updateData.address !== undefined) identitySync.address = updateData.address;
        if (updateData.postal_code !== undefined) identitySync.postal_code = updateData.postal_code;
        if (updateData.city !== undefined) identitySync.city = updateData.city;
        if (updateData.client_category !== undefined) identitySync.client_category = updateData.client_category;

        if (Object.keys(identitySync).length > 0) {
          const { data: current } = await supabase
            .from('projects')
            .select('identity')
            .eq('id', data.project_id)
            .single();

          await supabase
            .from('projects')
            .update({
              name: updateData.display_name || data.display_name,
              identity: { ...(current?.identity || {}), ...identitySync },
              updated_at: new Date().toISOString(),
            })
            .eq('id', data.project_id);
        }
      }

      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] updateClient:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // ARCHIVAGE
  // ==========================================================================

  /**
   * Archive un client (soft delete)
   */
  async archiveClient(clientId) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { error } = await supabase
        .from('majordhome_clients')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
        })
        .eq('id', clientId);

      if (error) throw error;
      return { success: true, error: null };
    } catch (error) {
      console.error('[clientsService] archiveClient:', error);
      return { success: false, error };
    }
  },

  /**
   * Désarchive un client
   */
  async unarchiveClient(clientId) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { error } = await supabase
        .from('majordhome_clients')
        .update({
          is_archived: false,
          archived_at: null,
        })
        .eq('id', clientId);

      if (error) throw error;
      return { success: true, error: null };
    } catch (error) {
      console.error('[clientsService] unarchiveClient:', error);
      return { success: false, error };
    }
  },

  // ==========================================================================
  // ÉQUIPEMENTS
  // ==========================================================================

  /**
   * Récupère les équipements d'un client via son project_id
   */
  async getClientEquipments(clientId) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Récupérer le project_id
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('project_id', client.project_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] getClientEquipments:', error);
      return { data: null, error };
    }
  },

  /**
   * Ajoute un équipement à un client
   */
  async addEquipment(clientId, equipmentData = {}) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Récupérer le project_id
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id, org_id')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .insert({
          project_id: client.project_id,
          category: equipmentData.category,
          equipment_type_id: equipmentData.equipmentTypeId || null,
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
          installation_year: equipmentData.installationYear ? parseInt(equipmentData.installationYear) : null,
          notes: equipmentData.notes,
        })
        .select()
        .single();

      if (error) throw error;

      // Ajouter activité timeline
      await supabase
        .from('majordhome_client_activities')
        .insert({
          client_id: clientId,
          org_id: client.org_id,
          activity_type: 'equipment_added',
          title: 'Équipement ajouté',
          description: `${equipmentData.brand || ''} ${equipmentData.model || ''} (${equipmentData.category || ''})`.trim(),
          reference_type: 'equipment',
          reference_id: data.id,
          is_system: true,
        });

      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] addEquipment:', error);
      return { data: null, error };
    }
  },

  /**
   * Met à jour un équipement
   */
  async updateEquipment(equipmentId, updates = {}) {
    try {
      if (!equipmentId) throw new Error('[clientsService] equipmentId est requis');

      const updateData = {};
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.equipmentTypeId !== undefined) updateData.equipment_type_id = updates.equipmentTypeId || null;
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
      if (updates.installationYear !== undefined) updateData.installation_year = updates.installationYear ? parseInt(updates.installationYear) : null;
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.status !== undefined) updateData.status = updates.status;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .update(updateData)
        .eq('id', equipmentId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] updateEquipment:', error);
      return { data: null, error };
    }
  },

  /**
   * Supprime un équipement
   */
  async deleteEquipment(equipmentId) {
    try {
      if (!equipmentId) throw new Error('[clientsService] equipmentId est requis');

      const { error } = await supabase
        .from('majordhome_equipments')
        .delete()
        .eq('id', equipmentId);

      if (error) throw error;
      return { success: true, error: null };
    } catch (error) {
      console.error('[clientsService] deleteEquipment:', error);
      return { success: false, error };
    }
  },

  // ==========================================================================
  // INTERVENTIONS
  // ==========================================================================

  /**
   * Récupère les interventions d'un client
   */
  async getClientInterventions(clientId, { limit = 50 } = {}) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('project_id', client.project_id)
        .order('scheduled_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] getClientInterventions:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // ACTIVITÉS (TIMELINE)
  // ==========================================================================

  /**
   * Récupère les activités d'un client (timeline)
   */
  async getClientActivities(clientId, { limit = 50 } = {}) {
    try {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { data, error } = await supabase
        .from('majordhome_client_activities')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] getClientActivities:', error);
      return { data: null, error };
    }
  },

  /**
   * Ajoute une note/commentaire à la timeline
   */
  async addClientNote({
    clientId,
    orgId,
    title,
    description = null,
    activityType = 'note',
    isPinned = false,
    createdBy = null,
  } = {}) {
    try {
      if (!clientId || !orgId) throw new Error('[clientsService] clientId et orgId requis');
      if (!title) throw new Error('[clientsService] title est requis');

      const { data, error } = await supabase
        .from('majordhome_client_activities')
        .insert({
          client_id: clientId,
          org_id: orgId,
          activity_type: activityType,
          title,
          description,
          is_system: false,
          is_pinned: isPinned,
          created_by: createdBy,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[clientsService] addClientNote:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // STATISTIQUES
  // ==========================================================================

  /**
   * Récupère les statistiques clients
   */
  async getClientStats(orgId) {
    try {
      if (!orgId) throw new Error('[clientsService] orgId est requis');

      // Requêtes count en parallèle (pas de limit, juste les comptages)
      const [totalResult, contractResult, particulierResult, entrepriseResult, archivedResult] = await Promise.all([
        // Total clients non archivés
        supabase
          .from('majordhome_clients')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('is_archived', false),

        // Contrats actifs
        supabase
          .from('majordhome_clients')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('is_archived', false)
          .eq('has_active_contract', true),

        // Particuliers
        supabase
          .from('majordhome_clients')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('is_archived', false)
          .eq('client_category', 'particulier'),

        // Entreprises
        supabase
          .from('majordhome_clients')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('is_archived', false)
          .eq('client_category', 'entreprise'),

        // Archivés
        supabase
          .from('majordhome_clients')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('is_archived', true),
      ]);

      if (totalResult.error) throw totalResult.error;

      return {
        data: {
          total_clients: totalResult.count || 0,
          active_contracts: contractResult.count || 0,
          particuliers: particulierResult.count || 0,
          entreprises: entrepriseResult.count || 0,
          archived: archivedResult.count || 0,
        },
        error: null,
      };
    } catch (error) {
      console.error('[clientsService] getClientStats:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // MARQUES D'ÉQUIPEMENTS
  // ==========================================================================

  /**
   * Récupère les marques d'équipements actives
   * @returns {Promise<{data: Array, error: Error|null}>}
   */
  async getBrands() {
    try {
      const { data, error } = await supabase
        .from('majordhome_equipment_brands')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[clientsService] getBrands:', error);
      return { data: [], error };
    }
  },

  /**
   * Récupère les types d'équipements pricing (grille tarifaire)
   * Utilisé dans le formulaire d'ajout d'équipement pour le dropdown "Type"
   * @returns {Promise<{data: Array, error: Error|null}>}
   */
  async getPricingEquipmentTypes() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[clientsService] getPricingEquipmentTypes:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // RECHERCHE RAPIDE
  // ==========================================================================

  /**
   * Détection de doublons par nom + code postal
   * Utilisé lors de la création d'un nouveau client pour éviter les doublons
   * @param {string} orgId - UUID de l'organisation
   * @param {string} lastName - Nom de famille à chercher (case-insensitive)
   * @param {string} [postalCode] - Code postal (optionnel, affine la recherche)
   * @returns {{ data: Array, error: null|Error }}
   */
  async checkDuplicates(orgId, lastName, postalCode) {
    try {
      if (!orgId || !lastName || lastName.trim().length < 2) {
        return { data: [], error: null };
      }

      console.log('[clientsService] checkDuplicates', { orgId, lastName, postalCode });

      let query = supabase
        .from('majordhome_clients')
        .select('id, display_name, first_name, last_name, email, phone, postal_code, city, has_active_contract, client_number')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .ilike('last_name', lastName.trim());

      if (postalCode && postalCode.trim().length >= 2) {
        query = query.eq('postal_code', postalCode.trim());
      }

      const { data, error } = await query.limit(5);

      if (error) {
        console.error('[clientsService] checkDuplicates error:', error);
        return { data: [], error };
      }

      return { data: data || [], error: null };
    } catch (error) {
      console.error('[clientsService] checkDuplicates exception:', error);
      return { data: [], error };
    }
  },

  /**
   * Recherche rapide pour autocomplete
   */
  async searchClients(orgId, query, limit = 10) {
    try {
      if (!orgId || !query || query.length < 2) {
        return { data: [], error: null };
      }

      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('id, project_id, display_name, email, phone, city, postal_code, client_number, client_category, has_active_contract')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .or((() => {
          const conditions = [
            `display_name.ilike.%${query}%`,
            `email.ilike.%${query}%`,
            `phone.ilike.%${query}%`,
            `city.ilike.%${query}%`,
          ];
          const phoneSpaced = formatPhoneForSearch(query);
          if (phoneSpaced && phoneSpaced !== query) {
            conditions.push(`phone.ilike.%${phoneSpaced}%`);
          }
          return conditions.join(',');
        })())
        .limit(limit);

      if (error) throw error;

      const results = (data || []).map(c => ({
        ...c,
        display: `${c.display_name}${c.city ? ` - ${c.city}` : ''}`,
      }));

      return { data: results, error: null };
    } catch (error) {
      console.error('[clientsService] searchClients:', error);
      return { data: null, error };
    }
  },
};

export default clientsService;
