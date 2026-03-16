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
export const INTERVENTION_STATUSES = [
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

    try {
      // 1. Charger l'intervention
      const { data: intervention, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('id', interventionId)
        .single();

      if (error) {
        console.error('[interventions] getInterventionById error:', error);
        return { data: null, error };
      }

      // 2. Charger client + équipement en parallèle
      const [clientResult, equipmentResult] = await Promise.all([
        // Client via project_id → majordhome_clients
        supabase
          .from('majordhome_clients')
          .select('id, project_id, display_name, email, phone, address, postal_code, city, housing_type, access_instructions')
          .eq('project_id', intervention.project_id)
          .single(),

        // Équipement (optionnel)
        intervention.equipment_id
          ? supabase
              .from('majordhome_equipments')
              .select('id, category, brand, model, serial_number, install_date, notes')
              .eq('id', intervention.equipment_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

      return {
        data: {
          intervention,
          client: clientResult.data || null,
          equipment: equipmentResult.data || null,
        },
        error: null,
      };
    } catch (err) {
      console.error('[interventions] getInterventionById error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupère les interventions d'un projet (pour la fiche client)
   */
  async getInterventionsByProject(projectId, { limit = 50 } = {}) {
    if (!projectId) throw new Error('[interventions] projectId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('project_id', projectId)
        .order('scheduled_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[interventions] getInterventionsByProject error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] getInterventionsByProject error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  /**
   * Crée une nouvelle intervention
   * @param {Object} params
   * @param {string} params.projectId - UUID du projet (NOT NULL)
   * @param {string} params.interventionType - Type (maintenance, repair, etc.)
   * @param {string} params.scheduledDate - Date planifiée (YYYY-MM-DD)
   * @param {string} [params.reportNotes] - Notes / motif
   * @param {string} [params.status='scheduled'] - Statut initial
   * @param {string} [params.equipmentId] - UUID équipement (optionnel)
   * @param {string} [params.technicianId] - UUID technicien
   * @param {string} [params.technicianName] - Nom technicien
   * @param {string} [params.workPerformed] - Travaux effectués
   * @param {string} [params.createdBy] - UUID utilisateur créateur
   * @returns {{ data, error }}
   */
  async createIntervention({
    projectId,
    interventionType,
    scheduledDate,
    reportNotes = null,
    status = 'scheduled',
    equipmentId = null,
    technicianId = null,
    technicianName = null,
    workPerformed = null,
    createdBy = null,
  }) {
    if (!projectId) throw new Error('[interventions] projectId requis');
    if (!interventionType) throw new Error('[interventions] interventionType requis');
    if (!scheduledDate) throw new Error('[interventions] scheduledDate requis');

    try {
      console.log('[interventions] createIntervention', { projectId, interventionType, scheduledDate });

      const insertData = {
        project_id: projectId,
        intervention_type: interventionType,
        scheduled_date: scheduledDate,
        status,
        report_notes: reportNotes || null,
        equipment_id: equipmentId || null,
        technician_id: technicianId || null,
        technician_name: technicianName || null,
        work_performed: workPerformed || null,
        created_by: createdBy || null,
      };

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[interventions] createIntervention error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] createIntervention error:', err);
      return { data: null, error: err };
    }
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

    try {
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

      if (error) {
        console.error('[interventions] updateIntervention error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] updateIntervention error:', err);
      return { data: null, error: err };
    }
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

    try {
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

      if (error) {
        console.error('[interventions] updateInterventionStatus error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] updateInterventionStatus error:', err);
      return { data: null, error: err };
    }
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
   * @returns {{ path, url, error }}
   */
  async uploadFile(projectId, interventionId, file, fileType) {
    if (!projectId || !interventionId || !file || !fileType) {
      throw new Error('[interventions] projectId, interventionId, file et fileType requis');
    }

    try {
      const extension = getFileExtension(file);
      const path = buildStoragePath(projectId, interventionId, fileType, extension);

      const { data, error } = await supabase.storage
        .from('interventions')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'image/jpeg',
        });

      if (error) {
        console.error('[interventions] uploadFile error:', error);
        return { path: null, url: null, error };
      }

      // Générer l'URL signée (valable 1h)
      const { data: urlData } = await supabase.storage
        .from('interventions')
        .createSignedUrl(data.path, 3600);

      return {
        path: data.path,
        url: urlData?.signedUrl || null,
        error: null,
      };
    } catch (err) {
      console.error('[interventions] uploadFile error:', err);
      return { path: null, url: null, error: err };
    }
  },

  /**
   * Récupère une URL signée pour un fichier Storage
   * @param {string} path - Chemin du fichier dans le bucket
   * @param {number} expiresIn - Durée de validité en secondes (défaut 1h)
   * @returns {{ url, error }}
   */
  async getFileUrl(path, expiresIn = 3600) {
    if (!path) return { url: null, error: null };

    try {
      const { data, error } = await supabase.storage
        .from('interventions')
        .createSignedUrl(path, expiresIn);

      if (error) {
        console.error('[interventions] getFileUrl error:', error);
        return { url: null, error };
      }

      return { url: data?.signedUrl || null, error: null };
    } catch (err) {
      console.error('[interventions] getFileUrl error:', err);
      return { url: null, error: err };
    }
  },

  /**
   * Récupère les URLs signées pour toutes les photos/fichiers d'une intervention
   * @param {Object} intervention - L'objet intervention avec les paths
   * @returns {{ photoBeforeUrl, photoAfterUrl, photosExtraUrls, signatureUrl, error }}
   */
  async getInterventionFileUrls(intervention) {
    if (!intervention) return { error: new Error('intervention requis') };

    try {
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
        if (result.url) {
          urls[keys[index]] = result.url;
        }
      });

      // Photos supplémentaires
      if (intervention.photos_extra && Array.isArray(intervention.photos_extra) && intervention.photos_extra.length > 0) {
        const extraResults = await Promise.all(
          intervention.photos_extra.map(path => this.getFileUrl(path))
        );
        urls.photosExtraUrls = extraResults
          .filter(r => r.url)
          .map(r => r.url);
      }

      return { ...urls, error: null };
    } catch (err) {
      console.error('[interventions] getInterventionFileUrls error:', err);
      return {
        photoBeforeUrl: null,
        photoAfterUrl: null,
        photosExtraUrls: [],
        signatureUrl: null,
        error: err,
      };
    }
  },

  /**
   * Supprime un fichier du bucket Storage
   * @param {string} path - Chemin du fichier
   */
  async deleteFile(path) {
    if (!path) return { error: null };

    try {
      const { error } = await supabase.storage
        .from('interventions')
        .remove([path]);

      if (error) {
        console.error('[interventions] deleteFile error:', error);
        return { error };
      }

      return { error: null };
    } catch (err) {
      console.error('[interventions] deleteFile error:', err);
      return { error: err };
    }
  },

  // ==========================================================================
  // N8N WEBHOOKS - Génération PDF & Envoi email
  // ==========================================================================

  /**
   * Déclenche la génération du PV d'intervention via N8N
   * N8N reçoit l'ID, récupère les données, génère le PDF, l'uploade dans Storage
   * @param {string} interventionId
   * @returns {{ success, pdfPath, error }}
   */
  async triggerPdfGeneration(interventionId) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_PDF;
    if (!webhookUrl) {
      console.error('[interventions] VITE_N8N_WEBHOOK_PDF non configuré');
      return { success: false, pdfPath: null, error: new Error('Webhook PDF non configuré') };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[interventions] triggerPdfGeneration HTTP error:', response.status, errorText);
        return { success: false, pdfPath: null, error: new Error(`HTTP ${response.status}: ${errorText}`) };
      }

      const result = await response.json();

      return {
        success: true,
        pdfPath: result.pdf_path || null,
        error: null,
      };
    } catch (err) {
      console.error('[interventions] triggerPdfGeneration error:', err);
      return { success: false, pdfPath: null, error: err };
    }
  },

  /**
   * Déclenche l'envoi du rapport signé au client via N8N
   * N8N récupère le PDF signé + données client, envoie l'email
   * @param {string} interventionId
   * @returns {{ success, error }}
   */
  async triggerSignedReport(interventionId) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_SIGNED;
    if (!webhookUrl) {
      console.error('[interventions] VITE_N8N_WEBHOOK_SIGNED non configuré');
      return { success: false, error: new Error('Webhook rapport signé non configuré') };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[interventions] triggerSignedReport HTTP error:', response.status, errorText);
        return { success: false, error: new Error(`HTTP ${response.status}: ${errorText}`) };
      }

      return { success: true, error: null };
    } catch (err) {
      console.error('[interventions] triggerSignedReport error:', err);
      return { success: false, error: err };
    }
  },

  // ==========================================================================
  // CHANTIER — Intervention parent + Slots
  // ==========================================================================

  /**
   * Crée une intervention parent pour un chantier (1 par lead gagné)
   */
  async createChantierIntervention({ leadId, projectId, equipmentId = null, createdBy = null }) {
    if (!leadId || !projectId) throw new Error('[interventions] leadId et projectId requis');

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .insert({
          project_id: projectId,
          lead_id: leadId,
          parent_id: null,
          intervention_type: 'installation',
          scheduled_date: today,
          status: 'scheduled',
          equipment_id: equipmentId || null,
          created_by: createdBy || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[interventions] createChantierIntervention error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] createChantierIntervention error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Crée un slot (créneau) sous une intervention parent
   */
  async createInterventionSlot({ parentId, projectId, slotDate, slotStartTime = null, slotEndTime = null, slotNotes = null, technicianIds = [], createdBy = null }) {
    if (!parentId || !projectId || !slotDate) {
      throw new Error('[interventions] parentId, projectId et slotDate requis');
    }

    try {
      // 1. Créer le slot (intervention enfant)
      const { data: slot, error } = await supabase
        .from('majordhome_interventions')
        .insert({
          project_id: projectId,
          parent_id: parentId,
          intervention_type: 'installation',
          scheduled_date: slotDate,
          slot_date: slotDate,
          slot_start_time: slotStartTime || null,
          slot_end_time: slotEndTime || null,
          slot_notes: slotNotes || null,
          status: 'scheduled',
          created_by: createdBy || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[interventions] createInterventionSlot error:', error);
        return { data: null, error };
      }

      // 2. Assigner les techniciens
      if (technicianIds.length > 0) {
        await this.setInterventionTechnicians(slot.id, technicianIds);
      }

      return { data: slot, error: null };
    } catch (err) {
      console.error('[interventions] createInterventionSlot error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Met à jour un slot existant
   */
  async updateInterventionSlot(slotId, { slotDate, slotStartTime, slotEndTime, slotNotes, technicianIds }) {
    if (!slotId) throw new Error('[interventions] slotId requis');

    try {
      const updates = { updated_at: new Date().toISOString() };
      if (slotDate !== undefined) {
        updates.slot_date = slotDate;
        updates.scheduled_date = slotDate;
      }
      if (slotStartTime !== undefined) updates.slot_start_time = slotStartTime;
      if (slotEndTime !== undefined) updates.slot_end_time = slotEndTime;
      if (slotNotes !== undefined) updates.slot_notes = slotNotes;

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update(updates)
        .eq('id', slotId)
        .select()
        .single();

      if (error) {
        console.error('[interventions] updateInterventionSlot error:', error);
        return { data: null, error };
      }

      // Mise à jour des techniciens si fournis
      if (technicianIds !== undefined) {
        await this.setInterventionTechnicians(slotId, technicianIds);
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] updateInterventionSlot error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Supprime un slot
   */
  async deleteInterventionSlot(slotId) {
    if (!slotId) throw new Error('[interventions] slotId requis');

    try {
      const { error } = await supabase
        .from('majordhome_interventions')
        .delete()
        .eq('id', slotId);

      if (error) {
        console.error('[interventions] deleteInterventionSlot error:', error);
        return { error };
      }

      return { error: null };
    } catch (err) {
      console.error('[interventions] deleteInterventionSlot error:', err);
      return { error: err };
    }
  },

  /**
   * Récupère les slots d'une intervention parent (vue majordhome_intervention_slots)
   */
  async getInterventionSlots(parentId) {
    if (!parentId) return { data: [], error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_intervention_slots')
        .select('*')
        .eq('parent_id', parentId)
        .order('slot_date', { ascending: true });

      if (error) {
        console.error('[interventions] getInterventionSlots error:', error);
        return { data: null, error };
      }

      return { data: data || [], error: null };
    } catch (err) {
      console.error('[interventions] getInterventionSlots error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupère l'intervention parent d'un lead
   */
  async getChantierInterventionByLeadId(leadId) {
    if (!leadId) return { data: null, error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('*')
        .eq('lead_id', leadId)
        .is('parent_id', null)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[interventions] getChantierInterventionByLeadId error:', error);
        return { data: null, error };
      }

      return { data: data || null, error: null };
    } catch (err) {
      console.error('[interventions] getChantierInterventionByLeadId error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Assigne des techniciens à une intervention (delete + insert pattern)
   */
  async setInterventionTechnicians(interventionId, technicianIds = []) {
    if (!interventionId) throw new Error('[interventions] interventionId requis');

    try {
      // 1. Supprimer les assignations existantes
      await supabase
        .from('majordhome_intervention_technicians')
        .delete()
        .eq('intervention_id', interventionId);

      // 2. Insérer les nouvelles
      if (technicianIds.length > 0) {
        const rows = technicianIds.map(tid => ({
          intervention_id: interventionId,
          technician_id: tid,
        }));

        const { error } = await supabase
          .from('majordhome_intervention_technicians')
          .insert(rows);

        if (error) {
          console.error('[interventions] setInterventionTechnicians insert error:', error);
          return { error };
        }
      }

      return { error: null };
    } catch (err) {
      console.error('[interventions] setInterventionTechnicians error:', err);
      return { error: err };
    }
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

    try {
      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('id', equipmentId)
        .single();

      if (error) {
        console.error('[interventions] getEquipmentById error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[interventions] getEquipmentById error:', err);
      return { data: null, error: err };
    }
  },
};

export default interventionsService;
