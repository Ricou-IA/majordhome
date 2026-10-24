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
import { motifAbsencePhoto } from '@/lib/certificatAnomalies';
import { logger } from '@/lib/logger';
import { attestationPathFor } from '@/lib/attestationEntretienModel';

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
        // Photo de la plaque signalétique (2026-10-12) : chemin posé par uploadPhotoPlaque ;
        // shunt = motif non NULL (coché sans texte ⇒ « Non précisé »).
        photo_plaque_path: formData.photo_plaque_path || null,
        photo_plaque_absence: formData.photo_plaque_absence == null ? null : motifAbsencePhoto(formData.photo_plaque_absence),
        recommandations: formData.recommandations || null,
        prochaine_intervention: formData.prochaine_intervention
          ? (formData.prochaine_intervention.length === 7 ? `${formData.prochaine_intervention}-01` : formData.prochaine_intervention)
          : null,
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
   * Chemin (multi-tenant P0.0.7) : {org_id}/{client_id}/{year}/{certificat_id}.pdf
   * Le préfixe org_id est exigé par la storage RLS policy.
   */
  async uploadPdf(orgId, clientId, certificatId, pdfBlob) {
    if (!orgId || !clientId || !certificatId || !pdfBlob) {
      return { data: null, error: { message: 'orgId, clientId, certificatId et pdfBlob requis' } };
    }

    try {
      const year = new Date().getFullYear();
      const storagePath = `${orgId}/${clientId}/${year}/${certificatId}.pdf`;

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
   * Attestation d'entretien et de ramonage — même bucket, à côté du PDF du certificat
   * (`attestationPathFor(pdf_storage_path)`, upsert : une refacturation régénère la lettre).
   * @param {string} storagePath
   * @param {Blob} pdfBlob
   */
  async uploadAttestation(storagePath, pdfBlob) {
    if (!storagePath || !pdfBlob) return { data: null, error: { message: 'storagePath et pdfBlob requis' } };
    try {
      const { error } = await supabase.storage
        .from('certificats')
        .upload(storagePath, pdfBlob, { cacheControl: '3600', upsert: true, contentType: 'application/pdf' });
      if (error) {
        logger.error('[certificats] uploadAttestation error:', error);
        return { data: null, error };
      }
      return { data: { storagePath }, error: null };
    } catch (err) {
      logger.error('[certificats] uploadAttestation error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Interventions enfants (1 par équipement) d'une carte, avec leur équipement — pour repérer
   * un équipement dont le certificat n'a jamais été rempli.
   * @param {string} interventionId
   */
  async listChildInterventions(interventionId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .select('id, equipment_id')
        .eq('parent_id', interventionId);
      if (error) return { data: null, error };
      return { data: data || [], error: null };
    } catch (err) {
      logger.error('[certificats] listChildInterventions error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Chemin de l'attestation d'une intervention si elle a été générée (null sinon).
   * @param {string} interventionId
   * @returns {Promise<{ data: string|null, error: object|null }>}
   */
  async findAttestationPath(interventionId) {
    try {
      const { data: cert, error } = await this.getCertificatByIntervention(interventionId);
      if (error) return { data: null, error };
      const path = attestationPathFor(cert?.pdf_storage_path);
      if (!path) return { data: null, error: null };
      const slash = path.lastIndexOf('/');
      const { data: files, error: listErr } = await supabase.storage
        .from('certificats')
        .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
      if (listErr) return { data: null, error: listErr };
      return { data: (files || []).some((f) => f.name === path.slice(slash + 1)) ? path : null, error: null };
    } catch (err) {
      logger.error('[certificats] findAttestationPath error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Photo de la plaque signalétique — même bucket que le PDF, à côté de lui :
   * {org_id}/{client_id}/{year}/{certificat_id}-plaque.jpg (upsert : reprendre la photo remplace).
   * @returns {{ data: { storagePath }|null, error }}
   */
  async uploadPhotoPlaque(orgId, clientId, certificatId, blob) {
    if (!orgId || !clientId || !certificatId || !blob) {
      return { data: null, error: { message: 'orgId, clientId, certificatId et blob requis' } };
    }
    try {
      const year = new Date().getFullYear();
      const storagePath = `${orgId}/${clientId}/${year}/${certificatId}-plaque.jpg`;
      const { error } = await supabase.storage
        .from('certificats')
        .upload(storagePath, blob, { cacheControl: '3600', upsert: true, contentType: 'image/jpeg' });
      if (error) {
        console.error('[certificats] uploadPhotoPlaque error:', error);
        return { data: null, error };
      }
      return { data: { storagePath }, error: null };
    } catch (err) {
      console.error('[certificats] uploadPhotoPlaque error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Enregistre (ou efface) la photo de plaque sur le certificat. Poser une photo lève le shunt.
   * @param {string} certificatId
   * @param {{ photoPlaquePath: string|null }} params
   */
  async setPhotoPlaque(certificatId, { photoPlaquePath }) {
    if (!certificatId) return { data: null, error: { message: 'certificatId requis' } };
    try {
      const patch = { photo_plaque_path: photoPlaquePath || null };
      if (photoPlaquePath) patch.photo_plaque_absence = null;
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .update(patch)
        .eq('id', certificatId)
        .select('id, intervention_id, photo_plaque_path, photo_plaque_absence')
        .single();
      if (error) {
        console.error('[certificats] setPhotoPlaque error:', error);
        return { data: null, error };
      }
      return { data, error: null };
    } catch (err) {
      console.error('[certificats] setPhotoPlaque error:', err);
      return { data: null, error: err };
    }
  },

  /** Supprime le fichier de la photo de plaque (le certificat est mis à jour par setPhotoPlaque). */
  async deletePhotoPlaque(storagePath) {
    if (!storagePath) return { data: null, error: null };
    try {
      const { error } = await supabase.storage.from('certificats').remove([storagePath]);
      if (error) {
        console.error('[certificats] deletePhotoPlaque error:', error);
        return { data: null, error };
      }
      return { data: true, error: null };
    } catch (err) {
      console.error('[certificats] deletePhotoPlaque error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Génère une URL signée pour le PDF ou la photo de plaque (validité 1 an).
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

  /**
   * Certificats de l'intervention ET de ses interventions enfants (1 par équipement,
   * `parent_id`) — liste des pièces joignables à l'e-mail de facture (module Communication).
   * @param {string} orgId  org core
   * @param {string} interventionId
   */
  async listForInterventionTree(orgId, interventionId) {
    try {
      const { data: children, error: childErr } = await supabase
        .from('majordhome_interventions').select('id').eq('parent_id', interventionId);
      if (childErr) return { data: null, error: childErr };
      const ids = [interventionId, ...(children || []).map((c) => c.id)];
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .select('id, intervention_id, equipment_id, client_id, reference, equipement_type, equipement_marque, equipement_modele, statut, signed_at, pdf_storage_path, pdf_generated_at, date_intervention, bilan_conformite, donnees_entretien, donnees_ramonage')
        .eq('org_id', orgId)
        .in('intervention_id', ids)
        .order('created_at', { ascending: true });
      if (error) return { data: null, error };
      return { data: data || [], error: null };
    } catch (err) {
      logger.error('[certificats] listForInterventionTree error:', err);
      return { data: null, error: err };
    }
  },
};

export default certificatsService;
