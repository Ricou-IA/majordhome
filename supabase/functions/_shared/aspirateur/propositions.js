// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/aspirateur/propositions.js — ne pas éditer.
// src/lib/aspirateur/propositions.js
// Module PUR (copié pour Deno et pour le service VPS) : produits lus par l'aspirateur → PROPOSITIONS à valider par
// l'entreprise. Rien n'est écrit sans proposition ; une proposition qui remplit un champ vide est cochée d'office, une
// qui remplace une valeur ne l'est pas ; un prix lu ne passe jamais devant un prix d'achat plus récent.
// Spec docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md § 7.5-7.8.
// Testé : node --test scripts/aspirateur/propositions.test.mjs

/**
 * @typedef {{ url: string, reference_fabricant: string | null, nom: string, marque: string | null, ean: string | null,
 *   prix: number | null, photo_url: string | null, documents: Array<{ type: string, storage_path: string, empreinte: string }>,
 *   valeurs: Record<string, unknown>, provenance: 'public' | 'compte', lu_le: string }} ProduitLu
 * @typedef {{ reference: string, catalog_item_id: string | null, specs_canonical: Record<string, unknown> | null,
 *   purchase_price_ht: number | null, purchase_price_at: string | null, documents_types: string[], a_photo?: boolean }} Existant
 * @typedef {{ reference: string, catalog_item_id: string | null,
 *   genre: 'nouvel_article' | 'caracteristique' | 'document' | 'photo' | 'prix_achat', cle: string | null,
 *   valeur: unknown, ancienne_valeur: unknown, cochee: boolean, source_url: string, provenance: 'public' | 'compte' }} Proposition
 */

/** @param {unknown} s */
const cle = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
const centime = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * Garde les produits des marques choisies sur la fiche fournisseur (sans accents ni casse) ; liste vide = tout.
 * @param {ProduitLu[]} produits
 * @param {string[] | null | undefined} marques
 * @returns {ProduitLu[]}
 */
export function filtrerParMarques(produits, marques) {
  const voulues = (marques || []).map(cle).filter(Boolean);
  if (!voulues.length) return produits || [];
  return (produits || []).filter((p) => voulues.includes(cle(p.marque)));
}

/**
 * Prix d'achat et prix public HT d'un prix lu, selon la nature réglée sur la fiche fournisseur (jamais devinée).
 * @param {number | null} prix
 * @param {string} nature 'public_ht' | 'public_ttc' | 'net_ht'
 * @param {number | null} remisePct remise du fournisseur sur le prix public, si connue
 * @returns {{ achat_ht: number | null, public_ht: number | null }}
 */
export function prixAchatHt(prix, nature, remisePct) {
  if (typeof prix !== 'number' || !Number.isFinite(prix) || prix < 0) return { achat_ht: null, public_ht: null };
  if (nature === 'net_ht') return { achat_ht: centime(prix), public_ht: null };
  let publicHt;
  if (nature === 'public_ttc') publicHt = prix / 1.2;
  else if (nature === 'public_ht') publicHt = prix;
  else return { achat_ht: null, public_ht: null };
  const achat = Number.isFinite(remisePct) && remisePct >= 0 && remisePct < 100 ? publicHt * (1 - remisePct / 100) : null;
  return { achat_ht: achat === null ? null : centime(achat), public_ht: centime(publicHt) };
}

/** @param {unknown} v */
const vide = (v) => v === null || v === undefined || v === '';

/**
 * Construit les propositions d'un lot de produits lus, contre les lignes existantes du fournisseur.
 * @param {{ produits: ProduitLu[], existants: Existant[], naturePrix: string, remisePct: number | null }} entree
 * @returns {{ propositions: Proposition[], echecs: Array<{ url: string, raison: string }> }}
 */
export function construirePropositions({ produits, existants, naturePrix, remisePct }) {
  const parReference = new Map((existants || []).map((e) => [cle(e.reference), e]));
  /** @type {Proposition[]} */
  const propositions = [];
  const echecs = [];

  for (const p of produits || []) {
    const ref = typeof p.reference_fabricant === 'string' ? p.reference_fabricant.trim() : '';
    if (!ref) { echecs.push({ url: p.url, raison: 'reference_introuvable' }); continue; }
    const e = parReference.get(cle(ref)) || null;
    const reference = e ? e.reference : ref;
    const base = { reference, catalog_item_id: e?.catalog_item_id ?? null, source_url: p.url, provenance: p.provenance };
    const ajouter = (/** @type {Proposition['genre']} */ genre, /** @type {string | null} */ c, valeur, ancienne, cochee) => {
      propositions.push({ ...base, genre, cle: c, valeur, ancienne_valeur: ancienne, cochee });
    };

    if (!e) ajouter('nouvel_article', null, { nom: p.nom, marque: p.marque, ean: p.ean }, null, true);

    const specs = e?.specs_canonical || {};
    for (const [k, v] of Object.entries(p.valeurs || {})) {
      if (vide(v)) continue;
      const ancienne = specs[k];
      if (vide(ancienne)) ajouter('caracteristique', k, v, null, true);
      else if (ancienne !== v) ajouter('caracteristique', k, v, ancienne, false);
    }

    const presents = new Set(e?.documents_types || []);
    for (const d of p.documents || []) {
      if (presents.has(d.type)) continue;
      presents.add(d.type);
      ajouter('document', d.type, { storage_path: d.storage_path, empreinte: d.empreinte }, null, true);
    }

    if (p.photo_url && !e?.a_photo) ajouter('photo', null, p.photo_url, null, true);

    const prix = prixAchatHt(p.prix, naturePrix, remisePct);
    if (prix.achat_ht !== null || prix.public_ht !== null) {
      const connu = e?.purchase_price_ht;
      const recent = e?.purchase_price_at && Date.parse(e.purchase_price_at) > Date.parse(p.lu_le);
      if (!recent) {
        if (vide(connu) || Number(connu) === 0) ajouter('prix_achat', null, prix, null, true);
        else if (prix.achat_ht !== null && Number(connu) !== prix.achat_ht) ajouter('prix_achat', null, prix, Number(connu), false);
      }
    }
  }
  return { propositions, echecs };
}
