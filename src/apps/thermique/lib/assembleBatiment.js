// src/apps/thermique/lib/assembleBatiment.js
// L'ASSEMBLEUR (plan 4) : dessin (plan 3) + données de référence (plan 1) + choix wizard
// → bâtiment résolu pour calculeBatiment (plan 2). Module PUR (aucun import React/Supabase ni JSON).
// Formalise D1-D11 de docs/thermique-plan4-handoff.md — chaque règle est marquée « Dn ».
import { adjacencesNiveau } from './geometryEngine.js';
import { uDefautPour, coefficientBPour } from './refDataResolvers.js';

// D4 : libellés exacts de coefficients-b.json (catégorie « Pièce »), vérifiés par test contre le JSON.
const B_PIECE = {
  0: 'Avec seulement 1 mur extérieur', // enclavé : assimilé 1 mur + avertissement
  1: 'Avec seulement 1 mur extérieur',
  2: 'Avec seulement 2 murs extérieurs sans portes extérieures',
  '2p': 'Avec au moins 2 murs extérieurs et des portes extérieures',
  3: 'Avec au moins 3 murs extérieurs (par ex. escalier extérieur)',
};
// D9 : catégorie « Espace sous toiture »
const B_COMBLE = {
  isole: 'Toiture isolée',
  'non-isole': 'Autres toitures non isolée',
  'fortement-ventile': 'Espace sous toiture fortement ventilé sans feutre ni panneau en sous face',
};

/**
 * b par pièce NON chauffée (D4) : compte ses murs extérieurs (segments du polygone ayant ≥ 1
 * sous-segment adjacent:null sur SON niveau) ; « portes extérieures » = ouverture type 'porte'
 * dessinée sur la pièce. Exporté pour tests.
 * @returns {{ bParPiece: Map<*, number>, avertissements: string[] }}
 */
export function bLncParPiece(dessin, coefficientsB) {
  const bParPiece = new Map();
  const avertissements = [];
  for (const niveau of dessin.niveaux) {
    const piecesNiveau = dessin.pieces.filter((p) => p.niveauId === niveau.id);
    if (!piecesNiveau.some((p) => !p.chauffee)) continue;
    const { parPiece } = adjacencesNiveau(piecesNiveau);
    for (const piece of piecesNiveau) {
      if (piece.chauffee) continue;
      const sous = parPiece.get(piece.id) ?? [];
      const mursExt = new Set(
        sous.filter((s) => s.adjacent === null && s.longueur > 0).map((s) => s.segmentIndex),
      ).size;
      const aPorteExt = dessin.ouvertures.some((o) => o.pieceId === piece.id && o.type === 'porte');
      let cle;
      if (mursExt >= 3) cle = 3;
      else if (mursExt === 2) cle = aPorteExt ? '2p' : 2;
      else cle = mursExt; // 0 ou 1
      if (mursExt === 0) {
        avertissements.push(`« ${piece.nom ?? piece.id} » (non chauffée) n'a aucun mur extérieur — b minimal 0.4 appliqué`);
      }
      bParPiece.set(piece.id, coefficientBPour(coefficientsB, 'Pièce', B_PIECE[cle]));
    }
  }
  return { bParPiece, avertissements };
}

const FAMILLE_PAR_TYPE = {
  'mur-exterieur': 'murs', 'mur-lnc': 'murs', 'mur-mitoyen-interne': 'murs',
  fenetre: 'fenetre', porte: 'porte', 'porte-fenetre': 'porteFenetre',
  'plancher-bas': 'plancherBas', 'plancher-sur-exterieur': 'plancherBas', 'plancher-sur-lnc': 'plancherBas',
  'plafond-comble': 'plafondToiture', 'plafond-sur-lnc': 'plafondToiture', 'toiture-rampant': 'plafondToiture',
};
const POSTE_PAR_FAMILLE = {
  murs: 'murs', fenetre: 'menuiseries', porte: 'menuiseries', porteFenetre: 'menuiseries',
  plancherBas: 'plancherBas', plafondToiture: 'plafondToiture',
};
const TYPE_U_DEFAUT = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/** U résolu pour une paroi : exception ouverture > exception (pièce × famille) > famille (mode défaut/valeur). */
function uPour(paroi, famille, ctx) {
  const excO = paroi.ouvertureId != null ? ctx.compositions.exceptions?.ouvertures?.[paroi.ouvertureId] : null;
  if (excO && Number.isFinite(excO.u)) return excO.u;
  const excP = ctx.compositions.exceptions?.parois?.[`${paroi.pieceId}:${famille}`];
  if (excP && Number.isFinite(excP.u)) return excP.u;
  const fam = ctx.compositions.familles[famille] ?? {};
  if (fam.mode === 'defaut' && TYPE_U_DEFAUT[famille]) {
    return uDefautPour(ctx.uDefauts, TYPE_U_DEFAUT[famille], ctx.annee);
  }
  return Number.isFinite(fam.u) ? fam.u : null;
}

