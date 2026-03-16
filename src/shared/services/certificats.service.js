/**
 * certificats.service.js - Majord'home Artisan
 * ============================================================================
 * Service CRUD pour la table majordhome.certificats.
 * Gère les brouillons, la signature, l'upload PDF vers Storage.
 *
 * Accès via : supabase.from('majordhome_certificats') (vue publique)
 *
 * @version 1.0.0 - Module Certificat d'Entretien & Ramonage
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// SERVICE
// ============================================================================

export const certificatsService = {
  /**
   * Récupère le certificat existant pour une intervention donnée.
   * Retourne null si aucun certificat n'existe.
   */
  async getCertificatByIntervention(interventionId) {
    if (!interventionId) return { data: null, error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .select('*')
        .eq('intervention_id', interventionId)
        .maybeSingle();

      if (error) {
        console.error('[certificats] getCertificatByIntervention error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[certificats] getCertificatByIntervention error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Sauvegarde un brouillon (upsert sur intervention_id).
   * Crée le certificat s'il n'existe pas, sinon le met à jour.
   */
  async saveDraft(formData) {
    if (!formData.intervention_id) {
      return { data: null, error: { message: 'intervention_id requis' } };
    }

    try {
      const payload = {
        intervention_id: formData.intervention_id,
        client_id: formData.client_id,
        equipment_id: formData.equipment_id || null,
        contract_id: formData.contract_id || null,
        org_id: formData.org_id,
        type_document: formData.type_document || 'entretien',

        // Snapshot équipement
        equipement_type: formData.equipement_type,
        equipement_marque: formData.equipement_marque || null,
        equipement_modele: formData.equipement_modele || null,
        equipement_numero_serie: formData.equipement_numero_serie || null,
        equipement_annee: formData.equipement_annee || null,
        equipement_puissance_kw: formData.equipement_puissance_kw || null,
        equipement_fluide: formData.equipement_fluide || null,
        equipement_charge_kg: formData.equipement_charge_kg || null,
        combustible: formData.combustible || null,

        // Données formulaire
        donnees_entretien: formData.donnees_entretien || {},
        donnees_ramonage: formData.donnees_ramonage || null,
        mesures: formData.mesures || {},
        pieces_remplacees: formData.pieces_remplacees || [],

        // Bilan
        bilan_conformite: formData.bilan_conformite || 'conforme',
        anomalies_detail: formData.anomalies_detail || null,
        action_corrective: formData.action_corrective || null,
        recommandations: formData.recommandations || null,
        prochaine_intervention: formData.prochaine_intervention || null,
        tva_taux: formData.tva_taux ?? 5.5,

        // Technicien
        technicien_id: formData.technicien_id || null,
        technicien_nom: formData.technicien_nom || '',
        technicien_certifications: formData.technicien_certifications || [],
        technicien_num_fgaz: formData.technicien_num_fgaz || null,

        // Date
        date_intervention: formData.date_intervention,
        statut: formData.statut || 'brouillon',
        created_by: formData.created_by || null,
      };

      const { data, error } = await supabase
        .from('majordhome_certificats')
        .upsert(payload, { onConflict: 'intervention_id' })
        .select()
        .single();

      if (error) {
        console.error('[certificats] saveDraft error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[certificats] saveDraft error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Signe le certificat : enregistre la signature base64 + passe en statut 'signe'.
   */
  async signCertificat(certificatId, signatureBase64, signataireNom) {
    if (!certificatId) return { data: null, error: { message: 'certificatId requis' } };

    try {
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .update({
          signature_client_base64: signatureBase64,
          signature_client_nom: signataireNom,
          signed_at: new Date().toISOString(),
          statut: 'signe',
        })
        .eq('id', certificatId)
        .select()
        .single();

      if (error) {
        console.error('[certificats] signCertificat error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[certificats] signCertificat error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Met à jour les infos PDF après génération et upload.
   */
  async updatePdfInfo(certificatId, storagePath, pdfUrl) {
    if (!certificatId) return { data: null, error: { message: 'certificatId requis' } };

    try {
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .update({
          pdf_storage_path: storagePath,
          pdf_url: pdfUrl,
          pdf_generated_at: new Date().toISOString(),
        })
        .eq('id', certificatId)
        .select()
        .single();

      if (error) {
        console.error('[certificats] updatePdfInfo error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[certificats] updatePdfInfo error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Upload le PDF dans le bucket Storage.
   * Chemin : {client_id}/{year}/{certificat_id}.pdf
   */
  async uploadPdf(clientId, certificatId, pdfBlob) {
    if (!clientId || !certificatId || !pdfBlob) {
      return { data: null, error: { message: 'clientId, certificatId et pdfBlob requis' } };
    }

    try {
      const year = new Date().getFullYear();
      const storagePath = `${clientId}/${year}/${certificatId}.pdf`;

      const { data, error } = await supabase.storage
        .from('certificats')
        .upload(storagePath, pdfBlob, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf',
        });

      if (error) {
        console.error('[certificats] uploadPdf error:', error);
        return { data: null, error };
      }

      return { data: { path: data.path, storagePath }, error: null };
    } catch (err) {
      console.error('[certificats] uploadPdf error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Génère une URL signée pour le PDF (validité 1 an).
   */
  async getSignedUrl(storagePath) {
    if (!storagePath) return { data: null, error: null };

    try {
      const { data, error } = await supabase.storage
        .from('certificats')
        .createSignedUrl(storagePath, 365 * 24 * 3600); // 1 an

      if (error) {
        console.error('[certificats] getSignedUrl error:', error);
        return { data: null, error };
      }

      return { data: data?.signedUrl || null, error: null };
    } catch (err) {
      console.error('[certificats] getSignedUrl error:', err);
      return { data: null, error: err };
    }
  },
};

export default certificatsService;
