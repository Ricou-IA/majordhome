// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/offreFournisseur.js — ne pas éditer.
// src/lib/catalogue/offreFournisseur.js
// Import d'une offre de prix fournisseur (PDF lu par l'IA) — module PUR, copié pour l'edge supplier-offer-import par
// `npm run sync:tournee-engine`, testé scripts/catalogue/offre-fournisseur.test.mjs. Demande d'Eric (2026-10-25) :
// certains devis dépendent du dimensionnement fait par le fournisseur, on ne réécrit pas ses lignes.
// Ici : le format de sortie STRICT demandé à l'IA (schéma JSON), le prompt, la lecture TOLÉRANTE de la réponse
// (nombres « 2 093,03 », dates « 19/10/2026 », champs manquants), les contrôles (montant de chaque ligne, somme des
// lignes contre le total imprimé — une ligne oubliée ou mal lue se voit) et les lignes au contrat de
// public.supplier_catalog_upsert (appelée avec p_meta.desactiver_absents = false : une offre ne liste que quelques
// articles). Rien n'est cru sur parole : une ligne sans référence ou sans prix est écartée et rapportée.

import { calculerModelKey } from './modelKey.js';

/** Natures qu'une ligne d'offre peut porter (supplier_products.product_kind). */
export const NATURES_OFFRE = Object.freeze(['main', 'accessory', 'consumable']);

const texteS = { type: 'string' };
const nombreS = { type: 'number' };

/**
 * Schéma JSON de la réponse de l'IA (structured outputs : tout est requis). AUCUN type union : l'API refuse un schéma
 * à plus de 16 paramètres « valeur ou null » (vécu le 2026-10-25 avec 19 : 400 invalid_request_error). Une valeur
 * absente du document s'écrit donc "" (texte) ou 0 (nombre) ; lireOffre la ramène à null.
 */
export const SCHEMA_OFFRE = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['fournisseur', 'numero', 'date', 'validite', 'lignes', 'total_ht', 'eco_total', 'remarque'],
  properties: {
    fournisseur: {
      type: 'object',
      additionalProperties: false,
      required: ['nom', 'siret'],
      properties: { nom: texteS, siret: texteS },
    },
    numero: texteS,
    date: texteS,
    validite: texteS,
    lignes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rang', 'code', 'ref_fabricant', 'designation', 'marque', 'quantite', 'unite', 'prix_unitaire_net',
          'prix_brut', 'remise_pct', 'montant_ht', 'eco_participation_unitaire', 'nature'],
        properties: {
          rang: texteS,
          code: texteS,
          ref_fabricant: texteS,
          designation: texteS,
          marque: texteS,
          quantite: nombreS,
          unite: texteS,
          prix_unitaire_net: nombreS,
          prix_brut: nombreS,
          remise_pct: nombreS,
          montant_ht: nombreS,
          eco_participation_unitaire: nombreS,
          nature: { type: 'string', enum: ['main', 'accessory'] },
        },
      },
    },
    total_ht: nombreS,
    eco_total: nombreS,
    remarque: texteS,
  },
});

