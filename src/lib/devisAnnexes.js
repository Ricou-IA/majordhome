// src/lib/devisAnnexes.js
// Annexes jointes à la suite du PDF d'un devis — module PUR, testé (scripts/devis-annexes.test.mjs). Demande d'Eric
// (2026-10-25) : la fiche technique de chaque équipement si elle existe, puis la brochure de l'entreprise si elle est
// déposée (Réglages → Devis, settings.devis.brochure). Le téléchargement et la fusion sont dans devisAnnexesExport.js.
import { blocs } from './devisOrdre.js';

const estPdf = (d) => d?.mime_type === 'application/pdf' || /\.pdf$/i.test(d?.file_name || d?.storage_path || '');
const estFiche = (d) => /fiche/i.test(d?.document_type || '');

/**
 * Articles posés dans les chapitres de type « equipement », sans doublon, dans l'ordre du devis.
 * @param {Array<{ line_type: string, designation?: string, catalog_item_id?: string | null }>} lines
 * @param {(titre: string) => string} typeDe type d'un chapitre depuis son titre (typeChapitre de devisConfig)
 * @returns {string[]}
 */
export function articlesEquipement(lines, typeDe) {
  const ids = [];
  for (const b of blocs(lines)) {
    if (!b.titre || typeDe(b.titre.designation || '') !== 'equipement') continue;
    for (const l of b.lignes) if (l.catalog_item_id && !ids.includes(l.catalog_item_id)) ids.push(l.catalog_item_id);
  }
  return ids;
}

/**
 * Annexes à joindre, dans l'ordre : une fiche technique PDF par équipement (document de l'article avant celui d'une
 * ligne fournisseur), puis la brochure.
 * @param {{ lines: object[], typeDe: (titre: string) => string,
 *   documents: Array<{ item_id: string, origine?: string, document_type?: string, mime_type?: string, storage_path: string, file_name?: string }>,
 *   brochure: { storage_path: string, file_name?: string } | null }} p
 * @returns {Array<{ label: string, storage_path: string }>}
 */
export function annexesDevis({ lines, typeDe, documents, brochure }) {
  const out = [];
  for (const id of articlesEquipement(lines, typeDe)) {
    const fiches = (documents || []).filter((d) => d.item_id === id && estFiche(d) && estPdf(d) && d.storage_path)
      .sort((a, b) => (a.origine === 'article' ? 0 : 1) - (b.origine === 'article' ? 0 : 1));
    if (fiches[0]) out.push({ label: fiches[0].file_name || 'Fiche technique', storage_path: fiches[0].storage_path });
  }
  if (brochure?.storage_path) out.push({ label: brochure.file_name || 'Brochure', storage_path: brochure.storage_path });
  return out;
}
