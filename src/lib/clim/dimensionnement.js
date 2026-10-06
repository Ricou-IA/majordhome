// src/lib/clim/dimensionnement.js
// Moteur de dimensionnement d'une climatisation — module PUR (aucun import React/Supabase/alias),
// copié tel quel par le site Mayer Énergie pour le questionnaire prospect. Point d'entrée unique :
// `dimensionner(releve, produits, cfg)`. Règles et sources : spec
// docs/superpowers/specs/2026-10-06-dimensionnement-clim-design.md §2 ; valeurs dans config.js.
// ENGINE_VERSION à incrémenter à tout changement de règle (le site doit recopier la même version).
// Testé par `node --test scripts/clim/dimensionnement.test.mjs` sur le tarif Solipac réel.
import { DEFAULTS_CLIM } from './config.js';

export const ENGINE_VERSION = 'clim-2026.10.1'; // .1 : recalibrage ancien 115 / sud +10 % / zone 0 (salon 60 m² = 7,6 kW)

/** Classes d'isolation (clés de `cfg.w_m2_par_isolation`), de la plus performante à la moins. */
export const CLASSES_ISOLATION = Object.freeze([
  Object.freeze({ code: 'bbc', label: 'RE2020 / BBC (construit après 2020)', annee_min: 2021 }),
  Object.freeze({ code: 'rt2012', label: 'RT2012 (2012 à 2020)', annee_min: 2012 }),
  Object.freeze({ code: 'standard', label: 'Standard ou rénové (2000 à 2011)', annee_min: 2000 }),
  Object.freeze({ code: 'ancien', label: 'Ancien, isolation partielle (avant 2000)', annee_min: null }),
  Object.freeze({ code: 'non_isole', label: 'Ancien, non isolé', annee_min: null }),
]);

/** Expositions dominantes d'une pièce (clés de `cfg.exposition_majoration`). */
export const EXPOSITIONS = Object.freeze([
  Object.freeze({ code: 'nord', label: 'Nord' }),
  Object.freeze({ code: 'est', label: 'Est' }),
  Object.freeze({ code: 'sud', label: 'Sud' }),
  Object.freeze({ code: 'ouest', label: 'Ouest' }),
]);

const CODES_ISOLATION = new Set(CLASSES_ISOLATION.map((c) => c.code));
const CODES_EXPOSITION = new Set(EXPOSITIONS.map((e) => e.code));
const BTU_PAR_KW = 3415;

const fini = (v) => Number.isFinite(Number(v));
const num = (v, d = 0) => (fini(v) ? Number(v) : d);
const arrondi = (v, pas = 1) => Math.round(v / pas) * pas;
const centimes = (v) => Math.round(num(v) * 100) / 100;

/**
 * Classe d'isolation déduite de l'année de construction (sans rénovation connue).
 * Avant 2000 on suppose « ancien, isolation partielle » : le relevé peut forcer `non_isole`.
 * @param {number|string} annee
 * @returns {string|null} code de CLASSES_ISOLATION, null si l'année n'est pas un nombre
 */
export function classeDepuisAnnee(annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 1000) return null;
  for (const c of CLASSES_ISOLATION) if (c.annee_min != null && a >= c.annee_min) return c.code;
  return 'ancien';
}

