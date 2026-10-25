// scripts/catalogue/prix-publics.js
// Prix publics d'un fournisseur relevés sur son site (scripts/catalogue/data/prix-publics/<fournisseur>-<date>.json) —
// module PUR, testé scripts/catalogue/prix-publics.test.mjs. Décision d'Eric (2026-10-25) : « prix de vente = prix
// public pour l'instant, on fera une remise sur le devis » — même règle que le « Prix de base » Soditelem (2026-10-24).
// Ici : relecture du relevé (prix affiché « 4 107,46 » → nombre), ramené à l'unité de la base quand le site affiche
// une autre unité (diviseur : kilomètre → mètre, sachet de 100 → pièce), et rapport des écartés (absent du site, code
// qui désigne un autre produit). L'écriture (SQL rejouable) est faite par import-prix-publics.mjs.

/**
 * @param {string|number|null|undefined} v prix affiché (« 4107,46 », « 6 601,32 »)
 * @returns {number|null}
 */
export function prixAffiche(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Prix publics utilisables, par référence fournisseur, au prix de l'unité de la base.
 * @param {{ fournisseur: string, releve: string, articles: Array<{ code: string, statut: string, prix_affiche?: string,
 *   diviseur?: number, conditionnement?: string|null, url?: string, note?: string }> }} releve
 * @returns {{ prix: Array<{ reference: string, prix_public: number, url: string|null, conditionnement: string|null, diviseur: number }>,
 *   ecartes: string[] }}
 */
export function prixPublicsDuReleve(releve) {
  if (!releve?.fournisseur || !releve?.releve || !Array.isArray(releve.articles)) throw new Error('relevé invalide (fournisseur, releve, articles)');
  const prix = [];
  const ecartes = [];
  const vus = new Set();
  for (const a of releve.articles) {
    if (!a?.code) { ecartes.push('ligne sans code'); continue; }
    if (vus.has(a.code)) throw new Error(`code en double dans le relevé : ${a.code}`);
    vus.add(a.code);
    if (a.statut !== 'ok') { ecartes.push(`${a.code} : ${a.statut}${a.note ? ` (${a.note})` : ''}`); continue; }
    const affiche = prixAffiche(a.prix_affiche);
    if (affiche == null) { ecartes.push(`${a.code} : prix illisible « ${a.prix_affiche} »`); continue; }
    const diviseur = Number(a.diviseur) > 0 ? Number(a.diviseur) : 1;
    prix.push({
      reference: a.code,
      prix_public: Math.round((affiche / diviseur) * 10000) / 10000,
      url: a.url || null,
      conditionnement: a.conditionnement || null,
      diviseur,
    });
  }
  return { prix, ecartes };
}
