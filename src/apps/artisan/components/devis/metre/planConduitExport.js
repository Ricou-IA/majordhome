// src/apps/artisan/components/devis/metre/planConduitExport.js
// Point d'entrée UNIQUE du plan du conduit d'un devis (annexe du PDF « offre », et « fiche chantier »
// imprimée depuis le devis) : métré ENREGISTRÉ → contexte → modèle pur → PDF. Ne lève jamais : un
// plan qui échoue n'empêche pas le devis, l'appelant dit ce qui manque.
import { fumisterieService } from '@services/fumisterie.service';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { fetchAsDataUrl } from '@/lib/imageDataUrl';
import { buildPlanModel } from '@/lib/fumisterie/planModel.js';
import { logger } from '@lib/logger';

/**
 * @param {{ orgId: string, quote: object, settings: object, variante: 'offre'|'chantier' }} p
 * @returns {Promise<{ blob: Blob|null, raison: null|'sans_metre'|'erreur', message?: string, logoManquant?: boolean }>}
 */
export async function genererPlanConduit({ orgId, quote, settings, variante }) {
  try {
    const { data: metre, error } = await fumisterieService.getMetreByQuote(orgId, quote?.id);
    if (error) throw error;
    if (!metre) return { blob: null, raison: 'sans_metre' };
    const { data: contexte, error: e2 } = await fumisterieService.getPlanContexte(orgId, metre);
    if (e2) throw e2;
    const company = buildCompanyInfo(settings);
    const model = buildPlanModel({ metre, configuration: contexte.configuration, gabarit: contexte.gabarit, company, devis: quote,
      auteurNom: contexte.auteurNom, fournisseurNom: contexte.fournisseurNom, variante });
    const logoDataUrl = await fetchAsDataUrl(company.logoUrl);
    model.cartouche.entreprise.logoDataUrl = logoDataUrl;
    const { generatePlanConduitPdfBlob } = await import('./pdf/PlanConduitPDF');
    const blob = await generatePlanConduitPdfBlob(model);
    return { blob, raison: null, logoManquant: !!company.logoUrl && !logoDataUrl };
  } catch (err) {
    logger.error('[plan du conduit]', err);
    return { blob: null, raison: 'erreur', message: err?.message || String(err) };
  }
}