/**
 * Contrôle du relevé : un champ absent ne devient JAMAIS un 0 silencieux dans le calcul.
 * @param {object|null|undefined} releve `{ logement, pieces }`
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerReleve(releve) {
  const erreurs = [];
  const logement = releve?.logement || {};
  if (!CODES_ISOLATION.has(logement.classe_isolation)) erreurs.push("classe d'isolation du logement manquante");
  const pieces = Array.isArray(releve?.pieces) ? releve.pieces : [];
  if (pieces.length === 0) erreurs.push('aucune pièce à climatiser');
  pieces.forEach((p, i) => {
    const nom = p?.nom || `pièce ${i + 1}`;
    if (!(num(p?.surface_m2, NaN) > 0)) erreurs.push(`${nom} : surface manquante`);
    const h = p?.hauteur_m;
    if (h != null && h !== '' && !(num(h, NaN) >= 2 && num(h, NaN) <= 6)) erreurs.push(`${nom} : hauteur sous plafond entre 2 et 6 m`);
    if (!CODES_EXPOSITION.has(p?.exposition)) erreurs.push(`${nom} : exposition manquante`);
    if (p?.vitrage_m2 != null && p.vitrage_m2 !== '' && !(num(p.vitrage_m2, NaN) >= 0)) erreurs.push(`${nom} : vitrage invalide`);
    if (p?.occupants != null && p.occupants !== '' && !(Number.isInteger(Number(p.occupants)) && Number(p.occupants) >= 0)) erreurs.push(`${nom} : occupants invalide`);
    if (p?.appareils_w != null && p.appareils_w !== '' && !(num(p.appareils_w, NaN) >= 0)) erreurs.push(`${nom} : appareils invalide`);
    if (p?.longueur_liaison_m != null && p.longueur_liaison_m !== '' && !(num(p.longueur_liaison_m, NaN) >= 0)) erreurs.push(`${nom} : longueur de liaison invalide`);
  });
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Besoin frigorifique d'une pièce (W), détail des facteurs et contrôle croisé par le volume.
 * @param {{ surface_m2: number, hauteur_m?: number, exposition: string, vitrage_m2?: number,
 *   protection_solaire?: boolean, occupants?: number, appareils_w?: number, sous_toiture?: boolean,
 *   nb_parois_vitrees?: number }} piece
 * @param {{ classe_isolation: string, zone_majoration?: number }} logement
 * @param {typeof DEFAULTS_CLIM} [cfg]
 * @returns {{ besoin_w: number, detail: object, controle: { btu: number, kw: number } }}
 */
export function besoinPiece(piece, logement, cfg = DEFAULTS_CLIM) {
  const surface = num(piece.surface_m2);
  const hauteur = num(piece.hauteur_m, cfg.hauteur_reference_m) || cfg.hauteur_reference_m;
  const wm2 = num(cfg.w_m2_par_isolation[logement.classe_isolation], cfg.base_w_m2);
  const facteur_hauteur = hauteur / cfg.hauteur_reference_m;
  const facteur_exposition = 1 + num(cfg.exposition_majoration[piece.exposition]);
  const facteur_toiture = piece.sous_toiture ? 1 + cfg.sous_toiture_majoration : 1;
  const facteur_zone = 1 + num(logement.zone_majoration, cfg.zone_majoration);
  const enveloppe_w = surface * wm2 * facteur_hauteur * facteur_exposition * facteur_toiture * facteur_zone;
  const vitrage_m2 = num(piece.vitrage_m2);
  const vitrage_w = vitrage_m2 * num(cfg.vitrage_w_m2_par_exposition[piece.exposition]) * (piece.protection_solaire ? cfg.facteur_protection_solaire : 1);
  const occupants = Math.max(0, Math.trunc(num(piece.occupants)) - cfg.occupants_inclus);
  const occupants_w = occupants * cfg.w_par_occupant_supplementaire;
  const appareils_w = num(piece.appareils_w);
  const besoin_w = arrondi((enveloppe_w + vitrage_w + occupants_w + appareils_w) * (1 + cfg.marge_securite), 10);
  // Contrôle croisé « volume » : 100 BTU/m³ + 1 000 BTU par paroi vitrée (une fenêtre ≈ 1,5 m² si non précisé)
  const nb_parois = piece.nb_parois_vitrees != null && piece.nb_parois_vitrees !== '' ? Math.max(0, Math.trunc(num(piece.nb_parois_vitrees))) : Math.ceil(vitrage_m2 / 1.5);
  const btu = surface * hauteur * cfg.btu_par_m3 + nb_parois * cfg.btu_par_paroi_vitree;
  return {
    besoin_w,
    detail: {
      surface_m2: surface, hauteur_m: hauteur, volume_m3: Math.round(surface * hauteur * 10) / 10, w_m2: wm2,
      facteur_hauteur, facteur_exposition, facteur_toiture, facteur_zone,
      enveloppe_w: Math.round(enveloppe_w), vitrage_w: Math.round(vitrage_w), occupants_w, appareils_w,
    },
    controle: { btu: Math.round(btu), kw: Math.round((btu / BTU_PAR_KW) * 100) / 100 },
  };
}

