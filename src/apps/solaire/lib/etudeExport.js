// src/apps/solaire/lib/etudeExport.js
// Export de l'étude PDF : sélection des fiches techniques (bibliothèque
// technique, settings.pv.tech_docs), fusion des annexes via pdf-lib,
// téléchargement. Une annexe illisible est ignorée (warn), jamais bloquante.
import { PDFDocument } from 'pdf-lib';
import { logger } from '@lib/logger';
import { storageService } from '@services/storage.service';

// Bucket existant (policies org-scoped `${orgId}/...` déjà en place — P0.0.7)
export const TECH_DOCS_BUCKET = 'product-documents';

/**
 * Fiches à joindre à une étude :
 * - `attach` coché dans la bibliothèque
 * - les fiches « borne » uniquement si l'option borne est active dans la simulation
 */
export function selectAnnexDocs(config, inputs) {
  const docs = Array.isArray(config.tech_docs) ? config.tech_docs : [];
  return docs.filter(
    (d) => d.attach && d.path && (d.kind !== 'borne' || (inputs.ev?.enabled && inputs.ev?.addCharger)),
  );
}

/** Fusionne les fiches techniques (PDF Storage) à la suite du blob étude. */
export async function attachAnnexes(studyBlob, annexDocs) {
  if (!annexDocs?.length) return studyBlob;
  try {
    const merged = await PDFDocument.load(await studyBlob.arrayBuffer());
    for (const doc of annexDocs) {
      try {
        const { url, error } = await storageService.getSignedUrl(TECH_DOCS_BUCKET, doc.path);
        if (error || !url) throw error || new Error('URL signée introuvable');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const src = await PDFDocument.load(await res.arrayBuffer(), { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } catch (err) {
        logger.warn(`[etude] annexe « ${doc.label} » ignorée`, err);
      }
    }
    const bytes = await merged.save();
    return new Blob([bytes], { type: 'application/pdf' });
  } catch (err) {
    // Fusion impossible → on livre l'étude seule plutôt que rien
    logger.error('[etude] fusion des annexes impossible, étude livrée seule', err);
    return studyBlob;
  }
}

export function buildEtudeFilename(clientName) {
  const slug = (clientName || 'client')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'client';
  const date = new Date().toISOString().slice(0, 10);
  return `etude-pv-${slug}-${date}.pdf`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
