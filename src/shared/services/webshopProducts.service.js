/**
 * webshopProducts.service.js — Catalogue boutique (lu en direct par le site Mayer).
 * Lectures/écritures : vue auto-updatable majordhome_webshop_products, toujours filtrées org_id.
 * Écritures réservées à org_admin par la RLS (20261014_1) : `.select().single()` fait remonter
 * un refus (0 ligne → PGRST116) au lieu d'un faux succès.
 * Photos : bucket public `webshop`, chemin `${orgId}/products/${productId}/${uuid}.webp`.
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { imageToWebp } from '@/lib/webshop/imageToWebp';

const BUCKET = 'webshop';

export const webshopProductsService = {
  async getProducts(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .select('*')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'webshopProducts.getProducts');
  },

  async getCategories(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_categories')
        .select('id, slug, name, parent_id, display_order, is_active')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'webshopProducts.getCategories');
  },

  async createProduct(orgId, payload) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshopProducts.createProduct');
  },

  async updateProduct(orgId, productId, patch) {
    return withErrorHandling(async () => {
      if (!productId) throw new Error('[webshopProducts] productId requis');
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .update(patch)
        .eq('id', productId)
        .eq('org_id', orgId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshopProducts.updateProduct');
  },

  /** @returns {Promise<{ data: string|null, error: Error|null }>} URL publique de la photo */
  async uploadImage(orgId, productId, file) {
    return withErrorHandling(async () => {
      const blob = await imageToWebp(file);
      const path = `${orgId}/products/${productId}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: 'image/webp',
        upsert: false,
      });
      if (error) throw error;
      return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }, 'webshopProducts.uploadImage');
  },

  /** @param {string[]} paths - chemins sous `${orgId}/` uniquement (cf. imagesToDelete) */
  async deleteImages(paths) {
    return withErrorHandling(async () => {
      if (!paths?.length) return [];
      const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
      return data;
    }, 'webshopProducts.deleteImages');
  },
};

export default webshopProductsService;
