// scripts/catalogue/invicta-tarif.js
// Tarif NET Invicta (JSON transcrit par tarif-invicta-pdf.py) → lignes de l'écrivain public.supplier_catalog_upsert,
// et table de CORRECTION des prix déjà en base. Module PUR (aucun import), testé sur les tarifs réels
// (scripts/catalogue/invicta-tarif.test.mjs). Script-only : rangé dans scripts/catalogue comme ecostal-tarif.js.
//
// Rangement des prix (les trois sont HT) :
//   tarif_public = prix de vente par défaut = « Tarif BRUT HT » (le prix public du PDF est TTC : brut × 1,2) ;
//   purchase_price_ht = « Tarif de Vente Net HT » (jamais recalculé) ; taux_remise = R1.
// Incident corrigé le 2026-11-11 : l'import de mars 2026 avait pris le prix public TTC pour le prix de vente HT, et
// calculé l'achat sur ce TTC (160 lignes).

const centime = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const GAMMES = {
  'Poêles à Bûches en Fonte Etanches': 'Poêles à Bûches en Fonte Étanches',
  'Poêles à Bûches en Fonte Raccordable': 'Poêles à Bûches en Fonte Raccordables',
};
/** Libellé de gamme tel qu'il est déjà en base (le PDF 2026 a perdu un accent et un pluriel). */
export const gammeNormalisee = (g) => GAMMES[g] || g || null;
/** Catégorie produit d'une gamme du tarif : tout est « poele », sauf les accessoires génériques (sans catégorie). */
export const categorieDeGamme = (g) => (g === 'Accessoires' ? null : 'poele');

/**
 * Contrôle d'un article du tarif : net = brut − remise (au centime près… à 2 centimes d'arrondi), public TTC = brut
 * × 1,2 (à 1 € près, le PDF arrondit à l'euro), EAN à 13 chiffres. Rend la liste des écarts (vide = cohérent).
 * @param {object} a article du JSON
 * @returns {string[]}
 */
export function ecartsArticle(a) {
  const e = [];
  if (!a.reference || !a.name) e.push('référence ou désignation absente');
  if (!(a.brut_ht > 0) || !(a.net_ht > 0)) e.push('prix brut ou net absent');
  if (!(a.remise_pct >= 0 && a.remise_pct < 100)) e.push(`remise ${a.remise_pct} invalide`);
  else if (Math.abs(centime(a.brut_ht * (1 - a.remise_pct / 100)) - a.net_ht) > 0.02) e.push(`net ${a.net_ht} ≠ brut ${a.brut_ht} − ${a.remise_pct} %`);
  if (Math.abs(a.brut_ht * 1.2 - a.public_ttc) > 1) e.push(`public TTC ${a.public_ttc} ≠ brut ${a.brut_ht} × 1,2`);
  if (a.ean && !/^\d{13}$/.test(a.ean)) e.push(`EAN ${a.ean} invalide`);
  return e;
}

/**
 * @param {{ articles: object[], valable_du?: string }} tarif JSON du tarif
 * @param {{ version: string, marque?: string }} opts
 * @returns {{ lignes: object[], doublons: string[], compteRendu: object }}
 *   lignes : une par RÉFÉRENCE (le PDF répète une référence sous plusieurs désignations : « Grille 9701 pour foyer
 *   700 compact », « … pour foyer 840 horizontal » — même article, même prix ; la première désignation est gardée).
 */
export function lignesDepuisTarifInvicta(tarif, opts) {
  const version = opts && opts.version;
  if (!version) throw new Error('version du tarif requise');
  const articles = (tarif && tarif.articles) || [];
  if (!articles.length) throw new Error('tarif vide');
  const erreurs = [];
  const parRef = new Map();
  const doublons = new Set();
  for (const a of articles) {
    const ecarts = ecartsArticle(a);
    if (ecarts.length) { erreurs.push(`${a.reference || '?'} : ${ecarts.join(' ; ')}`); continue; }
    const vu = parRef.get(a.reference);
    if (vu) {
      doublons.add(a.reference);
      if (vu.brut_ht !== a.brut_ht || vu.net_ht !== a.net_ht) erreurs.push(`${a.reference} : deux prix différents pour la même référence`);
      continue;
    }
    parRef.set(a.reference, a);
  }
  if (erreurs.length) throw new Error(`Tarif incohérent, rien n'est écrit :\n  ${erreurs.slice(0, 12).join('\n  ')}`);
  const lignes = [...parRef.values()].map((a) => ({
    reference: a.reference, name: a.name, brand: opts.marque || 'INVICTA', gamme: gammeNormalisee(a.gamme), category: categorieDeGamme(a.gamme),
    product_kind: 'main', unit: 'pièce',
    purchase_price_ht: a.net_ht, selling_price_ht_defaut: a.brut_ht, tarif_public: a.brut_ht, taux_remise: a.remise_pct,
    specs: { canonical: { tarif_version: version, prix_public_ttc: a.public_ttc, exclusivite: (a.marqueurs || []).some((m) => m === 'Ex' || m === 'Exc') } },
  }));
  const somme = (cle) => centime(lignes.reduce((s, l) => s + l[cle], 0));
  return {
    lignes, doublons: [...doublons].sort(),
    compteRendu: { version, lignes_pdf: articles.length, references: lignes.length, doublons: doublons.size, somme_brut_ht: somme('tarif_public'), somme_net_ht: somme('purchase_price_ht') },
  };
}

/**
 * Table de correction des prix en base : pour chaque référence connue (tarif courant, sinon ancien tarif), le bon
 * prix de vente HT (brut), le bon prix d'achat (net), la remise, l'EAN, et les prix TTC qui ont pu être rangés à tort
 * comme prix de vente HT (`anciens_ttc`) — un prix de vente qui n'est AUCUN de ces TTC a été ajusté à la main et
 * n'est pas touché.
 * @param {{ articles: object[] }} courant
 * @param {{ articles: object[] }} [ancien]
 * @returns {Array<{ reference: string, vente_ht: number, achat_ht: number, remise_pct: number, ean: string|null, anciens_ttc: number[], au_tarif: boolean }>}
 */
export function correctionsDePrix(courant, ancien) {
  const out = new Map();
  const ajouter = (articles, auTarif) => {
    for (const a of articles || []) {
      const c = out.get(a.reference);
      if (c) { if (!c.anciens_ttc.includes(a.public_ttc)) c.anciens_ttc.push(a.public_ttc); continue; }
      out.set(a.reference, { reference: a.reference, vente_ht: a.brut_ht, achat_ht: a.net_ht, remise_pct: a.remise_pct, ean: a.ean || null, anciens_ttc: [a.public_ttc], au_tarif: auTarif });
    }
  };
  ajouter(courant && courant.articles, true);
  ajouter(ancien && ancien.articles, false);
  return [...out.values()];
}
