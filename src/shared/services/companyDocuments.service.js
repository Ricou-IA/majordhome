/**
 * companyDocuments.service.js — documents de l'entreprise (Settings → Organisation → Identité)
 *
 * Lecture IA d'un document déposé via l'edge `company-document-extract` (org_admin) :
 * renvoie intitulé / numéro / organisme / fin de validité tels qu'écrits sur le document.
 * Rien n'est persisté ici : le résultat va dans `settings.company_documents` via le formulaire.
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, edgeFunctionErrorMessage } from '@/lib/serviceHelpers';

export const companyDocumentsService = {
  /**
   * @param {string} orgId
   * @param {string} kind - clé de COMPANY_DOCUMENT_KINDS
   * @param {string} path - chemin dans le bucket product-documents
   * @returns {Promise<{ data: { lisible: boolean, intitule: string|null, numero: string|null, organisme: string|null, titulaire: string|null, valid_until: string|null }|null, error: Error|null }>}
   */
  async extract(orgId, kind, path) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.functions.invoke('company-document-extract', {
        body: { org_id: orgId, kind, path },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (!data?.extracted) throw new Error('Réponse de lecture vide');
      return data.extracted;
    }, 'companyDocuments.extract');
  },
};
