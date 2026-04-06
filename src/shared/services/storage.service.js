/**
 * storage.service.js — Service Supabase Storage partagé
 * ============================================================================
 * Abstraction centralisée pour les opérations Storage (upload, URL signée,
 * delete). Remplace le code dupliqué dans interventions, technicalVisit,
 * sav et certificats services.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

export const storageService = {
  /**
   * Génère une URL signée pour un fichier dans un bucket
   * @param {string} bucket - Nom du bucket (ex: 'interventions', 'technical-visits')
   * @param {string} path - Chemin du fichier dans le bucket
   * @param {number} [expiresIn=3600] - Durée de validité en secondes
   * @returns {Promise<{ url: string|null, error: Error|null }>}
   */
  async getSignedUrl(bucket, path, expiresIn = 3600) {
    if (!path) return { url: null, error: null };
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
      if (error) return { url: null, error };
      return { url: data?.signedUrl || null, error: null };
    } catch (err) {
      console.error(`[storage] getSignedUrl (${bucket}):`, err);
      return { url: null, error: err };
    }
  },

  /**
   * Génère des URLs signées pour un lot de chemins
   * @param {string} bucket - Nom du bucket
   * @param {Array<{ storage_path: string, [key: string]: any }>} items - Objets avec storage_path
   * @param {number} [expiresIn=3600] - Durée de validité en secondes
   * @returns {Promise<Array<{ ...item, signed_url: string|null }>>}
   */
  async getSignedUrls(bucket, items, expiresIn = 3600) {
    if (!items?.length) return [];

    return Promise.all(
      items.map(async (item) => {
        try {
          const { data } = await supabase.storage
            .from(bucket)
            .createSignedUrl(item.storage_path, expiresIn);
          return { ...item, signed_url: data?.signedUrl || null };
        } catch {
          return { ...item, signed_url: null };
        }
      })
    );
  },

  /**
   * Upload un fichier dans un bucket
   * @param {string} bucket - Nom du bucket
   * @param {string} path - Chemin destination dans le bucket
   * @param {File|Blob} file - Fichier à uploader
   * @param {Object} [options] - Options Supabase (cacheControl, upsert, contentType)
   * @returns {Promise<{ path: string|null, url: string|null, error: Error|null }>}
   */
  async uploadFile(bucket, path, file, options = {}) {
    try {
      const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: options.cacheControl || '3600',
        upsert: options.upsert || false,
        contentType: options.contentType || file.type || 'application/octet-stream',
      });
      if (error) return { path: null, url: null, error };

      const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(data.path, 3600);
      return { path: data.path, url: urlData?.signedUrl || null, error: null };
    } catch (err) {
      console.error(`[storage] uploadFile (${bucket}):`, err);
      return { path: null, url: null, error: err };
    }
  },

  /**
   * Supprime un fichier d'un bucket
   * @param {string} bucket - Nom du bucket
   * @param {string} path - Chemin du fichier
   * @returns {Promise<{ error: Error|null }>}
   */
  async deleteFile(bucket, path) {
    if (!path) return { error: null };
    try {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) return { error };
      return { error: null };
    } catch (err) {
      console.error(`[storage] deleteFile (${bucket}):`, err);
      return { error: err };
    }
  },

  /**
   * Supprime plusieurs fichiers d'un bucket
   * @param {string} bucket - Nom du bucket
   * @param {string[]} paths - Chemins des fichiers
   * @returns {Promise<{ error: Error|null }>}
   */
  async deleteFiles(bucket, paths) {
    if (!paths?.length) return { error: null };
    try {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) return { error };
      return { error: null };
    } catch (err) {
      console.error(`[storage] deleteFiles (${bucket}):`, err);
      return { error: err };
    }
  },
};
