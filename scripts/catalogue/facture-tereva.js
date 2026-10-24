// scripts/catalogue/facture-tereva.js
// Lecture d'un relevé mensuel TEREVA à partir des mots positionnés. Deux mises en page coexistent :
//   1. « DocuWare » (jusqu'à l'été 2026) : corps composé en lettres espacées (un « mot » par caractère, recollé par
//      pdfLignes), colonnes « NUMERO ARTICLE | DESIGNATION ARTICLE | QUANTITE | U.F. | (PROMO) | PRIX UNITAIRE NET |
//      MONTANT HORS TAXES | TVA », groupes « V.CDE: <commande> » puis « jj/mm/aa BL <n°> », lignes complémentaires
//      (référence fabricant seule, ou suite de désignation), « ECO-PARTICIPATION DEEE|PMCB|ABJ » après l'article
//      taxé, « TOTAL BL » par bon de livraison. L'unité de facturation (U.F.) change le sens du prix : « 3 » = prix
//      aux cent pièces, « B » = prix au kilomètre… — tout prix est ramené ici à l'unité de base (pièce, mètre, kilo).
//   2. « Facture électronique » (depuis septembre 2026, aussi pour les avoirs) : rendu normalisé « Produits | Qté |
//      Prix u. HT | TVA (%) | Total HT » — nom de l'article puis ligne de valeurs, code sur la ligne suivante,
//      compléments / référence / « **PROMO** » / « ECO-PARTICIPATION … » / « TOTAL BL » en dessous ; pied « Total
//      montant net des lignes », « Total frais », « Frais de port », « Frais Fixe », « Total HT ».
// Module PUR, testé scripts/catalogue/facture-tereva.test.mjs.
import { lignesDepuisMots, nombreFR, nombreEN, centimes, dateFR } from './pdf-lignes.js';

/** Unités de facturation TEREVA : unité de base + diviseur du prix unitaire facturé. */
export const UNITES_FACTURATION = Object.freeze({
  1: { unite: 'pièce', diviseur: 1 }, 2: { unite: 'paire', diviseur: 1 }, 3: { unite: 'pièce', diviseur: 100 },
  4: { unite: 'm', diviseur: 1 }, 5: { unite: 'm', diviseur: 100 }, 6: { unite: 'm²', diviseur: 1 },
  7: { unite: 'kg', diviseur: 1 }, 8: { unite: 'kg', diviseur: 100 }, 9: { unite: 'cm', diviseur: 1 },
  A: { unite: 'pièce', diviseur: 1000 }, B: { unite: 'm', diviseur: 1000 }, C: { unite: 't', diviseur: 1 }, D: { unite: 'mm', diviseur: 1 },
});

const TVA_CODE = Object.freeze({ 1: 10, 2: 20 });
const CODE_ARTICLE = /^\d{6,7}[A-Z]?$/;
const REF_FABRICANT = /^[A-Z0-9][A-Z0-9.\-/]*$/;

/**
 * Une ligne complémentaire est une référence fabricant si chacun de ses mots ressemble à un code (avec un chiffre)
 * et que l'un d'eux fait au moins 5 caractères (« 0601072900 », « 873978 + 872154 », « L-3.5-300 » ; pas « IP67 5W »).
 */
export function estReference(mots) {
  const utiles = mots.filter((m) => m !== '+');
  return utiles.length > 0 && utiles.length <= 3 && utiles.every((m) => REF_FABRICANT.test(m) && /\d/.test(m)) && utiles.some((m) => m.length >= 5);
}

function nouveauDoc() {
  return { fournisseur: 'TEREVA', format: null, type: null, numero: null, date: null, lignes: [], totaux: { marchandises_ht: null, frais: {}, total_ht: null, ttc: null }, anomalies: [] };
}

function nouvelArticle(code, designation, page) {
  return { code, designation, complement: null, ref_fabricant: null, quantite: null, unite: 'pièce', uf: null, prix_unitaire_net: null, montant_ht: null, promo: false, eco: null, tva_taux: null, bl: { numero: null, date: null, commande: null }, page };
}

function rattacherComplement(art, mots) {
  if (estReference(mots)) { if (!art.ref_fabricant) art.ref_fabricant = mots.join(' '); return; }
  art.complement = [art.complement, mots.join(' ')].filter(Boolean).join(' · ');
}