/**
 * Catalogue typé depuis les produits fournisseur (vue majordhome_supplier_products, catégorie
 * climatisation) : le type et les kW viennent de `specs.canonical` posés par l'import Solipac.
 * Un produit sans type connu est ignoré. Prix d'achat = `purchase_price_ht` (DEEE incluse),
 * prix de vente = `selling_price_ht` (0 = à chiffrer).
 * @param {Array<object>} produits
 * @returns {{ packs_mono: Array<object>, ui: Array<object>, ge_multi: Array<object>, liaisons: Array<object> }}
 */
export function catalogueDepuisProduits(produits) {
  const out = { packs_mono: [], ui: [], ge_multi: [], liaisons: [] };
  for (const p of produits || []) {
    if (p?.is_active === false) continue;
    const c = p?.specs?.canonical;
    if (!c?.type) continue;
    const base = {
      id: p.id, reference: p.reference, name: p.name, gamme: p.gamme || c.gamme || null,
      supplier_id: p.supplier_id, supplier_name: p.supplier_name || null,
      purchase_price_ht: centimes(p.purchase_price_ht), selling_price_ht: centimes(p.selling_price_ht),
      tva_rate: fini(p.default_tva_rate) ? Number(p.default_tva_rate) : 20, unit: p.unit || 'pièce',
    };
    if (c.type === 'pack_mono' && fini(c.kw_froid)) out.packs_mono.push({ ...base, kw_froid: Number(c.kw_froid), ui: c.ui, ge: c.ge });
    else if (c.type === 'ui_murale' && fini(c.kw_froid)) out.ui.push({ ...base, kw_froid: Number(c.kw_froid), mono: c.mono !== false, multi: c.multi !== false });
    else if (c.type === 'ge_multi' && fini(c.kw_froid)) out.ge_multi.push({ ...base, kw_froid: Number(c.kw_froid), kw_froid_max: num(c.kw_froid_max, Number(c.kw_froid)), kw_chaud: num(c.kw_chaud, null), sorties_min: Math.max(1, Math.trunc(num(c.sorties_min, 2))), sorties_max: Math.trunc(num(c.sorties_max, 2)) });
    else if (c.type === 'liaison' && c.liquide && c.gaz && fini(c.longueur_m)) out.liaisons.push({ ...base, liquide: String(c.liquide), gaz: String(c.gaz), longueur_m: Number(c.longueur_m) });
  }
  const parKw = (a, b) => a.kw_froid - b.kw_froid || a.purchase_price_ht - b.purchase_price_ht;
  out.packs_mono.sort(parKw); out.ui.sort(parKw); out.ge_multi.sort(parKw);
  out.liaisons.sort((a, b) => a.longueur_m - b.longueur_m);
  return out;
}

/**
 * Plus petite unité du catalogue couvrant le besoin (à `tolerance_sous` près), avec les alertes
 * de sur/sous-dimensionnement. Aucune unité assez puissante ⇒ la plus puissante + alerte ;
 * catalogue vide ⇒ unité null + alerte.
 * @param {number} besoin_w
 * @param {Array<{ kw_froid: number }>} candidats triés par kW croissant
 * @param {typeof DEFAULTS_CLIM} [cfg]
 * @returns {{ unite: object|null, ecart: number|null, alertes: Array<{ code: string, niveau: string, message: string }> }}
 */
export function choisirUnite(besoin_w, candidats, cfg = DEFAULTS_CLIM) {
  const alertes = [];
  if (!candidats?.length) return { unite: null, ecart: null, alertes: [{ code: 'catalogue_vide', niveau: 'alerte', message: 'Aucune unité de cette gamme dans le catalogue' }] };
  const seuil_kw = (besoin_w * (1 - cfg.tolerance_sous)) / 1000;
  let unite = candidats.find((u) => u.kw_froid >= seuil_kw) || null;
  if (!unite) {
    unite = candidats[candidats.length - 1];
    alertes.push({ code: 'aucune_unite_suffisante', niveau: 'alerte', message: `Besoin de ${(besoin_w / 1000).toFixed(1).replace('.', ',')} kW : la plus puissante du catalogue fait ${String(unite.kw_froid).replace('.', ',')} kW. Prévoir deux unités ou un gainable.` });
  }
  const ecart = besoin_w > 0 ? (unite.kw_froid * 1000) / besoin_w - 1 : null;
  if (ecart != null && ecart > cfg.tolerance_sur) alertes.push({ code: 'surdimensionne', niveau: 'alerte', message: `Unité ${Math.round(ecart * 100)} % au-dessus du besoin : cycles courts, air froid et humide. Vérifier le relevé.` });
  else if (ecart != null && ecart < 0) alertes.push({ code: 'legerement_sous', niveau: 'info', message: `Unité ${Math.round(-ecart * 100)} % sous le besoin calculé : acceptable, la pièce mettra un peu plus de temps à descendre en température.` });
  return { unite, ecart, alertes };
}

