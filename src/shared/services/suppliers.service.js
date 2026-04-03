/**
 * suppliers.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des fournisseurs et catalogue produits.
 *
 * Lectures : vues majordhome_suppliers, majordhome_supplier_products
 * Écritures : vues majordhome_suppliers_write, majordhome_supplier_products_write
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { storageService } from '@services/storage.service';

// ============================================================================
// CONSTANTES
// ============================================================================

export const PRODUCT_CATEGORIES = [
  { value: 'poele', label: 'Poêle' },
  { value: 'climatisation', label: 'Climatisation' },
  { value: 'chauffage', label: 'Chauffage' },
  { value: 'fumisterie', label: 'Fumisterie' },
];

export const PRODUCT_UNITS = [
  { value: 'pièce', label: 'Pièce' },
  { value: 'ml', label: 'Mètre linéaire' },
  { value: 'm²', label: 'Mètre carré' },
  { value: 'forfait', label: 'Forfait' },
  { value: 'h', label: 'Heure' },
];

/** Normalise un nom de catégorie pour matcher la DB (minuscule, sans accents) */
function normalizeCategory(cat) {
  if (!cat) return cat;
  return cat.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const suppliersService = {
  // ==========================================================================
  // FOURNISSEURS — LECTURE
  // ==========================================================================

  async getSuppliers(orgId) {
    try {
      if (!orgId) throw new Error('[suppliersService] orgId requis');

      const { data, error } = await supabase
        .from('majordhome_suppliers')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getSuppliers:', error);
      return { data: [], error };
    }
  },

  async getSupplierById(supplierId) {
    try {
      if (!supplierId) throw new Error('[suppliersService] supplierId requis');

      const { data, error } = await supabase
        .from('majordhome_suppliers')
        .select('*')
        .eq('id', supplierId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] getSupplierById:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // FOURNISSEURS — ÉCRITURE
  // ==========================================================================

  async createSupplier({ orgId, name, contactName, contactEmail, contactPhone, address, postalCode, city, siret, notes }) {
    try {
      if (!orgId || !name) throw new Error('[suppliersService] orgId et name requis');

      const { data, error } = await supabase
        .from('majordhome_suppliers_write')
        .insert({
          org_id: orgId,
          name: name.trim(),
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
          address: address || null,
          postal_code: postalCode || null,
          city: city || null,
          siret: siret || null,
          notes: notes || null,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] createSupplier:', error);
      return { data: null, error };
    }
  },

  async updateSupplier(supplierId, updates = {}) {
    try {
      if (!supplierId) throw new Error('[suppliersService] supplierId requis');

      const updateData = {};
      if (updates.name !== undefined) updateData.name = updates.name.trim();
      if (updates.contactName !== undefined) updateData.contact_name = updates.contactName || null;
      if (updates.contactEmail !== undefined) updateData.contact_email = updates.contactEmail || null;
      if (updates.contactPhone !== undefined) updateData.contact_phone = updates.contactPhone || null;
      if (updates.address !== undefined) updateData.address = updates.address || null;
      if (updates.postalCode !== undefined) updateData.postal_code = updates.postalCode || null;
      if (updates.city !== undefined) updateData.city = updates.city || null;
      if (updates.siret !== undefined) updateData.siret = updates.siret || null;
      if (updates.notes !== undefined) updateData.notes = updates.notes || null;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('majordhome_suppliers_write')
        .update(updateData)
        .eq('id', supplierId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] updateSupplier:', error);
      return { data: null, error };
    }
  },

  async deactivateSupplier(supplierId) {
    try {
      if (!supplierId) throw new Error('[suppliersService] supplierId requis');

      const { data, error } = await supabase
        .from('majordhome_suppliers_write')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', supplierId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] deactivateSupplier:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // PRODUITS — LECTURE
  // ==========================================================================

  async getProducts(supplierId, { search = '', limit = 50, offset = 0 } = {}) {
    try {
      if (!supplierId) throw new Error('[suppliersService] supplierId requis');

      let query = supabase
        .from('majordhome_supplier_products')
        .select('*', { count: 'exact' })
        .eq('supplier_id', supplierId)
        .eq('is_active', true)
        .order('category')
        .order('name')
        .range(offset, offset + limit - 1);

      if (search) {
        const term = `%${search.trim()}%`;
        query = query.or(`name.ilike.${term},reference.ilike.${term},code_ean.ilike.${term},code_famille.ilike.${term},gamme.ilike.${term}`);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      console.error('[suppliersService] getProducts:', error);
      return { data: [], count: 0, error };
    }
  },

  async getProductCount(supplierId) {
    try {
      if (!supplierId) return { count: 0, error: null };
      const { count, error } = await supabase
        .from('majordhome_supplier_products')
        .select('id', { count: 'exact', head: true })
        .eq('supplier_id', supplierId)
        .eq('is_active', true);
      if (error) throw error;
      return { count: count || 0, error: null };
    } catch (error) {
      return { count: 0, error };
    }
  },

  async getProductsByOrg(orgId) {
    try {
      if (!orgId) throw new Error('[suppliersService] orgId requis');

      const { data, error } = await supabase
        .from('majordhome_supplier_products')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('supplier_name')
        .order('name');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getProductsByOrg:', error);
      return { data: [], error };
    }
  },

  async searchProducts(orgId, query) {
    try {
      if (!orgId) throw new Error('[suppliersService] orgId requis');
      if (!query || query.length < 2) return { data: [], error: null };

      const searchTerm = `%${query.trim()}%`;

      const { data, error } = await supabase
        .from('majordhome_supplier_products')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .or(`name.ilike.${searchTerm},reference.ilike.${searchTerm}`)
        .order('supplier_name')
        .order('name')
        .limit(30);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] searchProducts:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // PRODUITS — FILTRES (pour le picker devis)
  // ==========================================================================

  async getSuppliersByCategory(orgId, category) {
    try {
      if (!orgId || !category) return { data: [], error: null };
      const { data, error } = await supabase
        .rpc('get_suppliers_by_category', { p_org_id: orgId, p_category: normalizeCategory(category) });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getSuppliersByCategory:', error);
      return { data: [], error };
    }
  },

  async getDistinctGammes(supplierId, category) {
    try {
      if (!supplierId) return { data: [], error: null };
      const params = { p_supplier_id: supplierId };
      if (category) params.p_category = normalizeCategory(category);
      const { data, error } = await supabase.rpc('get_distinct_gammes', params);

      if (error) throw error;
      return { data: (data || []).map((r) => r.gamme), error: null };
    } catch (error) {
      console.error('[suppliersService] getDistinctGammes:', error);
      return { data: [], error };
    }
  },

  async getDistinctDiametres(supplierId, gamme, category) {
    try {
      if (!supplierId) return { data: [], error: null };
      const params = { p_supplier_id: supplierId, p_gamme: gamme || null };
      if (category) params.p_category = normalizeCategory(category);
      const { data, error } = await supabase.rpc('get_distinct_diametres', params);

      if (error) throw error;
      return { data: (data || []).map((r) => r.diametre), error: null };
    } catch (error) {
      console.error('[suppliersService] getDistinctDiametres:', error);
      return { data: [], error };
    }
  },

  async getFilteredProducts(supplierId, { gamme, diametre, category } = {}) {
    try {
      if (!supplierId) return { data: [], error: null };
      let query = supabase
        .from('majordhome_supplier_products')
        .select('*')
        .eq('supplier_id', supplierId)
        .eq('is_active', true)
        .order('name');

      if (gamme) query = query.eq('gamme', gamme);
      if (diametre) query = query.eq('diametre', diametre);
      if (category) query = query.ilike('category', normalizeCategory(category));
      query = query.limit(500);

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getFilteredProducts:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // PRODUITS — ÉCRITURE
  // ==========================================================================

  async createProduct({ supplierId, orgId, reference, name, description, category, purchasePriceHt, sellingPriceHt, defaultTvaRate, unit, codeFamille, gamme, codeEan, tarifPublic, tauxRemise, diametre }) {
    try {
      if (!supplierId || !orgId || !name) throw new Error('[suppliersService] supplierId, orgId et name requis');

      // Tarif Public = Prix de vente. Achat = Tarif Public × (1 - Remise%)
      const tp = tarifPublic ? parseFloat(tarifPublic) : 0;
      const tr = tauxRemise ? parseFloat(tauxRemise) : 0;
      const computedPurchasePrice = tp > 0 ? Math.round(tp * (1 - tr / 100) * 100) / 100 : 0;
      const computedSellingPrice = sellingPriceHt ? parseFloat(sellingPriceHt) : tp;

      const { data, error } = await supabase
        .from('majordhome_supplier_products_write')
        .insert({
          supplier_id: supplierId,
          org_id: orgId,
          reference: reference || null,
          name: name.trim(),
          description: description || null,
          category: category || null,
          purchase_price_ht: computedPurchasePrice,
          selling_price_ht: computedSellingPrice,
          default_tva_rate: defaultTvaRate ? parseFloat(defaultTvaRate) : 20,
          unit: unit || 'pièce',
          code_famille: codeFamille || null,
          gamme: gamme || null,
          code_ean: codeEan || null,
          tarif_public: tp || null,
          taux_remise: tr,
          diametre: diametre || null,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] createProduct:', error);
      return { data: null, error };
    }
  },

  /**
   * Import bulk de produits (pour import Excel)
   */
  async bulkCreateProducts(supplierId, orgId, products) {
    try {
      if (!supplierId || !orgId) throw new Error('[suppliersService] supplierId et orgId requis');
      if (!products?.length) return { data: { imported: 0 }, error: null };

      // Logique prix :
      // - Tarif Public = Prix de vente HT
      // - Prix d'achat = Tarif Public × (1 - Remise%)
      // - Si pas de remise → Achat = Vente = Tarif Public
      const rows = products.map((p) => {
        const tarifPublic = parseFloat(p.tarifPublic) || 0;
        let tauxRemise = parseFloat(p.tauxRemise) || 0;
        // Excel peut fournir 0.68 (format décimal) au lieu de 68 (pourcentage)
        if (tauxRemise > 0 && tauxRemise < 1) tauxRemise = Math.round(tauxRemise * 10000) / 100;
        const sellingPrice = parseFloat(p.sellingPriceHt) || tarifPublic;
        const purchasePrice = tarifPublic > 0
          ? Math.round(tarifPublic * (1 - tauxRemise / 100) * 100) / 100
          : 0;

        return {
          supplier_id: supplierId,
          org_id: orgId,
          name: (p.name || '').trim(),
          reference: p.reference || null,
          category: p.category || null,
          code_famille: p.codeFamille || null,
          gamme: p.gamme || null,
          code_ean: p.codeEan || null,
          tarif_public: tarifPublic || null,
          taux_remise: tauxRemise,
          purchase_price_ht: purchasePrice || 0,
          selling_price_ht: sellingPrice || 0,
          default_tva_rate: parseFloat(p.defaultTvaRate) || 20,
          diametre: p.diametre || null,
          unit: p.unit || 'pièce',
        };
      }).filter((r) => r.name);

      // Supprimer les produits existants du fournisseur par batch (bypass limite Supabase 1000)
      let hasMore = true;
      while (hasMore) {
        const { data: toDelete, error: fetchErr } = await supabase
          .from('majordhome_supplier_products_write')
          .select('id')
          .eq('supplier_id', supplierId)
          .limit(500);

        if (fetchErr) throw fetchErr;
        if (!toDelete?.length) { hasMore = false; break; }

        const ids = toDelete.map((r) => r.id);
        const { error: delErr } = await supabase
          .from('majordhome_supplier_products_write')
          .delete()
          .in('id', ids);

        if (delErr) throw delErr;
        if (toDelete.length < 500) hasMore = false;
      }

      // Insert par batch de 500
      let imported = 0;
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('majordhome_supplier_products_write')
          .insert(batch)
          .select('id');

        if (error) throw error;
        imported += data?.length || 0;
      }

      return { data: { imported }, error: null };
    } catch (error) {
      console.error('[suppliersService] bulkCreateProducts:', error);
      return { data: null, error };
    }
  },

  async updateProduct(productId, updates = {}) {
    try {
      if (!productId) throw new Error('[suppliersService] productId requis');

      const updateData = {};
      if (updates.reference !== undefined) updateData.reference = updates.reference || null;
      if (updates.name !== undefined) updateData.name = updates.name.trim();
      if (updates.description !== undefined) updateData.description = updates.description || null;
      if (updates.category !== undefined) updateData.category = updates.category || null;
      if (updates.codeFamille !== undefined) updateData.code_famille = updates.codeFamille || null;
      if (updates.gamme !== undefined) updateData.gamme = updates.gamme || null;
      if (updates.codeEan !== undefined) updateData.code_ean = updates.codeEan || null;
      if (updates.tarifPublic !== undefined) updateData.tarif_public = updates.tarifPublic ? parseFloat(updates.tarifPublic) : null;
      if (updates.tauxRemise !== undefined) updateData.taux_remise = updates.tauxRemise ? parseFloat(updates.tauxRemise) : 0;
      if (updates.diametre !== undefined) updateData.diametre = updates.diametre || null;
      if (updates.purchasePriceHt !== undefined) updateData.purchase_price_ht = parseFloat(updates.purchasePriceHt) || 0;
      if (updates.sellingPriceHt !== undefined) updateData.selling_price_ht = parseFloat(updates.sellingPriceHt) || 0;
      if (updates.defaultTvaRate !== undefined) updateData.default_tva_rate = parseFloat(updates.defaultTvaRate) || 20;
      if (updates.unit !== undefined) updateData.unit = updates.unit || 'pièce';

      // Auto-calc purchase price from tarif + remise
      if (updates.tarifPublic !== undefined || updates.tauxRemise !== undefined) {
        const tp = updateData.tarif_public ?? updates.tarifPublic;
        const tr = updateData.taux_remise ?? updates.tauxRemise ?? 0;
        if (tp) {
          updateData.purchase_price_ht = Math.round(parseFloat(tp) * (1 - parseFloat(tr) / 100) * 100) / 100;
        }
      }

      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('majordhome_supplier_products_write')
        .update(updateData)
        .eq('id', productId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] updateProduct:', error);
      return { data: null, error };
    }
  },

  async deactivateProduct(productId) {
    try {
      if (!productId) throw new Error('[suppliersService] productId requis');

      const { data, error } = await supabase
        .from('majordhome_supplier_products_write')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', productId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] deactivateProduct:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // DOCUMENTS PRODUITS
  // ==========================================================================

  async getProductDocuments(productId) {
    try {
      if (!productId) throw new Error('[suppliersService] productId requis');

      const { data, error } = await supabase
        .from('majordhome_product_documents')
        .select('*')
        .eq('supplier_product_id', productId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getProductDocuments:', error);
      return { data: [], error };
    }
  },

  async getDocumentsByProductIds(productIds) {
    try {
      if (!productIds?.length) return { data: [], error: null };

      const { data, error } = await supabase
        .from('majordhome_product_documents')
        .select('*')
        .in('supplier_product_id', productIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[suppliersService] getDocumentsByProductIds:', error);
      return { data: [], error };
    }
  },

  async uploadProductDocument({ orgId, productId, file, documentType, userId }) {
    try {
      if (!orgId || !productId || !file) {
        throw new Error('[suppliersService] orgId, productId et file requis');
      }

      const fileExt = file.name.split('.').pop();
      const storagePath = `${orgId}/${productId}/${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await storageService.uploadFile(
        'product-documents',
        storagePath,
        file,
        { contentType: file.type }
      );

      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from('majordhome_product_documents_write')
        .insert({
          supplier_product_id: productId,
          org_id: orgId,
          document_type: documentType || 'Manuel',
          file_name: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: userId || null,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[suppliersService] uploadProductDocument:', error);
      return { data: null, error };
    }
  },

  async deleteProductDocument(documentId, storagePath) {
    try {
      if (!documentId) throw new Error('[suppliersService] documentId requis');

      // Supprimer le fichier storage d'abord
      if (storagePath) {
        await storageService.deleteFile('product-documents', storagePath);
      }

      const { error } = await supabase
        .from('majordhome_product_documents_write')
        .delete()
        .eq('id', documentId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[suppliersService] deleteProductDocument:', error);
      return { error };
    }
  },
};
