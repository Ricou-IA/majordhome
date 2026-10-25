// src/apps/artisan/components/devis/devisAnnexesExport.js
// Joint les annexes du devis (fiches techniques des équipements, brochure de l'entreprise — liste calculée par
// src/lib/devisAnnexes.js) à la suite du PDF, via pdf-lib (même méthode que l'étude solaire). Une annexe illisible
// n'empêche jamais le devis : elle est ignorée ET renvoyée dans `ignorees`, pour que l'écran le dise.
import { PDFDocument } from 'pdf-lib';
import { storageService } from '@services/storage.service';
import { logger } from '@lib/logger';

const BUCKET = 'product-documents';

/**
 * @param {Blob} devisBlob PDF du devis
 * @param {Array<{ label: string, storage_path: string }>} annexes
 * @returns {Promise<{ blob: Blob, jointes: string[], ignorees: string[] }>}
 */
export async function joindreAnnexes(devisBlob, annexes = []) {
  if (!annexes.length) return { blob: devisBlob, jointes: [], ignorees: [] };
  const jointes = [];
  const ignorees = [];
  try {
    const merged = await PDFDocument.load(await devisBlob.arrayBuffer());
    for (const a of annexes) {
      try {
        const { url, error } = await storageService.getSignedUrl(BUCKET, a.storage_path, 300);
        if (error || !url) throw error || new Error('lien de téléchargement introuvable');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const src = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        jointes.push(a.label);
      } catch (err) {
        logger.warn(`[devis] annexe « ${a.label} » ignorée`, err);
        ignorees.push(a.label);
      }
    }
    const bytes = await merged.save();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), jointes, ignorees };
  } catch (err) {
    logger.error('[devis] fusion des annexes impossible, devis livré seul', err);
    return { blob: devisBlob, jointes: [], ignorees: annexes.map((a) => a.label) };
  }
}