/**
 * Groupe multi-split minimal compatible avec N unités intérieures : sorties min/max respectées
 * et Σ kW des unités ≤ `ratio_max_ui_ge` × nominal froid du groupe.
 * @param {Array<{ kw_froid: number }>} unites
 * @param {Array<object>} groupes catalogue `ge_multi` trié par kW croissant
 * @param {typeof DEFAULTS_CLIM} [cfg]
 * @returns {{ groupe: object|null, somme_kw: number, ratio: number|null, raison: string|null }}
 */
export function composerMulti(unites, groupes, cfg = DEFAULTS_CLIM) {
  const n = unites?.length || 0;
  const somme_kw = Math.round((unites || []).reduce((s, u) => s + num(u.kw_froid), 0) * 100) / 100;
  if (n < 2) return { groupe: null, somme_kw, ratio: null, raison: 'une_seule_piece' };
  if (!groupes?.length) return { groupe: null, somme_kw, ratio: null, raison: 'catalogue_vide' };
  const ratio = cfg.multi?.ratio_max_ui_ge ?? DEFAULTS_CLIM.multi.ratio_max_ui_ge;
  const groupe = groupes.find((g) => n >= g.sorties_min && n <= g.sorties_max && g.kw_froid * ratio >= somme_kw) || null;
  if (!groupe) {
    const raison = groupes.some((g) => n <= g.sorties_max) ? 'puissance_insuffisante' : 'trop_de_pieces';
    return { groupe: null, somme_kw, ratio: null, raison };
  }
  return { groupe, somme_kw, ratio: Math.round((somme_kw / groupe.kw_froid) * 100) / 100, raison: null };
}

/**
 * Diamètre de liaison d'une unité intérieure selon sa puissance (paliers de la config).
 * @param {number} kw
 * @param {typeof DEFAULTS_CLIM} [cfg]
 * @returns {{ liquide: string, gaz: string, diametre: string }}
 */
export function diametreLiaison(kw, cfg = DEFAULTS_CLIM) {
  const palier = cfg.liaison_paliers.find((p) => kw <= p.max_kw) || cfg.liaison_paliers[cfg.liaison_paliers.length - 1];
  return { liquide: palier.liquide, gaz: palier.gaz, diametre: `${palier.liquide}-${palier.gaz}` };
}

/**
 * Couronnes de liaison cuivre à commander : longueurs cumulées par diamètre, puis la plus petite
 * couronne qui couvre le reste (50 m avant 20 m quand il reste plus de 20 m). Diamètre absent du
 * catalogue ⇒ alerte, jamais une couronne d'un autre diamètre.
 * @param {Array<{ kw_froid: number, longueur_m: number, piece?: string }>} unites
 * @param {Array<object>} catalogueLiaisons
 * @param {typeof DEFAULTS_CLIM} [cfg]
 * @returns {Array<{ diametre: string, longueur_m: number, couronnes: Array<{ article: object, quantite: number }>, alertes: Array<object> }>}
 */