/**
 * Résout UNE paroi géométrique (sortie deduireParois) en paroi moteur (D3-D7, D9-D11).
 * ctx = { annee, uDefauts, coefficientsB, compositions, deltaUtb, bParPieceLnc,
 *         thetaIntParPiece, combleIsolation, bPlancherBas }. Exporté pour tests.
 * @returns {{ paroi: object|null, erreur: string|null }}
 */
export function resoudParoi(paroi, ctx) {
  const famille = FAMILLE_PAR_TYPE[paroi.type];
  if (!famille) throw new Error(`thermique: type de paroi inconnu « ${paroi.type} »`);
  const u = uPour(paroi, famille, ctx);
  if (!Number.isFinite(u) || u <= 0) {
    return { paroi: null, erreur: `U manquant pour « ${famille} » (paroi ${paroi.type} de la pièce ${paroi.pieceId})` };
  }
  const base = {
    surface: paroi.surfaceM2, u, poste: POSTE_PAR_FAMILLE[famille],
    type: paroi.type, orientation: paroi.orientation ?? null, pieceId: paroi.pieceId,
  };

  // Référence de température : b OU thetaAdjacente (D5, D7, D9, D11)
  if (paroi.type === 'mur-mitoyen-interne') {
    const theta = ctx.thetaIntParPiece.get(paroi.adjacentPieceId);
    return { paroi: { ...base, thetaAdjacente: theta, deltaUtb: 0 }, erreur: null }; // D7
  }
  if (famille === 'fenetre' || famille === 'porte' || famille === 'porteFenetre') {
    if (paroi.adjacentPieceId != null) {
      const thetaVoisine = ctx.thetaIntParPiece.get(paroi.adjacentPieceId);
      if (thetaVoisine != null) { // D11 : menuiserie sur mitoyen chauffé émis → θadjacente, ΔUtb 0
        return { paroi: { ...base, thetaAdjacente: thetaVoisine, deltaUtb: 0 }, erreur: null };
      }
      const bLnc = ctx.bParPieceLnc.get(paroi.adjacentPieceId) ?? 1; // D11 : menuiserie sur LNC
      return { paroi: { ...base, b: bLnc, deltaUtb: ctx.deltaUtb }, erreur: null };
    }
    return { paroi: { ...base, b: 1, deltaUtb: ctx.deltaUtb }, erreur: null };
  }
  let b = 1;
  if (paroi.type === 'mur-lnc' || paroi.type === 'plancher-sur-lnc' || paroi.type === 'plafond-sur-lnc') {
    b = ctx.bParPieceLnc.get(paroi.adjacentPieceId) ?? 1; // D4
  } else if (paroi.type === 'plancher-bas') {
    b = ctx.bPlancherBas; // D5 (résolu une fois par étude)
  } else if (paroi.type === 'plafond-comble') {
    b = coefficientBPour(ctx.coefficientsB, 'Espace sous toiture', B_COMBLE[ctx.combleIsolation] ?? B_COMBLE.isole); // D9
  }
  // 'mur-exterieur', 'plancher-sur-exterieur', 'toiture-rampant' → b 1 (D5/D9/D10)
  return { paroi: { ...base, b, deltaUtb: ctx.deltaUtb }, erreur: null };
}

/** b du plancher bas selon le type (D5). Exporté pour tests. */
export function bPlancherBasPour(coefficientsB, plancherBasType, sousSolAvecOuvertures = false) {
  if (plancherBasType === 'vide-sanitaire') {
    return coefficientBPour(coefficientsB, 'Vide sanitaire', 'Vide sanitaire très faiblement ventilé');
  }
  if (plancherBasType === 'sous-sol') {
    return coefficientBPour(coefficientsB, 'Sous-sol',
      sousSolAvecOuvertures ? 'Avec fenêtres ou portes extérieures' : 'Sans fenêtre ni porte extérieure');
  }
  return 1; // terre-plein (pas d'ISO 13370 v1 — assumé)
}
