/**
 * devis.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des devis (quotes).
 *
 * Lectures : vues majordhome_quotes (JOIN clients/leads), majordhome_quote_lines
 * Écritures : vues majordhome_quotes_write, majordhome_quote_lines_write
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// CONSTANTES
// ============================================================================

export const QUOTE_STATUSES = [
  { value: 'brouillon', label: 'Brouillon', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: 'FileEdit' },
  { value: 'envoye', label: 'Envoyé', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: 'Send' },
  { value: 'accepte', label: 'Accepté', color: 'bg-green-100 text-green-700 border-green-200', icon: 'CheckCircle' },
  { value: 'refuse', label: 'Refusé', color: 'bg-red-100 text-red-700 border-red-200', icon: 'XCircle' },
  { value: 'expire', label: 'Expiré', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: 'Clock' },
];

export const TVA_RATES = [
  { value: 20, label: '20% (standard)', description: 'Équipement neuf' },
  { value: 10, label: '10% (intermédiaire)', description: 'Pose / main d\'œuvre rénovation' },
  { value: 5.5, label: '5,5% (réduit)', description: 'Matériel rénovation énergétique éligible' },
];

export const QUOTE_TEMPLATE_FAMILIES = [
  'Poêle à Granulé',
  'Poêle à Bois',
  'Climatisation',
  'Chauffage/PAC',
  'Electricité',
  'VMC',
  'Autre',
];

// Sections prédéfinies par famille (auto-créées si pas de devis type)
export const FAMILY_DEFAULT_SECTIONS = {
  'Poêle à Granulé': ['POÊLE', 'FUMISTERIE', 'ÉLÉMENTS SÉCURITÉ', 'MAIN D\'ŒUVRE'],
  'Poêle à Bois': ['POÊLE', 'FUMISTERIE', 'ÉLÉMENTS SÉCURITÉ', 'MAIN D\'ŒUVRE'],
  'Climatisation': ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE'],
  'Chauffage/PAC': ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE'],
  'Electricité': ['MATÉRIEL', 'MAIN D\'ŒUVRE'],
  'VMC': ['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE'],
  'Autre': ['PRESTATIONS', 'MAIN D\'ŒUVRE'],
};

export function buildDefaultSections(family) {
  const sections = FAMILY_DEFAULT_SECTIONS[family];
  if (!sections) return [];
  return sections.map((name) => ({
    line_type: 'section_title',
    designation: name,
    quantity: 0,
    unit_price_ht: 0,
    tva_rate: 0,
  }));
}

export const LINE_TYPES = [
  { value: 'product', label: 'Produit' },
  { value: 'labor', label: 'Main d\'œuvre' },
  { value: 'section_title', label: 'Titre de section' },
];

// ============================================================================
// HELPERS CALCUL
// ============================================================================

/**
 * Calcule les totaux d'une ligne de devis
 */
export function computeLineTotals(line) {
  if (line.line_type === 'section_title') {
    return { total_ht: 0, total_tva: 0, total_ttc: 0 };
  }
  const qty = parseFloat(line.quantity) || 0;
  const unitPrice = parseFloat(line.unit_price_ht) || 0;
  const tvaRate = parseFloat(line.tva_rate) || 0;

  const totalHt = Math.round(qty * unitPrice * 100) / 100;
  const totalTva = Math.round(totalHt * tvaRate / 100 * 100) / 100;
  const totalTtc = Math.round((totalHt + totalTva) * 100) / 100;

  return { total_ht: totalHt, total_tva: totalTva, total_ttc: totalTtc };
}

/**
 * Calcule les totaux globaux du devis avec ventilation TVA
 */
