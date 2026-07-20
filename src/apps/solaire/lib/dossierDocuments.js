// src/apps/solaire/lib/dossierDocuments.js
// Helper PUR du modèle `pv_dossiers.documents` orienté-pièces (tranche 3) :
//   documents: { cerfa: { path, generated_at, kind }, notice: {…}, plan_situation: {…},
//                plan_masse: {…}, assembled: {…} }
// Rétro-compat : lit aussi l'ancien couple figé { cerfa_pdf_path, notice_pdf_path,
// generated_at } — les dossiers existants se re-normalisent à la prochaine génération.

/** Libellés d'affichage des pièces connues (ordre = ordre réglementaire d'assemblage). */
export const DOSSIER_PIECES = [
  { key: 'cerfa', label: 'CERFA 16702' },
  { key: 'notice', label: 'Notice descriptive' },
  { key: 'plan_situation', label: 'Plan de situation (DPC1)' },
  { key: 'plan_masse', label: 'Plan de masse (DPC2)' },
];

/** Chemin Storage d'une pièce — nouveau modèle d'abord, fallback legacy. */
export function docPath(documents, key) {
  return documents?.[key]?.path ?? documents?.[`${key}_pdf_path`] ?? null;
}

/** Date de génération la plus récente parmi les pièces (fallback legacy `generated_at`). */
export function docsGeneratedAt(documents) {
  if (!documents) return null;
  const dates = Object.values(documents)
    .map((v) => (v && typeof v === 'object' ? v.generated_at : null))
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] ?? documents.generated_at ?? null;
}