/** Prompt d'extraction (le PDF est joint en bloc document, avant ce texte). */
export function construirePromptOffre() {
  return [
    'Le document joint est une offre de prix (ou un devis) d\'un fournisseur de matériel de chauffage, climatisation,',
    'plomberie ou photovoltaïque, adressée à un installateur. Recopie chaque ligne d\'article, dans l\'ordre du document,',
    'sans en oublier ni en inventer. Recopie les nombres tels qu\'imprimés (ne recalcule rien).',
    '',
    'Pour chaque ligne :',
    '- rang : le numéro de ligne imprimé (« 001 ») ;',
    '- code : le code article du fournisseur (colonne « Code article », « Réf. »…) ;',
    '- ref_fabricant : la référence du fabricant si elle est imprimée (« Références : ERRA08EV37 » ⇒ ERRA08EV37 ;',
    '  « Références : Thermance / FILT09779 » ⇒ FILT09779) ;',
    '- designation : le libellé complet sur une seule ligne (rejoindre les retours à la ligne) ;',
    '- marque : la marque imprimée (« Thermance / FILT09779 » ⇒ Thermance), ou évidente d\'après la gamme',
    '  (Altherma ⇒ Daikin) ; n\'invente pas ;',
    '- quantite : la quantité commandée ;',
    '- unite : l\'unité du PRIX unitaire telle qu\'imprimée (« Prix pour 1,00 METRE(S) » ⇒ METRE ; « LOT(S) DE 2 PIECE(S) » ⇒',
    '  LOT DE 2 PIECES ; PIECE par défaut si rien n\'est précisé) ;',
    '- prix_unitaire_net : le prix unitaire HT net (remise déduite), HORS éco-participation ;',
    '- prix_brut et remise_pct : le prix public avant remise et le taux de remise s\'ils sont imprimés ;',
    '- montant_ht : le montant HT de la ligne tel qu\'imprimé ;',
    '- eco_participation_unitaire : la somme des éco-participations (DEEE, PMCB…) PAR UNITÉ ;',
    '- nature : « main » pour un équipement principal (unité extérieure ou intérieure de pompe à chaleur ou de climatisation,',
    '  chaudière, poêle, ballon d\'eau chaude, batterie, onduleur, panneau), « accessory » pour le reste (accessoire, raccord,',
    '  tuyauterie, vanne, régulation, support, consommable).',
    '',
    'N\'en fais pas des lignes : sous-totaux, totaux, frais de port, frais de gestion, mentions. « remarque » : une phrase',
    'courte sur ce qui n\'est pas une ligne d\'article (frais de port, frais de gestion), sinon "".',
    'En tête : fournisseur (nom et SIRET de l\'émetteur de l\'offre, pas du client), numero de l\'offre, date et validite au',
    'format AAAA-MM-JJ. total_ht = le total HT des articles imprimé ; eco_total = la somme de TOUTES les éco-participations',
    'imprimées (DEEE + PMCB + …, pas seulement la première). Une valeur absente du document s\'écrit "" pour un texte et 0',
    'pour un nombre.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Lecture tolérante
// ---------------------------------------------------------------------------------------------------------------

/**
 * Nombre depuis une valeur de l'IA : nombre fini, ou texte français (« 2 093,03 », « 1.234,5 € », « 12,5 % »).
 * @param {unknown} v
 * @returns {number|null}
 */
export function nombreFr(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s€%]/g, ''); // \s couvre les espaces insécables (U+00A0, U+202F)
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Date ISO (AAAA-MM-JJ) depuis « 2026-10-19 », « 19/10/2026 » ou « 19/10/26 » ; null si illisible ou invalide.
 * @param {unknown} v
 * @returns {string|null}
 */
export function dateIso(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let a; let mo; let j;
  if (m) [, a, mo, j] = m;
  else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!m) return null;
    [, j, mo, a] = m;
    if (a.length === 2) a = `20${a}`;
  }
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j)));
  if (d.getUTCMonth() !== Number(mo) - 1 || d.getUTCDate() !== Number(j)) return null;
  return d.toISOString().slice(0, 10);
}

