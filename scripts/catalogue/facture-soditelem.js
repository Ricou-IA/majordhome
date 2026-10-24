// scripts/catalogue/facture-soditelem.js
// Lecture d'un relevé mensuel SODITELEM (facture ou avoir, PDF natif Foxit) à partir des mots positionnés.
// Mise en page (A4 595 pt) : en-tête de colonnes « Code article | DESIGNATION | Qté | Prix de base | R1% | R2% |
// P.U.net | H.T. », groupes « BL n° … du … Réf doc:… » (BR pour un avoir), puis chaque article sur DEUX lignes de
// base quasi confondues : code + P.U. net + H.T. sur l'une, désignation + quantité + prix de base + remises sur
// l'autre (regroupées ici par la tolérance verticale). Les lignes « DEEE : x » suivent l'article qu'elles taxent.
// Les prix sont au format anglo-saxon (« 1058.2000 »). Module PUR, testé scripts/catalogue/facture-soditelem.test.mjs.
import { lignesDepuisMots, nombreEN, centimes, dateFR } from './pdf-lignes.js';

/** Colonnes par abscisse de départ du token (gabarit constant des relevés SODITELEM). */
const COL = Object.freeze({ code: 100, designation: 248, quantite: 300, prixBase: 360, r1: 388, r2: 415, puNet: 478 });

/** La police du PDF encode quelques accents en glyphes du jeu DOS (« VΘrification », « 90░ »). */
const GLYPHES = Object.freeze({ 'Θ': 'é', 'Φ': 'è', 'α': 'à', '░': '°', 'Σ': 'ê', 'ε': 'ë', 'ß': 'ç', 'ⁿ': 'ù', '∩': 'î', 'Γ': 'â' });

/** @param {string} s */
export function corrigerGlyphesSoditelem(s) {
  return String(s).replace(/[ΘΦα░ΣεßⁿΓ∩]/g, (c) => GLYPHES[c] ?? c);
}

function colonne(x0) {
  if (x0 < COL.code) return 'code';
  if (x0 < COL.designation) return 'designation';
  if (x0 < COL.quantite) return 'quantite';
  if (x0 < COL.prixBase) return 'prixBase';
  if (x0 < COL.r1) return 'r1';
  if (x0 < COL.r2) return 'r2';
  if (x0 < COL.puNet) return 'puNet';
  return 'ht';
}

/**
 * @param {Array<{ num:number, words: Array<{x0:number,y0:number,x1:number,y1:number,t:string}> }>} pages
 * @returns {{ fournisseur:'SODITELEM', type:'facture'|'avoir'|null, numero:string|null, date:string|null,
 *   lignes: Array<{ code:string, designation:string, quantite:number|null, unite:'pièce', prix_base:number|null,
 *     remises:number[], prix_unitaire_net:number|null, montant_ht:number|null, deee:number|null, tva_taux:20,
 *     bl:{ numero:string|null, date:string|null, ref:string|null }, page:number }>,
 *   annules: Array<{ code:string, designation:string, bl:object }>,
 *   totaux: { frais_fixes:number|null, port:number|null, deee:number|null, total_ht:number|null, ttc:number|null },
 *   anomalies: string[] }}
 */
