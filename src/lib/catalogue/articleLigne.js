// src/lib/catalogue/articleLigne.js
// Ce que l'article Majord'home apporte à une ligne fournisseur sur la fiche du fournisseur — module PUR, testé
// (scripts/catalogue/article-ligne.test.mjs). L'enrichissement (photo, documents, autres fournisseurs) vit sur
// l'ARTICLE ; la ligne ne le recopie pas : la fiche le lit (retour d'Eric, 2026-10-25).

/**
 * Photo à montrer pour une ligne : la sienne, sinon celle de son article.
 * @param {{ image_url?: string | null }} ligne
 * @param {{ image_url?: string | null } | null | undefined} article
 * @returns {string | null}
 */
export function photoDeLigne(ligne, article) {
  return ligne?.image_url || article?.image_url || null;
}

/**
 * Autres fournisseurs de l'article (colonne `fournisseurs` de la vue liste : texte séparé par des virgules ou
 * tableau), hors le fournisseur de la fiche, sans doublon (casse ignorée).
 * @param {string | string[] | null | undefined} fournisseurs
 * @param {string} fournisseurCourant
 * @returns {string[]}
 */
export function autresFournisseurs(fournisseurs, fournisseurCourant) {
  const liste = Array.isArray(fournisseurs) ? fournisseurs : String(fournisseurs || '').split(',');
  const vus = new Set([String(fournisseurCourant || '').trim().toLowerCase()]);
  const out = [];
  for (const f of liste) {
    const nom = String(f || '').trim();
    const cle = nom.toLowerCase();
    if (!nom || vus.has(cle)) continue;
    vus.add(cle);
    out.push(nom);
  }
  return out;
}
