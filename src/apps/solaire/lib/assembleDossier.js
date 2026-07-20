// src/apps/solaire/lib/assembleDossier.js
// Fusion des pièces du dossier PV en un PDF unique (ordre réglementaire :
// CERFA → notice → DPC1 → DPC2). Une pièce illisible est ignorée mais SURFACÉE
// (`skipped`) — jamais d'échec silencieux ; toutes illisibles → throw.
import { PDFDocument } from 'pdf-lib';
import { logger } from '@lib/logger';

/**
 * @param {Array<{ label: string, blob: Blob }>} parts pièces dans l'ordre d'assemblage
 * @returns {Promise<{ blob: Blob, skipped: string[] }>}
 */
export async function assembleDossierBlob(parts) {
  const merged = await PDFDocument.create();
  const skipped = [];
  let added = 0;
  for (const part of parts ?? []) {
    if (!part?.blob) {
      if (part?.label) skipped.push(part.label);
      continue;
    }
    try {
      const src = await PDFDocument.load(await part.blob.arrayBuffer(), { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
      added += 1;
    } catch (err) {
      skipped.push(part.label);
      logger.warn(`[dossier] pièce « ${part.label} » illisible à l'assemblage`, err);
    }
  }
  if (!added) throw new Error('Assemblage impossible : aucune pièce lisible');
  const bytes = await merged.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), skipped };
}
