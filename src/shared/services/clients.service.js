/**
 * clients.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des clients.
 *
 * Utilise la table majordhome.clients (colonnes typées) via la vue publique
 * majordhome_clients. Les équipements et interventions restent liés via
 * project_id (FK vers core.projects).
 *
 * @version 6.0.0 - withErrorHandling + extraction equipments.service
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, withErrorHandlingCount } from '@/lib/serviceHelpers';
import { cleanPhone, formatPhoneForSearch } from '@/lib/phoneUtils';
import { equipmentsService } from '@services/equipments.service';

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
  { value: 'appointment_legacy', label: 'Rdv ancien' },
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
    return withErrorHandlingCount(async () => {
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

      return { data: clients, count };
    }, 'clients.getClients');
  },

  // ==========================================================================
  // LECTURE - DÉTAIL
  // ==========================================================================

  /**
   * Récupère un client complet avec équipements, interventions et activités
   * @param {string} clientId - UUID du client (majordhome.clients.id)
   */
  async getClientById(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Requêtes en parallèle
      const [clientResult, equipResult, interResult, activitiesResult] = await Promise.all([
        // 1. Client (majordhome_clients_all inclut les drafts web)
        supabase
          .from('majordhome_clients_all')
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

      return {
        ...clientResult.data,
        equipments: equipResult.data || [],
        interventions: interResult.data || [],
        activities: activitiesResult.data || [],
        equipments_count: equipResult.data?.length || 0,
        interventions_count: (interResult.data || []).filter(i => !i.parent_id).length,
        active_contracts: (equipResult.data || []).filter(e => e.contract_status === 'active').length,
      };
    }, 'clients.getClientById');
  },

  /**
   * Récupère un client par son project_id (pour compatibilité)
   */
  async getClientByProjectId(projectId) {
    return withErrorHandling(async () => {
      if (!projectId) throw new Error('[clientsService] projectId est requis');

      const { data, error } = await supabase
        .from('majordhome_clients')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (error) throw error;
      return data;
    }, 'clients.getClientByProjectId');
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
    isWebDraft = false,
  } = {}) {
    return withErrorHandling(async () => {
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
        .replace(/[\u0300-\u036f]/g, '')
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

      // 2. Créer le client dans majordhome.clients (via vue _all pour supporter is_web_draft)
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients_all')
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
          is_web_draft: isWebDraft,
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

      return client;
    }, 'clients.createClient');
  },

  /**
   * Confirme un client web draft (is_web_draft → false)
   * Appelé lors de la complétion de fiche ou planification d'entretien
   */
  async confirmWebDraft(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[clientsService] clientId requis');

      const { error } = await supabase
        .from('majordhome_clients_all')
        .update({ is_web_draft: false })
        .eq('id', clientId);

      if (error) throw error;
      return true;
    }, 'clients.confirmWebDraft');
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour un client
   * Synchronise également core.projects.identity pour compatibilité
   */
  async updateClient(clientId, updates = {}) {
    return withErrorHandling(async () => {
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
              .from('majordhome_clients_all')
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
      if (updates.mailOptin !== undefined) updateData.mail_optin = updates.mailOptin;
      if (updates.smsOptin !== undefined) updateData.sms_optin = updates.smsOptin;

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

      // Toute modification confirme automatiquement un draft web
      updateData.is_web_draft = false;

      // Mise à jour dans majordhome.clients (via vue _all pour inclure les drafts)
      const { data, error } = await supabase
        .from('majordhome_clients_all')
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

      return data;
    }, 'clients.updateClient');
  },

  // ==========================================================================
  // ARCHIVAGE
  // ==========================================================================

  /**
   * Archive un client (soft delete)
   */
  async archiveClient(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      // Clore automatiquement le contrat actif s'il existe
      const { data: activeContract } = await supabase
        .from('majordhome_contracts')
        .select('id, status')
        .eq('client_id', clientId)
        .in('status', ['active', 'pending'])
        .maybeSingle();

      if (activeContract) {
        await supabase
          .from('majordhome_contracts_write')
          .update({
            status: 'cancelled',
            cancellation_reason: 'archivage_client',
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeContract.id);
      }

      const { error } = await supabase
        .from('majordhome_clients')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
        })
        .eq('id', clientId);

      if (error) throw error;
      return true;
    }, 'clients.archiveClient');
  },

  /**
   * Désarchive un client
   */
  async unarchiveClient(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { error } = await supabase
        .from('majordhome_clients')
        .update({
          is_archived: false,
          archived_at: null,
        })
        .eq('id', clientId);

      if (error) throw error;
      return true;
    }, 'clients.unarchiveClient');
  },

  // ==========================================================================
  // ÉQUIPEMENTS (délégués à equipmentsService — rétrocompatibilité)
  // ==========================================================================

  getClientEquipments: (...args) => equipmentsService.getClientEquipments(...args),
  addEquipment: (...args) => equipmentsService.addEquipment(...args),
  updateEquipment: (...args) => equipmentsService.updateEquipment(...args),
  deleteEquipment: (...args) => equipmentsService.deleteEquipment(...args),

  // ==========================================================================
  // INTERVENTIONS
  // ==========================================================================

  /**
   * Récupère les interventions d'un client
   */
  async getClientInterventions(clientId, { limit = 50 } = {}) {
    return withErrorHandling(async () => {
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
      return data;
    }, 'clients.getClientInterventions');
  },

  // ==========================================================================
  // ACTIVITÉS (TIMELINE)
  // ==========================================================================

  /**
   * Récupère les activités d'un client (timeline)
   */
  async getClientActivities(clientId, { limit = 50 } = {}) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[clientsService] clientId est requis');

      const { data, error } = await supabase
        .from('majordhome_client_activities')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    }, 'clients.getClientActivities');
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
    return withErrorHandling(async () => {
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
      return data;
    }, 'clients.addClientNote');
  },

  // ==========================================================================
  // STATISTIQUES
  // ==========================================================================

  /**
   * Récupère les statistiques clients
   */
  async getClientStats(orgId) {
    return withErrorHandling(async () => {
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
        total_clients: totalResult.count || 0,
        active_contracts: contractResult.count || 0,
        particuliers: particulierResult.count || 0,
        entreprises: entrepriseResult.count || 0,
        archived: archivedResult.count || 0,
      };
    }, 'clients.getClientStats');
  },

  // ==========================================================================
  // MARQUES D'ÉQUIPEMENTS
  // ==========================================================================

  /**
   * Récupère les marques d'équipements actives
   * @returns {Promise<{data: Array, error: Error|null}>}
   */
  async getBrands() {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_equipment_brands')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      return data || [];
    }, 'clients.getBrands');
  },

  /**
   * Récupère les types d'équipements pricing (grille tarifaire)
   * Utilisé dans le formulaire d'ajout d'équipement pour le dropdown "Type"
   * @returns {Promise<{data: Array, error: Error|null}>}
   */
  async getPricingEquipmentTypes() {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return data || [];
    }, 'clients.getPricingEquipmentTypes');
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
    return withErrorHandling(async () => {
      if (!orgId || !lastName || lastName.trim().length < 2) {
        return [];
      }

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

      if (error) throw error;
      return data || [];
    }, 'clients.checkDuplicates');
  },

  // ==========================================================================
  // CLIENTS LIÉS (Propriétaire / Locataire)
  // ==========================================================================

  /**
   * Récupère les clients liés (propriétaire et/ou locataires)
   * @returns {{ owner: object|null, tenants: object[] }}
   */
  async getLinkedClients(clientId, orgId) {
    return withErrorHandling(async () => {
      if (!clientId || !orgId) return { owner: null, tenants: [] };

      const selectCols = 'id, display_name, city, postal_code, phone, email, client_number, client_category, has_active_contract, address';

      // 1. Récupérer owner_client_id du client courant
      const { data: self } = await supabase
        .from('majordhome_clients_all')
        .select('owner_client_id')
        .eq('id', clientId)
        .single();

      // 2. En parallèle : propriétaire (si locataire) + locataires (si propriétaire)
      const [ownerResult, tenantsResult] = await Promise.all([
        self?.owner_client_id
          ? supabase.from('majordhome_clients').select(selectCols).eq('id', self.owner_client_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('majordhome_clients').select(selectCols).eq('org_id', orgId).eq('owner_client_id', clientId),
      ]);

      return {
        owner: ownerResult.data || null,
        tenants: tenantsResult.data || [],
      };
    }, 'clients.getLinkedClients');
  },

  /**
   * Lie un client comme locataire d'un propriétaire
   * @param {string} tenantClientId - Le client locataire
   * @param {string} ownerClientId - Le client propriétaire
   */
  async linkClientAsOwner(tenantClientId, ownerClientId) {
    return withErrorHandling(async () => {
      if (!tenantClientId || !ownerClientId) throw new Error('IDs requis');
      if (tenantClientId === ownerClientId) throw new Error('Un client ne peut pas être son propre propriétaire');

      const { data, error } = await supabase
        .schema('majordhome')
        .from('clients')
        .update({ owner_client_id: ownerClientId })
        .eq('id', tenantClientId)
        .select()
        .single();

      if (error) throw error;
      return data;
    }, 'clients.linkClientAsOwner');
  },

  /**
   * Supprime le lien propriétaire d'un client (le délie)
   */
  async unlinkClient(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('clientId requis');

      const { data, error } = await supabase
        .schema('majordhome')
        .from('clients')
        .update({ owner_client_id: null })
        .eq('id', clientId)
        .select()
        .single();

      if (error) throw error;
      return data;
    }, 'clients.unlinkClient');
  },

  /**
   * Recherche rapide pour autocomplete
   */
  async searchClients(orgId, query, limit = 10) {
    return withErrorHandling(async () => {
      if (!orgId || !query || query.length < 2) {
        return [];
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

      return (data || []).map(c => ({
        ...c,
        display: `${c.display_name}${c.city ? ` - ${c.city}` : ''}`,
      }));
    }, 'clients.searchClients');
  },
};

export default clientsService;