const texte = (v, max = 300) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Dernier objet JSON d'un texte (bloc ```json``` d'abord, sinon de la première « { » à la dernière « } »). */
function objetJson(brut) {
  if (brut && typeof brut === 'object' && !Array.isArray(brut)) return brut;
  const t = String(brut ?? '');
  const bloc = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  for (const c of [bloc?.[1], t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    if (!c) continue;
    try { const o = JSON.parse(c); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* suivant */ }
  }
  return null;
}

/** Nombre facultatif : le schéma n'a pas de null, l'IA écrit 0 quand le document ne l'imprime pas. */
const absentSiZero = (v) => { const n = nombreFr(v); return n ? n : null; };

/**
 * Lecture tolérante de la réponse de l'IA. Ne lève jamais : `{ erreur: 'reponse_illisible' }` sans objet lisible.
 * Une ligne sans libellé est écartée (et comptée) ; les nombres et dates sont normalisés ; un texte vide et un
 * nombre facultatif à 0 (prix brut, remise, montant, éco-participation, totaux) valent « absent ». La quantité et le
 * prix net restent tels quels : à 0, les contrôles le signalent.
 * @param {unknown} brut objet ou texte JSON
 * @returns {{ erreur?: string, fournisseur: { nom: string|null, siret: string|null }, numero: string|null,
 *   date: string|null, validite: string|null, lignes: Array<Record<string, any>>, total_ht: number|null,
 *   eco_total: number|null, remarque: string|null, ignorees: number }}
 */
export function lireOffre(brut) {
  const o = objetJson(brut);
  const vide = { fournisseur: { nom: null, siret: null }, numero: null, date: null, validite: null, lignes: [], total_ht: null, eco_total: null, remarque: null, ignorees: 0 };
  if (!o) return { ...vide, erreur: 'reponse_illisible' };
  const f = o.fournisseur && typeof o.fournisseur === 'object' ? o.fournisseur : { nom: o.fournisseur };
  const lignes = [];
  let ignorees = 0;
  (Array.isArray(o.lignes) ? o.lignes : []).forEach((l, i) => {
    const designation = texte(l?.designation);
    if (!l || typeof l !== 'object' || !designation) { ignorees += 1; return; }
    const nature = NATURES_OFFRE.includes(l.nature) ? l.nature : 'accessory';
    lignes.push({
      rang: texte(l.rang, 20) ?? String(i + 1),
      code: texte(l.code, 80),
      ref_fabricant: texte(l.ref_fabricant, 80),
      designation,
      marque: texte(l.marque, 80),
      quantite: nombreFr(l.quantite),
      unite: texte(l.unite, 40),
      prix_unitaire_net: nombreFr(l.prix_unitaire_net),
      prix_brut: absentSiZero(l.prix_brut),
      remise_pct: absentSiZero(l.remise_pct),
      montant_ht: absentSiZero(l.montant_ht),
      eco_participation_unitaire: absentSiZero(l.eco_participation_unitaire),
      nature,
    });
  });
  return {
    fournisseur: { nom: texte(f?.nom, 120), siret: texte(f?.siret, 20) },
    numero: texte(o.numero, 60), date: dateIso(o.date), validite: dateIso(o.validite),
    lignes, total_ht: absentSiZero(o.total_ht), eco_total: absentSiZero(o.eco_total), remarque: texte(o.remarque, 500), ignorees,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------------------------------

const arrondi = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Montant d'une ligne : imprimé, sinon quantité × prix ; null si rien de lisible. */
export function montantLigne(l) {
  if (l.montant_ht != null) return l.montant_ht;
  if (l.quantite != null && l.prix_unitaire_net != null) return arrondi(l.quantite * l.prix_unitaire_net);
  return null;
}

/**
 * Contrôles d'une offre lue. Chaque alerte est affichée telle quelle ; `bloquante` empêche l'import.
 *   - aucune ligne ; ligne sans prix, sans quantité, sans référence ;
 *   - quantité × prix ≠ montant imprimé (au centime près, 0,5 % de tolérance pour les arrondis) ;
 *   - somme des lignes (+ éco-participations si le total les inclut) ≠ total imprimé : une ligne oubliée ou mal lue.
 * @param {ReturnType<typeof lireOffre>} offre
 * @returns {{ alertes: Array<{ code: string, message: string, rang?: string, bloquante?: boolean }>, somme_lignes: number,
 *   total_verifie: boolean }}
 */
export function controlerOffre(offre) {
  const alertes = [];
  const lignes = offre?.lignes || [];
  if (!lignes.length) alertes.push({ code: 'aucune_ligne', message: 'Aucune ligne d\'article lue dans le document.', bloquante: true });
  let somme = 0;
  for (const l of lignes) {
    const nom = `Ligne ${l.rang} (${l.designation.slice(0, 40)})`;
    if (!(l.prix_unitaire_net > 0)) alertes.push({ code: 'prix_absent', rang: l.rang, message: `${nom} : prix unitaire illisible ou nul.` });
    if (l.quantite == null || !(l.quantite > 0)) alertes.push({ code: 'quantite_absente', rang: l.rang, message: `${nom} : quantité illisible.` });
    if (!l.code && !l.ref_fabricant) alertes.push({ code: 'reference_absente', rang: l.rang, message: `${nom} : aucune référence, l'article ne pourra pas être reconnu.` });
    if (l.montant_ht != null && l.quantite != null && l.prix_unitaire_net != null) {
      const calcule = l.quantite * l.prix_unitaire_net;
      if (Math.abs(calcule - l.montant_ht) > Math.max(0.02, Math.abs(l.montant_ht) * 0.005)) {
        alertes.push({ code: 'montant_incoherent', rang: l.rang, message: `${nom} : ${arrondi(l.quantite, 3)} × ${arrondi(l.prix_unitaire_net, 4)} ne fait pas le montant imprimé ${l.montant_ht}.` });
      }
    }
    somme += montantLigne(l) ?? 0;
  }
  somme = arrondi(somme);
  let totalVerifie = false;
  if (offre?.total_ht != null && lignes.length) {
    const eco = offre.eco_total ?? 0;
    // éco-participations relues ligne par ligne : le total imprimé peut les ventiler (DEEE + PMCB) et l'IA n'en
    // recopier qu'une (vécu le 2026-10-25 : 34,26 € de DEEE lus pour 34,96 € au total)
    const ecoLignes = arrondi(lignes.reduce((s, l) => s + (l.eco_participation_unitaire ?? 0) * (l.quantite ?? 0), 0));
    const tol = 0.05;
    totalVerifie = [0, eco, ecoLignes].some((e) => Math.abs(somme + e - offre.total_ht) <= tol);
    if (!totalVerifie) {
      alertes.push({
        code: 'total_incoherent',
        message: `La somme des lignes (${somme.toFixed(2)} €${eco ? ` + ${eco.toFixed(2)} € d'éco-participations` : ''}) ne fait pas le total imprimé (${offre.total_ht.toFixed(2)} €) : une ligne a pu être oubliée ou mal lue.`,
      });
    }
  } else if (lignes.length) {
    alertes.push({ code: 'total_absent', message: 'Total de l\'offre non lu : impossible de vérifier qu\'aucune ligne ne manque.' });
  }
  if (offre?.ignorees) alertes.push({ code: 'lignes_ignorees', message: `${offre.ignorees} ligne(s) sans libellé ignorée(s).` });
  return { alertes, somme_lignes: somme, total_verifie: totalVerifie };
}

// ---------------------------------------------------------------------------------------------------------------
// Unités et lignes de catalogue
// ---------------------------------------------------------------------------------------------------------------

/**
 * Unité de l'app depuis l'unité imprimée par le fournisseur : pièce, ml, m², lot, kg, l ; inconnue ⇒ pièce.
 * @param {string|null|undefined} u
 * @returns {string}
 */
export function uniteDepuisOffre(u) {
  const s = String(u ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/\bLOT/.test(s)) return 'lot';
  if (/M2|M²|METRES? CARRES?/.test(s)) return 'm²';
  if (/\bML\b|METRE|^M$/.test(s)) return 'ml';
  if (/\bKG\b|KILO/.test(s)) return 'kg';
  if (/LITRE|^L$/.test(s)) return 'l';
  return 'pièce';
}

/** Référence d'une ligne au catalogue du fournisseur : son code article, à défaut la référence fabricant. */
export function referenceLigne(l) {
  return texte(l?.code, 80) || texte(l?.ref_fabricant, 80);
}

/**
 * Lignes au contrat de public.supplier_catalog_upsert (p_rows) depuis les lignes d'une offre que l'admin a validées.
 * Prix d'achat = prix unitaire net de l'offre, éco-participation EXCLUE (même convention que les factures du
 * fournisseur, scripts/catalogue/achats.js — l'éco-participation va dans specs.canonical) ; daté de l'offre. Le prix de
 * vente n'est jamais écrit (0 = « à renseigner », appliqué par la RPC à la création seulement). Les clés de specs ne
 * remplacent pas celles des factures (source, historique) : l'offre est rangée sous `derniere_offre`.
 * Écartées et rapportées : sans référence, sans prix > 0, référence en double (la première est gardée).
 * @param {{ numero?: string|null, date?: string|null }} offre
 * @param {Array<Record<string, any>>} lignes lignes lues (lireOffre), éventuellement corrigées à l'écran
 * @param {{ version: string }} opts
 * @returns {{ lignes: Array<Record<string, any>>, ecartees: string[] }}
 */
export function lignesCatalogueDepuisOffre(offre, lignes, { version }) {
  if (!version) throw new Error('version requise');
  const out = [];
  const ecartees = [];
  const vues = new Set();
  for (const l of lignes || []) {
    const reference = referenceLigne(l);
    const pu = nombreFr(l?.prix_unitaire_net);
    const nom = texte(l?.designation) || reference || '(sans libellé)';
    if (!reference) { ecartees.push(`${nom} : aucune référence`); continue; }
    if (!(pu > 0)) { ecartees.push(`${reference} ${nom} : pas de prix`); continue; }
    if (vues.has(reference)) { ecartees.push(`${reference} ${nom} : référence en double dans l'offre (première ligne gardée)`); continue; }
    vues.add(reference);
    const marque = texte(l.marque, 80);
    const refFab = texte(l.ref_fabricant, 80);
    const brut = nombreFr(l.prix_brut);
    const remise = nombreFr(l.remise_pct);
    const eco = nombreFr(l.eco_participation_unitaire);
    const canonical = {
      derniere_offre: {
        numero: offre?.numero ?? null, date: offre?.date ?? null, prix_unitaire_net: pu,
        quantite: nombreFr(l.quantite), unite_offre: texte(l.unite, 40),
      },
    };
    if (refFab && refFab !== reference) canonical.ref_fabricant = refFab;
    if (eco != null) canonical.eco_participation_unitaire = eco;
    out.push({
      reference,
      name: nom,
      brand: marque,
      gamme: null,
      product_kind: NATURES_OFFRE.includes(l.nature) ? l.nature : 'accessory',
      purchase_price_ht: Math.round(pu * 10000) / 10000,
      purchase_price_at: dateIso(offre?.date),
      tarif_public: brut > 0 ? arrondi(brut) : null,
      taux_remise: remise != null ? arrondi(remise) : (brut > 0 ? arrondi((1 - pu / brut) * 100) : null),
      selling_price_ht_defaut: 0,
      default_tva_rate: null,
      unit: uniteDepuisOffre(l.unite),
      category: null,
      model_key: calculerModelKey(marque, [refFab]),
      specs: { source_version: version, canonical },
    });
  }
  return { lignes: out, ecartees };
}

/**
 * Version du relevé pour la RPC (« offre_<fournisseur>_<numéro>_<date> »), stable pour une même offre.
 * @param {{ numero?: string|null, date?: string|null }} offre
 * @param {string} [fournisseur]
 * @returns {string}
 */
export function versionOffre(offre, fournisseur = '') {
  const morceau = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ['offre', morceau(fournisseur), morceau(offre?.numero) || 'sans-numero', dateIso(offre?.date) || 'sans-date'].filter(Boolean).join('_');
}