export function parserFactureSoditelem(pages) {
  const doc = { fournisseur: 'SODITELEM', type: null, numero: null, date: null, lignes: [], annules: [], totaux: { frais_fixes: null, port: null, deee: null, total_ht: null, ttc: null }, anomalies: [] };
  let bl = { numero: null, date: null, ref: null };
  for (const page of pages) {
    let dansCorps = false;
    for (const ligne of lignesDepuisMots(page.words, { toleranceY: 3.2 })) {
      const t = ligne.tokens;
      const texte = t.map((k) => k.t).join(' ');
      if (!dansCorps) {
        if (t[0]?.x0 < 20 && (t[0].t === 'FACTURE' || t[0].t === 'AVOIR') && t.length === 1) doc.type = t[0].t === 'AVOIR' ? 'avoir' : 'facture';
        else if (t[0]?.t === 'N°' && t[2]?.t === 'DU') { doc.numero = doc.numero ?? t[1].t; doc.date = doc.date ?? dateFR(t[3]?.t); }
        else if (texte.startsWith('Code article') && texte.includes('H.T.')) dansCorps = true;
        continue;
      }
      // Pied de page : totaux puis adresses des agences.
      if (/^(Dont|TOTAL|MONTANT|Conditions)\b/.test(texte) || t.some((k) => k.t === 'F.F') || ligne.y > 725) {
        lireTotaux(t, texte, doc.totaux);
        if (/^(Conditions|Montant)\b/.test(texte) || ligne.y > 725) dansCorps = false;
        continue;
      }
      if ((t[0]?.t === 'BL' || t[0]?.t === 'BR') && t[1]?.t === 'n°') {
        const iDoc = t.findIndex((k) => k.t.startsWith('doc:'));
        bl = { numero: t[2]?.t ?? null, date: dateFR(t[4]?.t), ref: iDoc >= 0 ? [t[iDoc].t.slice(4), ...t.slice(iDoc + 1).map((k) => k.t)].join(' ').trim() || null : null };
        continue;
      }
      if (t.some((k) => k.t === 'DEEE')) {
        const derniere = doc.lignes[doc.lignes.length - 1];
        const val = nombreEN(t[t.length - 1].t);
        if (derniere && val != null) derniere.deee = centimes((derniere.deee ?? 0) + val);
        else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : DEEE sans article (${texte})`);
        continue;
      }
      if (texte.startsWith('Frais de port')) continue; // mention informative : le port facturé figure au pied (« Dont frais de port »)
      const parCol = { code: [], designation: [], quantite: [], prixBase: [], r1: [], r2: [], puNet: [], ht: [] };
      for (const k of t) parCol[colonne(k.x0)].push(k.t);
      if (parCol.code.length === 0) {
        // Suite de désignation (aucun nombre dans les colonnes chiffrées) : rattachée à l'article précédent.
        const derniere = doc.lignes[doc.lignes.length - 1];
        const chiffres = [...parCol.quantite, ...parCol.prixBase, ...parCol.puNet, ...parCol.ht];
        if (derniere && chiffres.length === 0 && parCol.designation.length) derniere.designation += ` ${corrigerGlyphesSoditelem(parCol.designation.join(' '))}`;
        else doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : ligne sans code article (${texte})`);
        continue;
      }
      const art = {
        code: parCol.code.join(''),
        designation: corrigerGlyphesSoditelem(parCol.designation.join(' ')).trim(),
        quantite: parCol.quantite.length ? nombreEN(parCol.quantite[0]) : null,
        unite: 'pièce',
        prix_base: parCol.prixBase.length ? nombreEN(parCol.prixBase[0]) : null,
        remises: [...parCol.r1, ...parCol.r2].map(nombreEN).filter((v) => v != null),
        prix_unitaire_net: parCol.puNet.length ? nombreEN(parCol.puNet[0]) : null,
        montant_ht: parCol.ht.length ? nombreEN(parCol.ht[0]) : null,
        deee: null,
        tva_taux: 20,
        bl: { ...bl },
        page: page.num,
      };
      if (art.quantite == null && art.montant_ht == null && /ANNULE/i.test(bl.ref ?? '')) {
        doc.annules.push({ code: art.code, designation: art.designation, bl: { ...bl } }); // BL annulé : lignes sans quantité ni montant
        continue;
      }
      if (!art.designation || art.prix_unitaire_net == null || art.quantite == null) {
        doc.anomalies.push(`p${page.num} y${Math.round(ligne.y)} : article incomplet ${art.code} (${texte})`);
      } else {
        if (art.prix_base != null) {
          const net = art.remises.reduce((p, r) => p * (1 - r / 100), art.prix_base);
          if (Math.abs(net - art.prix_unitaire_net) > 0.011) doc.anomalies.push(`${art.code} : prix de base ${art.prix_base} − remises ${art.remises.join('/')} ≠ P.U. net ${art.prix_unitaire_net}`);
        }
        if (art.montant_ht != null && Math.abs(art.prix_unitaire_net * art.quantite - art.montant_ht) > 0.011) {
          doc.anomalies.push(`${art.code} : ${art.quantite} × ${art.prix_unitaire_net} ≠ H.T. ${art.montant_ht}`);
        }
      }
      doc.lignes.push(art);
    }
  }
  if (!doc.numero) doc.anomalies.push('numéro de facture introuvable');
  const sommeLignes = centimes(doc.lignes.reduce((s, l) => s + (l.montant_ht ?? 0) + (l.deee ?? 0), 0) + (doc.totaux.frais_fixes ?? 0) + (doc.totaux.port ?? 0));
  if (doc.totaux.total_ht != null && Math.abs(sommeLignes - doc.totaux.total_ht) > 0.011) {
    doc.anomalies.push(`somme des lignes ${sommeLignes} ≠ TOTAL H.T NET ${doc.totaux.total_ht}`);
  }
  return doc;
}

function lireTotaux(t, texte, totaux) {
  const nombres = t.map((k) => nombreEN(k.t));
  const apres = (motif) => { const i = t.findIndex((k) => k.t === motif); for (let j = i + 1; i >= 0 && j < t.length; j++) if (nombres[j] != null) return nombres[j]; return null; };
  if (t.some((k) => k.t === 'F.F')) totaux.frais_fixes = apres('F.F');
  if (texte.includes('Dont frais de port')) {
    const iPort = t.findIndex((k) => k.t === 'H.T.:');
    const iD3E = t.findIndex((k) => k.t === 'D3E');
    if (iPort >= 0 && nombres[iPort + 1] != null && (iD3E < 0 || iPort + 1 < iD3E - 1)) totaux.port = nombres[iPort + 1];
    if (iD3E >= 0 && t[iD3E + 1]?.t === ':' && nombres[iD3E + 2] != null) totaux.deee = nombres[iD3E + 2];
    if (texte.includes('TOTAL H.T NET')) totaux.total_ht = nombres[nombres.length - 1];
  } else if (texte.startsWith('TOTAL T.T.C')) totaux.ttc = nombres[nombres.length - 1];
}