/**
 * @param {Array<{ num:number, words: Array<{x0:number,y0:number,x1:number,y1:number,t:string}> }>} pages
 * @returns {{ fournisseur:'TEREVA', format:'docuware'|'e-invoice'|null, type:'facture'|'avoir'|null, numero:string|null, date:string|null,
 *   lignes: Array<{ code:string, designation:string, complement:string|null, ref_fabricant:string|null, quantite:number|null,
 *     unite:string, uf:string|null, prix_unitaire_net:number|null, montant_ht:number|null, promo:boolean, eco:number|null,
 *     tva_taux:number|null, bl:{ numero:string|null, date:string|null, commande:string|null }, page:number }>,
 *   totaux: { marchandises_ht:number|null, frais:Record<string,number>, total_ht:number|null, ttc:number|null },
 *   anomalies: string[] }}
 */
export function parserFactureTereva(pages) {
  const premiere = pages[0] ? lignesDepuisMots(pages[0].words, { toleranceY: 2.5 }) : [];
  const eInvoice = premiere.some((l) => l.tokens[0]?.t === 'Produits' && l.tokens.some((k) => k.t === 'Qté'));
  return eInvoice ? parserEInvoice(pages) : parserDocuware(pages);
}

// ---------------------------------------------------------------------------------------------------------------
// Mise en page 1 — DocuWare (lettres espacées)
// ---------------------------------------------------------------------------------------------------------------
const COL_DW = Object.freeze({ code: 60, designation: 250, quantite: 300, uf: 330, promo: 420, pu: 500, montant: 570 });

function colonneDw(x0) {
  if (x0 < COL_DW.code) return 'code';
  if (x0 < COL_DW.designation) return 'designation';
  if (x0 < COL_DW.quantite) return 'quantite';
  if (x0 < COL_DW.uf) return 'uf';
  if (x0 < COL_DW.promo) return 'promo';
  if (x0 < COL_DW.pu) return 'pu';
  if (x0 < COL_DW.montant) return 'montant';
  return 'tva';
}