export function computeQuoteTotals(lines, globalDiscountPercent = 0) {
  const discount = parseFloat(globalDiscountPercent) || 0;

  // Somme par taux de TVA
  const tvaBreakdown = {};
  let subtotalHt = 0;

  for (const line of lines) {
    if (line.line_type === 'section_title') continue;
    const { total_ht, total_tva } = computeLineTotals(line);
    subtotalHt += total_ht;

    const rate = parseFloat(line.tva_rate) || 0;
    if (!tvaBreakdown[rate]) {
      tvaBreakdown[rate] = { rate, base_ht: 0, tva_amount: 0 };
    }
    tvaBreakdown[rate].base_ht += total_ht;
    tvaBreakdown[rate].tva_amount += total_tva;
  }

  // Remise globale
  const discountAmount = Math.round(subtotalHt * discount / 100 * 100) / 100;
  const totalHtAfterDiscount = Math.round((subtotalHt - discountAmount) * 100) / 100;

  // Appliquer la remise proportionnellement sur chaque tranche TVA
  const ratio = subtotalHt > 0 ? totalHtAfterDiscount / subtotalHt : 0;
  let totalTva = 0;
  const tvaDetails = Object.values(tvaBreakdown).map((t) => {
    const adjustedBase = Math.round(t.base_ht * ratio * 100) / 100;
    const adjustedTva = Math.round(adjustedBase * t.rate / 100 * 100) / 100;
    totalTva += adjustedTva;
    return { rate: t.rate, base_ht: adjustedBase, tva_amount: adjustedTva };
  });

  totalTva = Math.round(totalTva * 100) / 100;
  const totalTtc = Math.round((totalHtAfterDiscount + totalTva) * 100) / 100;

  return {
    subtotal_ht: subtotalHt,
    discount_amount: discountAmount,
    total_ht: totalHtAfterDiscount,
    total_tva: totalTva,
    total_ttc: totalTtc,
    tva_breakdown: tvaDetails,
  };
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const devisService = {
  // ==========================================================================
  // LECTURE
  // ==========================================================================

  async getQuotes({ orgId, status, limit = 50, offset = 0 } = {}) {
    try {
      if (!orgId) throw new Error('[devisService] orgId requis');

      let query = supabase
        .from('majordhome_quotes')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);

      const { data, count, error } = await query;
      if (error) throw error;
      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      console.error('[devisService] getQuotes:', error);
      return { data: [], count: 0, error };
    }
  },

  async getQuoteById(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes')
        .select('*')
        .eq('id', quoteId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] getQuoteById:', error);
      return { data: null, error };
    }
  },

  async getQuotesByLead(leadId) {
    try {
      if (!leadId) throw new Error('[devisService] leadId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[devisService] getQuotesByLead:', error);
      return { data: [], error };
    }
  },

  async getQuotesByClient(clientId) {
    try {
      if (!clientId) throw new Error('[devisService] clientId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[devisService] getQuotesByClient:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // LIGNES
  // ==========================================================================

  async getQuoteLines(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quote_lines')
        .select('*')
        .eq('quote_id', quoteId)
        .order('sort_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[devisService] getQuoteLines:', error);
      return { data: [], error };
    }
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  async createQuote({ orgId, leadId, clientId, subject, validityDays = 30, conditions, notesInternes, globalDiscountPercent = 0, lines = [], createdBy }) {
    try {
      if (!orgId) throw new Error('[devisService] orgId requis');

      // Calculer les totaux
      const totals = computeQuoteTotals(lines, globalDiscountPercent);

      // 1. Créer le devis
      const { data: quote, error: quoteError } = await supabase
        .from('majordhome_quotes_write')
        .insert({
          org_id: orgId,
          lead_id: leadId || null,
          client_id: clientId || null,
          subject: subject || null,
          validity_days: validityDays,
          conditions: conditions || null,
          notes_internes: notesInternes || null,
          global_discount_percent: globalDiscountPercent,
          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          created_by: createdBy || null,
        })
        .select()
        .single();

      if (quoteError) throw quoteError;

      // 2. Créer les lignes
      if (lines.length > 0) {
        const lineRows = lines.map((line, index) => {
          const lineTotals = computeLineTotals(line);
          return {
            quote_id: quote.id,
            sort_order: index,
            line_type: line.line_type || 'product',
            supplier_product_id: line.supplier_product_id || null,
            supplier_id: line.supplier_id || null,
            designation: line.designation,
            description: line.description || null,
            reference: line.reference || null,
            quantity: parseFloat(line.quantity) || 1,
            unit: line.unit || 'pièce',
            purchase_price_ht: line.purchase_price_ht ? parseFloat(line.purchase_price_ht) : null,
            unit_price_ht: parseFloat(line.unit_price_ht) || 0,
            tva_rate: parseFloat(line.tva_rate) || 20,
            total_ht: lineTotals.total_ht,
            total_tva: lineTotals.total_tva,
            total_ttc: lineTotals.total_ttc,
          };
        });

        const { error: linesError } = await supabase
          .from('majordhome_quote_lines_write')
          .insert(lineRows);

        if (linesError) throw linesError;
      }

      return { data: quote, error: null };
    } catch (error) {
      console.error('[devisService] createQuote:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  async updateQuote(quoteId, updates = {}) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const updateData = {};
      if (updates.subject !== undefined) updateData.subject = updates.subject || null;
      if (updates.validityDays !== undefined) updateData.validity_days = parseInt(updates.validityDays) || 30;
      if (updates.conditions !== undefined) updateData.conditions = updates.conditions || null;
      if (updates.notesInternes !== undefined) updateData.notes_internes = updates.notesInternes || null;
      if (updates.globalDiscountPercent !== undefined) updateData.global_discount_percent = parseFloat(updates.globalDiscountPercent) || 0;
      if (updates.totalHt !== undefined) updateData.total_ht = parseFloat(updates.totalHt) || 0;
      if (updates.totalTva !== undefined) updateData.total_tva = parseFloat(updates.totalTva) || 0;
      if (updates.totalTtc !== undefined) updateData.total_ttc = parseFloat(updates.totalTtc) || 0;

      const { data, error } = await supabase
        .from('majordhome_quotes_write')
        .update(updateData)
        .eq('id', quoteId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] updateQuote:', error);
      return { data: null, error };
    }
  },

  /**
   * Replace toutes les lignes d'un devis + recalcul totaux
   */
  async upsertQuoteLines(quoteId, lines = [], globalDiscountPercent = 0) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      // 1. Supprimer les anciennes lignes
      const { error: deleteError } = await supabase
        .from('majordhome_quote_lines_write')
        .delete()
        .eq('quote_id', quoteId);

      if (deleteError) throw deleteError;

      // 2. Insérer les nouvelles
      if (lines.length > 0) {
        const lineRows = lines.map((line, index) => {
          const lineTotals = computeLineTotals(line);
          return {
            quote_id: quoteId,
            sort_order: index,
            line_type: line.line_type || 'product',
            supplier_product_id: line.supplier_product_id || null,
            supplier_id: line.supplier_id || null,
            designation: line.designation,
            description: line.description || null,
            reference: line.reference || null,
            quantity: parseFloat(line.quantity) || 1,
            unit: line.unit || 'pièce',
            purchase_price_ht: line.purchase_price_ht ? parseFloat(line.purchase_price_ht) : null,
            unit_price_ht: parseFloat(line.unit_price_ht) || 0,
            tva_rate: parseFloat(line.tva_rate) || 20,
            total_ht: lineTotals.total_ht,
            total_tva: lineTotals.total_tva,
            total_ttc: lineTotals.total_ttc,
          };
        });

        const { error: insertError } = await supabase
          .from('majordhome_quote_lines_write')
          .insert(lineRows);

        if (insertError) throw insertError;
      }

      // 3. Recalculer les totaux du devis
      const totals = computeQuoteTotals(lines, globalDiscountPercent);
      const { error: updateError } = await supabase
        .from('majordhome_quotes_write')
        .update({
          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          global_discount_percent: globalDiscountPercent,
        })
        .eq('id', quoteId);

      if (updateError) throw updateError;

      return { data: { lines: lines.length, totals }, error: null };
    } catch (error) {
      console.error('[devisService] upsertQuoteLines:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // TRANSITIONS DE STATUT
  // ==========================================================================

  async sendQuote(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes_write')
        .update({ status: 'envoye', sent_at: new Date().toISOString() })
        .eq('id', quoteId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] sendQuote:', error);
      return { data: null, error };
    }
  },

  async acceptQuote(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes_write')
        .update({ status: 'accepte', accepted_at: new Date().toISOString() })
        .eq('id', quoteId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] acceptQuote:', error);
      return { data: null, error };
    }
  },

  async refuseQuote(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes_write')
        .update({ status: 'refuse', refused_at: new Date().toISOString() })
        .eq('id', quoteId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] refuseQuote:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  async deleteQuote(quoteId) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { error } = await supabase
        .from('majordhome_quotes_write')
        .delete()
        .eq('id', quoteId);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      console.error('[devisService] deleteQuote:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // DUPLICATION
  // ==========================================================================

  async duplicateQuote(quoteId, orgId) {
    try {
      if (!quoteId || !orgId) throw new Error('[devisService] quoteId et orgId requis');

      // 1. Récupérer le devis original
      const { data: original, error: fetchError } = await supabase
        .from('majordhome_quotes')
        .select('*')
        .eq('id', quoteId)
        .single();

      if (fetchError) throw fetchError;

      // 2. Récupérer les lignes
      const { data: originalLines, error: linesError } = await supabase
        .from('majordhome_quote_lines')
        .select('*')
        .eq('quote_id', quoteId)
        .order('sort_order');

      if (linesError) throw linesError;

      // 3. Créer le nouveau devis (quote_number auto-généré)
      const { data: newQuote, error: createError } = await supabase
        .from('majordhome_quotes_write')
        .insert({
          org_id: orgId,
          lead_id: original.lead_id,
          client_id: original.client_id,
          status: 'brouillon',
          subject: original.subject ? `${original.subject} (copie)` : 'Copie',
          validity_days: original.validity_days,
          global_discount_percent: original.global_discount_percent,
          conditions: original.conditions,
          notes_internes: original.notes_internes,
          total_ht: original.total_ht,
          total_tva: original.total_tva,
          total_ttc: original.total_ttc,
          created_by: original.created_by,
        })
        .select()
        .single();

      if (createError) throw createError;

      // 4. Dupliquer les lignes
      if (originalLines && originalLines.length > 0) {
        const newLines = originalLines.map((line) => ({
          quote_id: newQuote.id,
          sort_order: line.sort_order,
          line_type: line.line_type,
          supplier_product_id: line.supplier_product_id,
          supplier_id: line.supplier_id,
          designation: line.designation,
          description: line.description,
          reference: line.reference,
          quantity: line.quantity,
          unit: line.unit,
          purchase_price_ht: line.purchase_price_ht,
          unit_price_ht: line.unit_price_ht,
          tva_rate: line.tva_rate,
          total_ht: line.total_ht,
          total_tva: line.total_tva,
          total_ttc: line.total_ttc,
        }));

        const { error: dupLinesError } = await supabase
          .from('majordhome_quote_lines_write')
          .insert(newLines);

        if (dupLinesError) throw dupLinesError;
      }

      return { data: newQuote, error: null };
    } catch (error) {
      console.error('[devisService] duplicateQuote:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // PDF
  // ==========================================================================

  async saveQuotePdfPath(quoteId, pdfPath) {
    try {
      if (!quoteId) throw new Error('[devisService] quoteId requis');

      const { data, error } = await supabase
        .from('majordhome_quotes_write')
        .update({ quote_pdf_path: pdfPath })
        .eq('id', quoteId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] saveQuotePdfPath:', error);
      return { data: null, error };
    }
  },

  async getQuotePdfUrl(pdfPath) {
    try {
      if (!pdfPath) throw new Error('[devisService] pdfPath requis');

      const { data, error } = await supabase
        .storage
        .from('quotes')
        .createSignedUrl(pdfPath, 3600);

      if (error) throw error;
      return { url: data?.signedUrl, error: null };
    } catch (error) {
      console.error('[devisService] getQuotePdfUrl:', error);
      return { url: null, error };
    }
  },

  async uploadQuotePdf(quoteId, pdfBlob, orgId) {
    try {
      if (!quoteId || !pdfBlob) throw new Error('[devisService] quoteId et pdfBlob requis');

      const filePath = `${orgId}/${quoteId}.pdf`;

      const { error: uploadError } = await supabase
        .storage
        .from('quotes')
        .upload(filePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Mettre à jour le chemin dans le devis
      await devisService.saveQuotePdfPath(quoteId, filePath);

      return { data: filePath, error: null };
    } catch (error) {
      console.error('[devisService] uploadQuotePdf:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // TEMPLATES (Devis Types)
  // ==========================================================================

  async getTemplates(orgId) {
    try {
      if (!orgId) throw new Error('[devisService] orgId requis');
      const { data, error } = await supabase
        .from('majordhome_quote_templates')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[devisService] getTemplates:', error);
      return { data: [], error };
    }
  },

  async createTemplate({ orgId, userId, name, description, family, lines, globalDiscountPercent }) {
    try {
      if (!orgId || !name) throw new Error('[devisService] orgId et name requis');

      const { data, error } = await supabase
        .from('majordhome_quote_templates_write')
        .insert({
          org_id: orgId,
          created_by: userId,
          name,
          description: description || null,
          family: family || null,
          lines: JSON.stringify(lines),
          global_discount_percent: globalDiscountPercent || 0,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[devisService] createTemplate:', error);
      return { data: null, error };
    }
  },

  async deleteTemplate(templateId) {
    try {
      const { error } = await supabase
        .from('majordhome_quote_templates_write')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', templateId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[devisService] deleteTemplate:', error);
      return { error };
    }
  },
};