export function liaisons(unites, catalogueLiaisons, cfg = DEFAULTS_CLIM) {
  const parDiametre = new Map();
  for (const u of unites || []) {
    const { diametre } = diametreLiaison(num(u.kw_froid), cfg);
    const l = num(u.longueur_m, cfg.longueur_liaison_defaut_m);
    parDiametre.set(diametre, (parDiametre.get(diametre) || 0) + l);
  }
  const out = [];
  for (const [diametre, longueur_m] of parDiametre) {
    const dispo = (catalogueLiaisons || []).filter((a) => `${a.liquide}-${a.gaz}` === diametre).sort((a, b) => a.longueur_m - b.longueur_m);
    const alertes = [];
    const couronnes = [];
    if (!dispo.length) {
      alertes.push({ code: 'liaison_absente_catalogue', niveau: 'alerte', message: `Liaison ${diametre} absente du catalogue : ${longueur_m} m à chiffrer.` });
    } else {
      let reste = longueur_m;
      const plusGrande = dispo[dispo.length - 1];
      const compter = (article) => { const c = couronnes.find((x) => x.article.id === article.id); if (c) c.quantite += 1; else couronnes.push({ article, quantite: 1 }); };
      while (reste > 0) {
        const petite = dispo.find((a) => a.longueur_m >= reste);
        if (petite) { compter(petite); reste = 0; } else { compter(plusGrande); reste -= plusGrande.longueur_m; }
      }
    }
    out.push({ diametre, longueur_m, couronnes, alertes });
  }
  return out;
}

const libellePrix = (a) => (a.selling_price_ht > 0 ? null : 'À CHIFFRER');

/**
 * Lignes de devis (même forme que `versLignesDevis` du métré fumisterie) depuis une liste
 * `{ article, quantite, piece? }`. Prix de vente 0 ⇒ description « À CHIFFRER », jamais masqué.
 * @param {Array<{ article: object, quantite: number, piece?: string|null }>} postes
 * @returns {Array<object>}
 */
export function lignesDevis(postes) {
  return (postes || []).filter((p) => p?.article).map((p) => ({
    line_type: 'product', supplier_product_id: p.article.id, supplier_id: p.article.supplier_id || null, supplier_name: p.article.supplier_name || null,
    designation: p.article.name, description: [p.piece ? `Pièce : ${p.piece}` : null, libellePrix(p.article)].filter(Boolean).join(' · '),
    reference: p.article.reference || '', quantity: p.quantite, unit: p.article.unit || 'pièce',
    purchase_price_ht: p.article.purchase_price_ht, unit_price_ht: p.article.selling_price_ht ?? 0, tva_rate: p.article.tva_rate ?? 20,
  }));
}

const totalAchat = (postes) => centimes(postes.reduce((s, p) => s + (p.article ? p.article.purchase_price_ht * p.quantite : 0), 0));
const postesLiaisons = (liaisonsCalc) => liaisonsCalc.flatMap((l) => l.couronnes.map((c) => ({ article: c.article, quantite: c.quantite, piece: null })));

/**
 * Point d'entrée unique : besoin par pièce, proposition mono-split (un pack par pièce) et
 * multi-split (un groupe + une unité murale par pièce) quand il y a au moins deux pièces,
 * liaisons cuivre et lignes de devis de chaque proposition. Rien n'est avalé : relevé incomplet
 * ⇒ `ok: false`, unité ou liaison introuvable ⇒ alerte, prix de vente 0 ⇒ « À CHIFFRER ».
 * @param {{ logement: { classe_isolation: string, zone_majoration?: number, gamme?: string },
 *   pieces: Array<object> }} releve
 * @param {Array<object>} produits lignes de majordhome_supplier_products (catégorie climatisation)
 * @param {typeof DEFAULTS_CLIM} [cfg] config effective (`buildClimConfig(settings)`)
 * @returns {object} `{ ok, erreurs }` ou `{ ok: true, engine_version, gamme, pieces, mono, multi, mode_recommande, alertes }`
 */