function parserDocuware(pages) {
  const doc = nouveauDoc();
  doc.format = 'docuware';
  let bl = { numero: null, date: null, commande: null };
  let sommeBl = 0;
  let derniereLigne = null;
  for (const page of pages) {
    let dansCorps = false;
    const lignes = lignesDepuisMots(page.words, { toleranceY: 2.5, gapLettres: 9 });
    for (const ligne of lignes) {
      const t = ligne.tokens;
      const texte = t.map((k) => k.t).join(' ');
      if (!dansCorps) {
        if (t[0]?.t === 'FACTURE' && t[2]?.t === 'DU') { doc.type = 'facture'; doc.numero = doc.numero ?? t[1].t; doc.date = doc.date ?? dateFR(t[3]?.t); }
        else if (t[0]?.t === 'AVOIR' && t[2]?.t === 'DU') { doc.type = 'avoir'; doc.numero = doc.numero ?? t[1].t; doc.date = doc.date ?? dateFR(t[3]?.t); }
        else if (t[0]?.t === 'ARTICLE' && texte.includes('NET')) dansCorps = true;
        continue;
      }
      if (ligne.y > 660) { dansCorps = false; continue; }
      if (texte.includes('TVA INTRA') || t.every((k) => /^-+$/.test(k.t))) continue;
      if (t[0]?.t === 'V.CDE:') {
        bl = { numero: null, date: null, commande: t.slice(1).map((k) => k.t).filter((m) => !/^-+$/.test(m) && m !== '.').join(' ') || null };
        continue;
      }
      if (t[1]?.t === 'BL' && dateFR(t[0]?.t)) { bl = { ...bl, date: dateFR(t[0].t), numero: t[2]?.t ?? null }; sommeBl = 0; continue; }
      if (t[0]?.t === 'TOTAL' && t[1]?.t === 'BL') {
        const total = nombreFR(t[t.length - 1].t);
        if (total != null && Math.abs(centimes(sommeBl) - total) > 0.011) doc.anomalies.push(`BL ${bl.numero} : somme des lignes ${centimes(sommeBl)} ≠ TOTAL BL ${total}`);
        continue;
      }
      const parCol = { code: [], designation: [], quantite: [], uf: [], promo: [], pu: [], montant: [], tva: [] };
      for (const k of t) parCol[colonneDw(k.x0)].push(k.t);
      const chiffres = [...parCol.quantite, ...parCol.pu, ...parCol.montant];
      if (parCol.code.length === 0) {
        if (parCol.designation[0]?.startsWith('ECO-PARTICIPATION')) {
          const montant = parCol.montant.length ? nombreFR(parCol.montant[0]) : null;
          if (derniereLigne && montant != null) { derniereLigne.eco = centimes((derniereLigne.eco ?? 0) + montant); sommeBl += montant; }
          else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : éco-participation sans article (${texte})`);
        } else if (chiffres.length === 0 && derniereLigne && parCol.designation.length && parCol.designation[0] !== 'TOTAL') {
          rattacherComplement(derniereLigne, parCol.designation);
        } else if (chiffres.length === 0) {
          /* libellé de contexte sous le BL (chantier, « PRIS PAR … ») : ignoré */
        } else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : ligne chiffrée sans code article (${texte})`);
        continue;
      }
      const code = parCol.code.join('');
      if (!CODE_ARTICLE.test(code)) { doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : code inattendu « ${code} » (${texte})`); continue; }
      const uf = parCol.uf[0] ?? null;
      const unite = UNITES_FACTURATION[uf] ?? null;
      const puFacture = parCol.pu.length ? nombreFR(parCol.pu[0]) : null;
      const art = nouvelArticle(code, parCol.designation.join(' ').trim(), page.num);
      art.quantite = parCol.quantite.length ? nombreFR(parCol.quantite[0]) : null;
      art.unite = unite?.unite ?? 'pièce';
      art.uf = uf;
      art.prix_unitaire_net = puFacture != null && unite ? puFacture / unite.diviseur : puFacture;
      art.montant_ht = parCol.montant.length ? nombreFR(parCol.montant[0]) : null;
      art.promo = parCol.promo.some((m) => m.includes('PROMO'));
      art.tva_taux = TVA_CODE[parCol.tva[0]] ?? null;
      art.bl = { ...bl };
      if (!unite) doc.anomalies.push(`${code} : unité de facturation inconnue « ${uf} »`);
      verifierArticle(doc, art, `p${page.num} y${Math.round(ligne.y)}`, texte);
      if (art.montant_ht != null) sommeBl += art.montant_ht;
      doc.lignes.push(art);
      derniereLigne = art;
    }
    lireTotauxDocuware(lignes, doc.totaux);
  }
  if (!doc.numero) doc.anomalies.push('numéro de facture introuvable');
  const marchandises = centimes(doc.lignes.reduce((s, l) => s + (l.montant_ht ?? 0), 0));
  const eco = centimes(doc.lignes.reduce((s, l) => s + (l.eco ?? 0), 0));
  if (doc.totaux.marchandises_ht != null && Math.abs(marchandises - doc.totaux.marchandises_ht) > 0.011) {
    doc.anomalies.push(`somme des articles ${marchandises} ≠ TOTAL MARCHANDISES ${doc.totaux.marchandises_ht}`);
  }
  const ecoTotaux = (doc.totaux.frais.DEEE ?? 0) + (doc.totaux.frais.EcoP ?? 0);
  if ((doc.totaux.frais.DEEE != null || doc.totaux.frais.EcoP != null) && Math.abs(eco - ecoTotaux) > 0.011) {
    doc.anomalies.push(`éco-participations ${eco} ≠ DEEE/EcoP du pied ${ecoTotaux}`);
  }
  return doc;
}

function verifierArticle(doc, art, position, texte) {
  if (!art.designation || art.quantite == null || art.prix_unitaire_net == null || art.montant_ht == null) {
    doc.anomalies.push(`${position} : article incomplet ${art.code} (${texte})`);
  } else if (Math.abs(art.quantite * art.prix_unitaire_net - art.montant_ht) > 0.011) {
    doc.anomalies.push(`${art.code} : ${art.quantite} × ${art.prix_unitaire_net} ≠ montant ${art.montant_ht}`);
  }
}

/** Pied de la dernière page : TOTAL MARCHANDISES HT (x≈83, sous la colonne), frais (PPE, F.G., DEEE, EcoP), net à payer. */
function lireTotauxDocuware(lignes, totaux) {
  for (const ligne of lignes) {
    if (ligne.y < 700) continue;
    const t = ligne.tokens;
    for (let i = 0; i < t.length - 1; i++) {
      if (/^(PPE|F\.G\.|DEEE|EcoP|PORT)$/.test(t[i].t) && t[i].x0 > 130 && t[i].x0 < 190 && nombreFR(t[i + 1].t) != null) totaux.frais[t[i].t] = nombreFR(t[i + 1].t);
    }
    const marchandises = t.find((k) => k.x0 > 60 && k.x0 < 130 && nombreFR(k.t) != null);
    if (marchandises && ligne.y > 740 && ligne.y < 790) {
      totaux.marchandises_ht = nombreFR(marchandises.t);
      const net = t.find((k) => k.x0 > 480 && nombreFR(k.t) != null);
      if (net) totaux.ttc = nombreFR(net.t);
    }
    const iTva = t.findIndex((k) => /^[12]$/.test(k.t) && k.x0 > 225 && k.x0 < 250);
    if (iTva >= 0 && nombreFR(t[iTva + 2]?.t) != null) totaux.total_ht = centimes((totaux.total_ht ?? 0) + nombreFR(t[iTva + 2].t));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mise en page 2 — facture électronique (rendu normalisé)
// ---------------------------------------------------------------------------------------------------------------
const COL_EI = Object.freeze({ produit: 280, quantite: 340, pu: 440, tva: 520 });

/** Valeur d'une colonne de la ligne de valeurs : « 1 699,90 € » est éclaté en « 1 », « 699,90 », « € ». */
function valeurEi(tokens, x0, x1) {
  const morceaux = tokens.filter((k) => k.x0 >= x0 && k.x0 < x1 && k.t !== '€').map((k) => k.t);
  if (morceaux.length === 0) return null;
  const s = morceaux.join('');
  return nombreFR(s) ?? nombreEN(s);
}

function parserEInvoice(pages) {
  const doc = nouveauDoc();
  doc.format = 'e-invoice';
  let dansCorps = false;
  let courant = null;
  let enAttenteValeurs = null;
  let sommeBl = 0;
  let typeAttendu = false;
  let numeroAttendu = false;
  for (const page of pages) {
    const lignes = lignesDepuisMots(page.words, { toleranceY: 2.5 });
    for (const ligne of lignes) {
      const t = ligne.tokens;
      const texte = t.map((k) => k.t).join(' ');
      if (texte.startsWith('Type de vente')) { if (t.length > 3) { doc.type = /avoir/i.test(texte) ? 'avoir' : 'facture'; } else typeAttendu = true; continue; }
      if (typeAttendu && t[0]?.x0 > 100) { doc.type = /avoir/i.test(texte) ? 'avoir' : 'facture'; typeAttendu = false; }
      if (/^(Facture|Avoir) n°/.test(texte) || texte.startsWith('Numéro')) { numeroAttendu = true; }
      if (numeroAttendu) { const n = t.filter((k) => k.x0 > 100).map((k) => k.t).find((m) => /^\d{8,}$/.test(m)); if (n) { doc.numero = doc.numero ?? n; numeroAttendu = false; } }
      if (/^Date (de facture|d.émission)/.test(texte)) { const d = t.map((k) => dateFR(k.t)).find(Boolean); if (d) doc.date = doc.date ?? d; }
      if (!dansCorps) {
        if (t[0]?.t === 'Produits' && t.some((k) => k.t === 'Qté')) dansCorps = true;
        continue;
      }
      if (t[0]?.t === 'Sous-total' || t[0]?.t === 'Détails') { dansCorps = false; courant = null; continue; }
      if (t[0]?.x0 > 100 || ligne.y > 790) continue; // pied de page (RCS…), hors colonne produits
      const valeurs = { quantite: valeurEi(t, COL_EI.produit, COL_EI.quantite), pu: valeurEi(t, COL_EI.quantite, COL_EI.pu), tva: valeurEi(t, COL_EI.pu, COL_EI.tva), total: valeurEi(t, COL_EI.tva, 600) };
      const texteGauche = t.filter((k) => k.x0 < COL_EI.produit).map((k) => k.t);
      // Nom de l'article et ligne de valeurs sont à 1 pt l'une de l'autre (souvent fondues en une seule ligne ici).
      if (valeurs.quantite != null && (texteGauche.length > 0 || enAttenteValeurs)) {
        const art = enAttenteValeurs ?? nouvelArticle('', texteGauche.join(' '), page.num);
        art.quantite = valeurs.quantite;
        art.prix_unitaire_net = valeurs.pu;
        art.tva_taux = valeurs.tva;
        art.montant_ht = valeurs.total; // Total HT de la ligne, éco-participation comprise (détaillée en dessous)
        if (art.montant_ht != null) sommeBl += art.montant_ht;
        doc.lignes.push(art);
        courant = art;
        enAttenteValeurs = null;
        continue;
      }
      if (texteGauche[0] === 'TOTAL' && texteGauche[1] === 'BL') {
        const total = nombreEN(texteGauche[2]) ?? nombreFR(texteGauche[2]);
        if (total != null && Math.abs(centimes(sommeBl) - total) > 0.011) doc.anomalies.push(`TOTAL BL ${total} ≠ somme des lignes ${centimes(sommeBl)}`);
        sommeBl = 0;
        continue;
      }
      if (texteGauche[0]?.startsWith('ECO-PARTICIPATION')) {
        const montant = nombreEN(texteGauche[texteGauche.length - 1]) ?? nombreFR(texteGauche[texteGauche.length - 1]);
        if (courant && montant != null) { courant.eco = centimes((courant.eco ?? 0) + montant); }
        else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : éco-participation sans article (${texte})`);
        continue;
      }
      if (texteGauche.length === 1 && texteGauche[0].includes('PROMO')) { if (courant) courant.promo = true; continue; }
      if (texteGauche.length === 1 && CODE_ARTICLE.test(texteGauche[0]) && courant && !courant.code) { courant.code = texteGauche[0]; continue; }
      if (enAttenteValeurs) { doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : article « ${enAttenteValeurs.designation} » sans ligne de valeurs`); enAttenteValeurs = null; }
      // Nom d'article dont la ligne de valeurs n'a pas été fondue : elle suit immédiatement, seule dans les colonnes chiffrées.
      const suivante = lignes[lignes.indexOf(ligne) + 1];
      const suivanteValeurs = suivante && suivante.tokens.every((k) => k.x0 >= COL_EI.produit) && valeurEi(suivante.tokens, COL_EI.produit, COL_EI.quantite) != null;
      if (suivanteValeurs) { enAttenteValeurs = nouvelArticle('', texteGauche.join(' '), page.num); continue; }
      if (courant && courant.code) rattacherComplement(courant, texteGauche);
      else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : ligne inattendue (${texte})`);
    }
    lireTotauxEInvoice(lignes, doc.totaux);
  }
  for (const l of doc.lignes) {
    if (!l.code) doc.anomalies.push(`article « ${l.designation} » sans code`);
    if (l.quantite == null || l.prix_unitaire_net == null || l.montant_ht == null) doc.anomalies.push(`article incomplet ${l.code || l.designation}`);
    else if (Math.abs(l.quantite * l.prix_unitaire_net + (l.eco ?? 0) - l.montant_ht) > 0.011) doc.anomalies.push(`${l.code} : ${l.quantite} × ${l.prix_unitaire_net} + éco ${l.eco ?? 0} ≠ total ${l.montant_ht}`);
  }
  if (!doc.numero) doc.anomalies.push('numéro de facture introuvable');
  const net = centimes(doc.lignes.reduce((s, l) => s + (l.montant_ht ?? 0), 0));
  if (doc.totaux.marchandises_ht != null && Math.abs(net - doc.totaux.marchandises_ht) > 0.011) {
    doc.anomalies.push(`somme des lignes ${net} ≠ Total montant net des lignes ${doc.totaux.marchandises_ht}`);
  }
  return doc;
}

/** Tableau « Ensemble des informations de la facture » : net des lignes, frais, total HT / TTC. */
function lireTotauxEInvoice(lignes, totaux) {
  for (const ligne of lignes) {
    const t = ligne.tokens;
    const texte = t.map((k) => k.t).join(' ');
    const montant = valeurEi(t, 500, 600);
    if (montant == null) continue;
    if (texte.startsWith('Total montant net des lignes')) totaux.marchandises_ht = montant;
    else if (texte.startsWith('Frais de port')) totaux.frais['Port'] = montant;
    else if (texte.startsWith('Frais Fixe')) totaux.frais['F.G.'] = montant;
    else if (texte.startsWith('Total frais')) totaux.frais['Total'] = montant;
    else if (/^Total HT\b/.test(texte) || / Total HT \d/.test(texte)) totaux.total_ht = valeurEi(t, 500, 600);
    else if (/Total TTC/.test(texte)) totaux.ttc = montant;
  }
}
