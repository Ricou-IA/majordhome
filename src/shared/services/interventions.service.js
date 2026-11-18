/**
 * interventions.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des interventions terrain (tablette technicien).
 *
 * Utilise majordhome.interventions via la vue publique majordhome_interventions.
 * Les photos et signatures sont stockées dans le bucket Storage "interventions".
 * La génération PDF et l'envoi email sont délégués à N8N via webhooks.
 *
 * Convention Storage path : {project_id}/{intervention_id}/{type}_{timestamp}.{ext}
 *
 * @version 1.0.0 - Sprint 3 Outil Terrain Tablette
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Types d'intervention (ENUM majordhome.intervention_type)
 */
export const INTERVENTION_TYPES = [
  { value: 'maintenance', label: 'Entretien', color: '#10B981', bgClass: 'bg-emerald-100 text-emerald-700', icon: 'Wrench' },
  { value: 'repair', label: 'Réparation', color: '#EF4444', bgClass: 'bg-red-100 text-red-700', icon: 'AlertTriangle' },
  { value: 'installation', label: 'Installation', color: '#8B5CF6', bgClass: 'bg-violet-100 text-violet-700', icon: 'Package' },
  { value: 'diagnostic', label: 'Diagnostic', color: '#3B82F6', bgClass: 'bg-blue-100 text-blue-700', icon: 'Search' },
  { value: 'urgent', label: 'Urgence', color: '#F59E0B', bgClass: 'bg-amber-100 text-amber-700', icon: 'Zap' },
  { value: 'entretien', label: 'Entretien', color: '#3B82F6', bgClass: 'bg-blue-100 text-blue-700', icon: 'Calendar' },
  { value: 'sav', label: 'SAV', color: '#F97316', bgClass: 'bg-orange-100 text-orange-700', icon: 'Wrench' },
  { value: 'other', label: 'Autre', color: '#6B7280', bgClass: 'bg-gray-100 text-gray-700', icon: 'MoreHorizontal' },
];

/**
 * Statuts d'intervention (ENUM majordhome.intervention_status)
 */
