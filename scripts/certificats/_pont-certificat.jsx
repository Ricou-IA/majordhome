/**
 * Pont Node ↔ code de l'app pour les scripts certificats.
 * ============================================================================
 * Point d'entrée bundlé par esbuild (cf. regenerer-pdf-manquants.mjs) :
 * - rend le VRAI gabarit `CertificatDocument` hors navigateur (renderToStream) ;
 * - ré-exporte les services de l'app, branchés sur le client service_role
 *   (`_supabase-service-role.mjs` remplace `src/lib/supabaseClient.js`).
 *
 * Aucune logique métier ici : tout vient de `src/`.
 * ============================================================================
 */
import { renderToStream } from '@react-pdf/renderer';
import { CertificatDocument } from '@/apps/artisan/components/certificat/CertificatPDF';

export { savService } from '@/shared/services/sav.service';
export { certificatsService } from '@/shared/services/certificats.service';
export { equipmentCategoriesService } from '@/shared/services/equipmentCategories.service';
export { buildCompanyInfo } from '@/lib/orgBranding';
export { indexReferentiel } from '@/lib/equipmentReferential';
export { supabase } from '@/lib/supabaseClient';

/**
 * Rend le certificat en PDF (Buffer), avec le même composant que l'app.
 * @param {object} data    - mêmes champs que `pdfData` du CertificatWizard
 * @param {object} company - `buildCompanyInfo(settings)`
 * @returns {Promise<Buffer>}
 */
export async function renderCertificatPdf(data, company) {
  const stream = await renderToStream(<CertificatDocument data={data} company={company} />);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