export function dimensionner(releve, produits, cfg = DEFAULTS_CLIM) {
  const validation = validerReleve(releve);
  if (!validation.ok) return { ok: false, erreurs: validation.erreurs, engine_version: ENGINE_VERSION };
  const catalogue = catalogueDepuisProduits(produits);
  const gammes = [...new Set([...catalogue.packs_mono, ...catalogue.ui].map((a) => a.gamme).filter(Boolean))];
  let gamme = releve.logement.gamme || cfg.gamme_defaut;
  const alertes = [];
  if (gammes.length && !gammes.includes(gamme)) {
    const repli = gammes.includes(cfg.gamme_defaut) ? cfg.gamme_defaut : gammes[0];
    alertes.push({ code: 'gamme_inconnue', niveau: 'info', message: `Gamme « ${gamme} » absente du catalogue : ${repli} utilisée.` });
    gamme = repli;
  }
  const packsGamme = catalogue.packs_mono.filter((a) => a.gamme === gamme);
  const uiGamme = catalogue.ui.filter((a) => a.gamme === gamme && a.multi);

  const pieces = releve.pieces.map((p, i) => {
    const nom = p.nom || `Pièce ${i + 1}`;
    const besoin = besoinPiece(p, releve.logement, cfg);
    let mono = choisirUnite(besoin.besoin_w, packsGamme, cfg);
    if (!mono.unite && catalogue.packs_mono.length) {
      mono = choisirUnite(besoin.besoin_w, catalogue.packs_mono, cfg);
      mono.alertes.push({ code: 'gamme_sans_pack', niveau: 'info', message: `Aucun pack ${gamme} : pack ${mono.unite?.gamme || ''} proposé.` });
    }
    const multi = choisirUnite(besoin.besoin_w, uiGamme, cfg);
    const longueur_liaison_m = num(p.longueur_liaison_m, cfg.longueur_liaison_defaut_m);
    return { nom, ...besoin, longueur_liaison_m, mono, multi };
  });

  const postesMono = pieces.filter((p) => p.mono.unite).map((p) => ({ article: p.mono.unite, quantite: 1, piece: p.nom }));
  const liaisonsMono = liaisons(pieces.filter((p) => p.mono.unite).map((p) => ({ kw_froid: p.mono.unite.kw_froid, longueur_m: p.longueur_liaison_m })), catalogue.liaisons, cfg);
  const monoPostes = [...postesMono, ...postesLiaisons(liaisonsMono)];
  const mono = { postes: monoPostes, liaisons: liaisonsMono, lignes_devis: lignesDevis(monoPostes), total_achat_ht: totalAchat(monoPostes) };

  let multi = null;
  if (pieces.length >= 2) {
    const unites = pieces.filter((p) => p.multi.unite).map((p) => p.multi.unite);
    const compo = composerMulti(unites, catalogue.ge_multi, cfg);
    const liaisonsMulti = liaisons(pieces.filter((p) => p.multi.unite).map((p) => ({ kw_froid: p.multi.unite.kw_froid, longueur_m: p.longueur_liaison_m })), catalogue.liaisons, cfg);
    const postes = compo.groupe ? [{ article: compo.groupe, quantite: 1, piece: null }, ...pieces.filter((p) => p.multi.unite).map((p) => ({ article: p.multi.unite, quantite: 1, piece: p.nom })), ...postesLiaisons(liaisonsMulti)] : [];
    multi = { ...compo, unites, liaisons: liaisonsMulti, postes, lignes_devis: lignesDevis(postes), total_achat_ht: totalAchat(postes) };
    if (!compo.groupe) {
      const messages = {
        catalogue_vide: 'Aucun groupe multi-split dans le catalogue.',
        puissance_insuffisante: `Aucun groupe ne couvre ${String(compo.somme_kw).replace('.', ',')} kW d'unités intérieures : prévoir deux groupes ou des mono-splits.`,
        trop_de_pieces: `${unites.length} pièces : au-delà des sorties des groupes du catalogue, répartir sur plusieurs groupes.`,
      };
      alertes.push({ code: `multi_${compo.raison}`, niveau: 'info', message: messages[compo.raison] || 'Multi-split impossible.' });
    }
  }

  for (const p of pieces) {
    for (const a of [...p.mono.alertes, ...(pieces.length >= 2 ? p.multi.alertes : [])]) alertes.push({ ...a, piece: p.nom });
  }
  for (const l of [...mono.liaisons, ...(multi?.liaisons || [])]) for (const a of l.alertes) alertes.push(a);
  // Dédoublonnage (une même alerte de liaison peut sortir des deux propositions)
  const vues = new Set();
  const alertesUniques = alertes.filter((a) => { const k = `${a.code}|${a.piece || ''}|${a.message}`; if (vues.has(k)) return false; vues.add(k); return true; });

  const mode_recommande = multi?.groupe ? 'multi' : 'mono';
  return { ok: true, engine_version: ENGINE_VERSION, gamme, gammes, pieces, mono, multi, mode_recommande, alertes: alertesUniques };
}