const INTERVENTION_STATUSES = [
  { value: 'scheduled', label: 'Planifiée', color: 'bg-blue-100 text-blue-700' },
  { value: 'in_progress', label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  { value: 'completed', label: 'Terminée', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: 'Annulée', color: 'bg-red-100 text-red-700' },
  { value: 'on_hold', label: 'En attente', color: 'bg-gray-100 text-gray-700' },
];

/**
 * Types de fichiers pour le Storage
 */
export const FILE_TYPES = {
  PHOTO_BEFORE: 'photo_before',
  PHOTO_AFTER: 'photo_after',
  PHOTO_EXTRA: 'photo_extra',
  SIGNATURE: 'signature',
  PDF_REPORT: 'report',
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Retourne la config d'un type d'intervention
 */
export function getInterventionTypeConfig(type) {
  return INTERVENTION_TYPES.find(t => t.value === type) || INTERVENTION_TYPES[INTERVENTION_TYPES.length - 1];
}

/**
 * Retourne la config d'un statut d'intervention
 */
export function getInterventionStatusConfig(status) {
  return INTERVENTION_STATUSES.find(s => s.value === status) || INTERVENTION_STATUSES[INTERVENTION_STATUSES.length - 1];
}

/**
 * Génère un chemin Storage pour un fichier
 * Convention : {project_id}/{intervention_id}/{type}_{timestamp}.{ext}
 */
function buildStoragePath(projectId, interventionId, fileType, extension = 'jpg') {
  const timestamp = Date.now();
  return `${projectId}/${interventionId}/${fileType}_${timestamp}.${extension}`;
}

/**
 * Extrait l'extension d'un fichier
 */
function getFileExtension(file) {
  if (file.name) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext) return ext;
  }
  // Fallback via MIME type
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  };
  return mimeMap[file.type] || 'jpg';
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const interventionsService = {
  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * Récupère une intervention par ID avec client et équipement en parallèle
   * @param {string} interventionId - UUID de l'intervention
   * @returns {{ data: { intervention, client, equipment }, error }}
   */
  async getInterventionById(interventionId) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    return withErrorHandling(async () => {
      // 1. Charger l'intervention
      const { data: intervention, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('id', interventionId)
        .single();

      if (error) throw error;

      // 2. Charger client + équipement en parallèle
      const [clientResult, equipmentResult] = await Promise.all([
        // Client via project_id → majordhome_clients
        supabase
          .from('majordhome_clients')
          .select('id, project_id, display_name, email, phone, address, postal_code, city, housing_type, access_instructions')
          .eq('project_id', intervention.project_id)
          .single(),

        // Équipement (optionnel) — category_id (référentiel de l'org, lu par le
        // wizard certificat), pas l'enum legacy `category` ; metadata /
        // installation_year pré-remplissent le certificat.
        intervention.equipment_id
          ? supabase
              .from('majordhome_equipments')
              .select('id, category_id, equipment_type_id, brand, model, serial_number, install_date, installation_year, metadata, notes')
              .eq('id', intervention.equipment_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

      return {
        intervention,
        client: clientResult.data || null,
        equipment: equipmentResult.data || null,
      };
    }, 'interventions.getInterventionById');
  },

  /**
   * Récupère les interventions d'un projet (pour la fiche client)
   */
  async getInterventionsByProject(projectId, { limit = 50 } = {}) {
    if (!projectId) throw new Error('[interventions] projectId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('project_id', projectId)
        .order('scheduled_date', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const withEquipment = data || [];

      // Équipement concerné (enfants = un certificat par équipement ; un SAV peut aussi en porter un).
      // Une erreur d'enrichissement fait échouer la lecture : l'onglet dit « illisible » plutôt que
      // d'afficher des lignes amputées sans le dire.
      const equipmentIds = [...new Set(withEquipment.filter((i) => i.equipment_id).map((i) => i.equipment_id))];
      if (equipmentIds.length > 0) {
        const { data: equipments, error: eqError } = await supabase
          .from('majordhome_equipments')
          .select('id, category_id, equipment_type_id, brand, model')
          .in('id', equipmentIds);
        if (eqError) throw eqError;

        const eqMap = Object.fromEntries((equipments || []).map((e) => [e.id, e]));
        for (const item of withEquipment) {
          const eq = item.equipment_id ? eqMap[item.equipment_id] : null;
          if (!eq) continue;
          item.equipment_category_id = eq.category_id;
          item.equipment_type_id = eq.equipment_type_id;
          item.equipment_brand = eq.brand;
          item.equipment_model = eq.model;
        }
      }

      // Planning : RDV rattachés à chaque intervention + leurs techniciens. `technician_name`
      // n'est renseigné sur aucune intervention (mesuré 2026-11-16) : qui est passé, et quand,
      // se lit ici. 2ᵉ requête mergée en mémoire (la vue des RDV reste un miroir simple).
      const interventionIds = withEquipment.map((i) => i.id);
      const rdvsByIntervention = new Map();
      if (interventionIds.length > 0) {
        const { data: rdvs, error: rdvError } = await supabase
          .from('majordhome_appointments')
          .select('id, intervention_id, scheduled_date, scheduled_start, status, appointment_type')
          .in('intervention_id', interventionIds);
        if (rdvError) throw rdvError;

        const techsByRdv = new Map();
        if (rdvs?.length) {
          const { data: techLinks, error: techError } = await supabase
            .from('majordhome_appointment_technicians')
            .select('appointment_id, technician_id')
            .in('appointment_id', rdvs.map((r) => r.id));
          if (techError) throw techError;
          for (const t of techLinks || []) {
            if (!techsByRdv.has(t.appointment_id)) techsByRdv.set(t.appointment_id, []);
            techsByRdv.get(t.appointment_id).push(t.technician_id);
          }
        }
        for (const r of rdvs || []) {
          if (!rdvsByIntervention.has(r.intervention_id)) rdvsByIntervention.set(r.intervention_id, []);
          rdvsByIntervention.get(r.intervention_id).push({ ...r, technician_ids: techsByRdv.get(r.id) || [] });
        }
      }
      for (const item of withEquipment) item.rdvs = rdvsByIntervention.get(item.id) || [];

      return withEquipment;
    }, 'interventions.getInterventionsByProject');
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour une intervention (rapport, notes, durée, etc.)
   * @param {string} interventionId
   * @param {Object} updates - Champs à mettre à jour
   */
  async updateIntervention(interventionId, updates = {}) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    return withErrorHandling(async () => {
      const updateData = {};

      // Rapport
      if (updates.work_performed !== undefined) updateData.work_performed = updates.work_performed;
      if (updates.report_notes !== undefined) updateData.report_notes = updates.report_notes;
      if (updates.parts_replaced !== undefined) updateData.parts_replaced = updates.parts_replaced;
      if (updates.duration_minutes !== undefined) updateData.duration_minutes = updates.duration_minutes;
      if (updates.is_billable !== undefined) updateData.is_billable = updates.is_billable;

      // Photos
      if (updates.photo_before_url !== undefined) updateData.photo_before_url = updates.photo_before_url;
      if (updates.photo_after_url !== undefined) updateData.photo_after_url = updates.photo_after_url;
      if (updates.photos_extra !== undefined) updateData.photos_extra = updates.photos_extra;

      // Signature
      if (updates.signature_url !== undefined) updateData.signature_url = updates.signature_url;
      if (updates.signed_at !== undefined) updateData.signed_at = updates.signed_at;
      if (updates.signed_by_name !== undefined) updateData.signed_by_name = updates.signed_by_name;

      // Metadata
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;
      if (updates.tags !== undefined) updateData.tags = updates.tags;

      // Date de rapport
      if (updates.report_date !== undefined) updateData.report_date = updates.report_date;

      // Timestamp
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update(updateData)
        .eq('id', interventionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    }, 'interventions.updateIntervention');
  },

  /**
   * Met à jour le statut d'une intervention
   * @param {string} interventionId
   * @param {string} status - Nouveau statut (scheduled, in_progress, completed, cancelled, on_hold)
   */
  async updateInterventionStatus(interventionId, status) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');
    if (!status) throw new Error('[interventions] status requis');

    const validStatuses = INTERVENTION_STATUSES.map(s => s.value);
    if (!validStatuses.includes(status)) {
      throw new Error(`[interventions] Statut invalide: ${status}`);
    }

    return withErrorHandling(async () => {
      const updates = {
        status,
        updated_at: new Date().toISOString(),
      };

      // Si on passe en "completed", enregistrer la date du rapport
      if (status === 'completed') {
        updates.report_date = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update(updates)
        .eq('id', interventionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    }, 'interventions.updateInterventionStatus');
  },

  // ==========================================================================
  // STORAGE - Upload / Download / Delete
  // ==========================================================================

  /**
   * Upload un fichier dans le bucket Storage "interventions"
   * @param {string} projectId - UUID du projet (pour le path)
   * @param {string} interventionId - UUID de l'intervention
   * @param {File|Blob} file - Fichier à uploader
   * @param {string} fileType - Type de fichier (FILE_TYPES)
   * @returns {{ data: { path, url }, error }}
   */
  async uploadFile(projectId, interventionId, file, fileType) {
    if (!projectId || !interventionId || !file || !fileType) {
      throw new Error('[interventions] projectId, interventionId, file et fileType requis');
    }

    return withErrorHandling(async () => {
      const extension = getFileExtension(file);
      const path = buildStoragePath(projectId, interventionId, fileType, extension);

      const { data, error } = await supabase.storage
        .from('interventions')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'image/jpeg',
        });

      if (error) throw error;

      // Générer l'URL signée (valable 1h)
      const { data: urlData } = await supabase.storage
        .from('interventions')
        .createSignedUrl(data.path, 3600);

      return {
        path: data.path,
        url: urlData?.signedUrl || null,
      };
    }, 'interventions.uploadFile');
  },

  /**
   * Récupère une URL signée pour un fichier Storage
   * @param {string} path - Chemin du fichier dans le bucket
   * @param {number} expiresIn - Durée de validité en secondes (défaut 1h)
   * @returns {{ data: string|null, error }}
   */
  async getFileUrl(path, expiresIn = 3600) {
    if (!path) return { data: null, error: null };

    return withErrorHandling(async () => {
      const { data, error } = await supabase.storage
        .from('interventions')
        .createSignedUrl(path, expiresIn);

      if (error) throw error;
      return data?.signedUrl || null;
    }, 'interventions.getFileUrl');
  },

  /**
   * Récupère les URLs signées pour toutes les photos/fichiers d'une intervention
   * @param {Object} intervention - L'objet intervention avec les paths
   * @returns {{ data: { photoBeforeUrl, photoAfterUrl, photosExtraUrls, signatureUrl }, error }}
   */
  async getInterventionFileUrls(intervention) {
    if (!intervention) return { data: null, error: new Error('intervention requis') };

    return withErrorHandling(async () => {
      const urlPromises = [];
      const keys = [];

      // Photo avant
      if (intervention.photo_before_url) {
        keys.push('photoBeforeUrl');
        urlPromises.push(this.getFileUrl(intervention.photo_before_url));
      }

      // Photo après
      if (intervention.photo_after_url) {
        keys.push('photoAfterUrl');
        urlPromises.push(this.getFileUrl(intervention.photo_after_url));
      }

      // Signature
      if (intervention.signature_url) {
        keys.push('signatureUrl');
        urlPromises.push(this.getFileUrl(intervention.signature_url));
      }

      const results = await Promise.all(urlPromises);

      const urls = {
        photoBeforeUrl: null,
        photoAfterUrl: null,
        photosExtraUrls: [],
        signatureUrl: null,
      };

      results.forEach((result, index) => {
        if (result.data) {
          urls[keys[index]] = result.data;
        }
      });

      // Photos supplémentaires
      if (intervention.photos_extra && Array.isArray(intervention.photos_extra) && intervention.photos_extra.length > 0) {
        const extraResults = await Promise.all(
          intervention.photos_extra.map(path => this.getFileUrl(path))
        );
        urls.photosExtraUrls = extraResults
          .filter(r => r.data)
          .map(r => r.data);
      }

      return urls;
    }, 'interventions.getInterventionFileUrls');
  },

  /**
   * Supprime un fichier du bucket Storage
   * @param {string} path - Chemin du fichier
   */
  async deleteFile(path) {
    if (!path) return { data: null, error: null };

    return withErrorHandling(async () => {
      const { error } = await supabase.storage
        .from('interventions')
        .remove([path]);

      if (error) throw error;
      return null;
    }, 'interventions.deleteFile');
  },

  // ==========================================================================
  // N8N WEBHOOKS - Génération PDF & Envoi email
  // ==========================================================================

  /**
   * Déclenche la génération du PV d'intervention via N8N
   * N8N reçoit l'ID, récupère les données, génère le PDF, l'uploade dans Storage
   * @param {string} interventionId
   * @returns {{ data: { success, pdfPath }, error }}
   */
  async triggerPdfGeneration(interventionId) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_PDF;
    if (!webhookUrl) {
      return { data: null, error: new Error('Webhook PDF non configuré') };
    }

    return withErrorHandling(async () => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      return {
        success: true,
        pdfPath: result.pdf_path || null,
      };
    }, 'interventions.triggerPdfGeneration');
  },

  /**
   * Déclenche l'envoi du rapport signé au client via N8N
   * N8N récupère le PDF signé + données client, envoie l'email
   * @param {string} interventionId
   * @returns {{ data: { success }, error }}
   */
  async triggerSignedReport(interventionId) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_SIGNED;
    if (!webhookUrl) {
      return { data: null, error: new Error('Webhook rapport signé non configuré') };
    }

    return withErrorHandling(async () => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return { success: true };
    }, 'interventions.triggerSignedReport');
  },

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Récupère un équipement par ID
   * @param {string} equipmentId
   */
  async getEquipmentById(equipmentId) {
    if (!equipmentId) return { data: null, error: null };

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('id', equipmentId)
        .single();

      if (error) throw error;
      return data;
    }, 'interventions.getEquipmentById');
  },
};

export default interventionsService;
