/**
 * technicalVisit.service.js - Majord'home Artisan
 * ============================================================================
 * Service CRUD pour la Fiche Technique Terrain.
 * Pattern identique à leads.service.js + interventions.service.js
 *
 * Lectures : via vue publique majordhome_technical_visits
 * Écritures : via RPCs SECURITY DEFINER (schéma majordhome non exposé PostgREST)
 * Photos   : bucket Storage "technical-visits"
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

const STORAGE_BUCKET = 'technical-visits';

// ============================================================================
// HELPERS
// ============================================================================

function getFileExtension(file) {
  if (file.name) {
    const parts = file.name.split('.');
    if (parts.length > 1) return parts.pop().toLowerCase();
  }
  const mimeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
  return mimeMap[file.type] || 'jpg';
}

function buildPhotoPath(orgId, leadId, category, extension) {
  const timestamp = Date.now();
  return `${orgId}/${leadId}/${category}_${timestamp}.${extension}`;
}

function buildPdfPath(orgId, leadId) {
  const timestamp = Date.now();
  return `${orgId}/${leadId}/fiche_technique_${timestamp}.pdf`;
}

// ============================================================================
// SERVICE
// ============================================================================

export const technicalVisitService = {

  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * Récupère la fiche technique pour un lead donné (via vue publique)
   * @returns {{ data: Object|null, error }}
   */
  async getByLeadId(leadId) {
    if (!leadId) return { data: null, error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_technical_visits')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle();

      if (error) {
        console.error('[technicalVisit] getByLeadId error:', error);
        return { data: null, error };
      }
      return { data, error: null };
    } catch (err) {
      console.error('[technicalVisit] getByLeadId error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // ÉCRITURE
  // ==========================================================================

  /**
   * Crée une fiche technique (RPC)
   * @param {Object} payload - Données initiales
   * @returns {{ data: Object, error }}
   */
  async create(payload) {
    try {
      const { data, error } = await supabase.rpc('create_majordhome_technical_visit', {
        p_data: payload,
      });

      if (error) {
        console.error('[technicalVisit] create error:', error);
        return { data: null, error };
      }

      const visit = Array.isArray(data) ? data[0] : data;
      return { data: visit, error: null };
    } catch (err) {
      console.error('[technicalVisit] create error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Met à jour une fiche technique (RPC)
   * @param {string} visitId - UUID de la fiche
   * @param {Object} updates - Champs à mettre à jour
   * @returns {{ data: Object, error }}
   */
  async update(visitId, updates) {
    if (!visitId) throw new Error('[technicalVisit] visitId requis');

    try {
      const { data, error } = await supabase.rpc('update_majordhome_technical_visit', {
        p_visit_id: visitId,
        p_updates: updates,
      });

      if (error) {
        console.error('[technicalVisit] update error:', error);
        return { data: null, error };
      }

      const visit = Array.isArray(data) ? data[0] : data;
      return { data: visit, error: null };
    } catch (err) {
      console.error('[technicalVisit] update error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Auto-save d'un seul champ (appel atomique sur blur)
   */
  async autoSaveField(visitId, field, value) {
    return this.update(visitId, { [field]: value });
  },

  // ==========================================================================
  // LOCK / UNLOCK
  // ==========================================================================

  async lock(visitId, userId) {
    return this.update(visitId, {
      locked: true,
      locked_at: new Date().toISOString(),
      locked_by: userId,
    });
  },

  async unlock(visitId) {
    return this.update(visitId, {
      locked: false,
      locked_at: null,
      locked_by: null,
    });
  },

  // ==========================================================================
  // PHOTOS — Storage
  // ==========================================================================

  /**
   * Upload une photo dans le bucket Storage
   * @param {string} orgId
   * @param {string} leadId
   * @param {File} file
   * @param {string} category - facade, installation, etc.
   * @returns {{ path, url, error }}
   */
  async uploadPhoto(orgId, leadId, file, category) {
    if (!orgId || !leadId || !file || !category) {
      throw new Error('[technicalVisit] orgId, leadId, file et category requis');
    }

    try {
      const extension = getFileExtension(file);
      const path = buildPhotoPath(orgId, leadId, category, extension);

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'image/jpeg',
        });

      if (error) {
        console.error('[technicalVisit] uploadPhoto storage error:', error);
        return { path: null, url: null, error };
      }

      // Générer l'URL signée (1h)
      const { data: urlData } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(data.path, 3600);

      return {
        path: data.path,
        url: urlData?.signedUrl || null,
        error: null,
      };
    } catch (err) {
      console.error('[technicalVisit] uploadPhoto error:', err);
      return { path: null, url: null, error: err };
    }
  },

  /**
   * Enregistre la référence photo en DB
   */
  async createPhotoRecord(record) {
    try {
      const { data, error } = await supabase
        .from('majordhome_technical_visit_photos')
        .insert([record])
        .select()
        .single();

      if (error) {
        console.error('[technicalVisit] createPhotoRecord error:', error);
        return { data: null, error };
      }
      return { data, error: null };
    } catch (err) {
      console.error('[technicalVisit] createPhotoRecord error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Supprime une photo (Storage + DB)
   */
  async deletePhoto(photoId, storagePath) {
    try {
      // Supprimer du storage
      if (storagePath) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      }

      // Supprimer de la DB
      const { error } = await supabase
        .from('majordhome_technical_visit_photos')
        .delete()
        .eq('id', photoId);

      if (error) {
        console.error('[technicalVisit] deletePhoto DB error:', error);
        return { error };
      }
      return { error: null };
    } catch (err) {
      console.error('[technicalVisit] deletePhoto error:', err);
      return { error: err };
    }
  },

  /**
   * Récupère les photos d'une fiche technique
   */
  async getPhotosByVisitId(visitId) {
    if (!visitId) return { data: [], error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_technical_visit_photos')
        .select('*')
        .eq('technical_visit_id', visitId)
        .order('category')
        .order('sort_order');

      if (error) {
        console.error('[technicalVisit] getPhotosByVisitId error:', error);
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (err) {
      console.error('[technicalVisit] getPhotosByVisitId error:', err);
      return { data: [], error: err };
    }
  },

  /**
   * Génère des URLs signées pour un lot de photos
   */
  async getPhotoSignedUrls(photos) {
    if (!photos?.length) return [];

    const results = await Promise.all(
      photos.map(async (photo) => {
        try {
          const { data } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(photo.storage_path, 3600);
          return { ...photo, signed_url: data?.signedUrl || null };
        } catch {
          return { ...photo, signed_url: null };
        }
      })
    );

    return results;
  },

  // ==========================================================================
  // PDF — Storage
  // ==========================================================================

  /**
   * Sauvegarde le PDF généré dans Storage
   * @param {string} orgId
   * @param {string} leadId
   * @param {Blob} pdfBlob
   * @returns {{ path, url, error }}
   */
  async savePdfToStorage(orgId, leadId, pdfBlob) {
    try {
      const path = buildPdfPath(orgId, leadId);

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, pdfBlob, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf',
        });

      if (error) {
        console.error('[technicalVisit] savePdfToStorage error:', error);
        return { path: null, url: null, error };
      }

      const { data: urlData } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(data.path, 3600);

      return {
        path: data.path,
        url: urlData?.signedUrl || null,
        error: null,
      };
    } catch (err) {
      console.error('[technicalVisit] savePdfToStorage error:', err);
      return { path: null, url: null, error: err };
    }
  },

  /**
   * Récupère l'URL signée du PDF
   */
  async getPdfUrl(pdfPath) {
    if (!pdfPath) return { url: null, error: null };

    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(pdfPath, 3600);

      if (error) {
        console.error('[technicalVisit] getPdfUrl error:', error);
        return { url: null, error };
      }
      return { url: data?.signedUrl || null, error: null };
    } catch (err) {
      console.error('[technicalVisit] getPdfUrl error:', err);
      return { url: null, error: err };
    }
  },
};
