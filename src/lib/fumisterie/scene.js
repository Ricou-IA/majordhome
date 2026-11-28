// src/lib/fumisterie/scene.js
// Scène de la coupe cotée — module PUR, seule définition du dessin d'un métré. Elle produit des
// primitives en pixels (repère écran, y vers le bas) que deux rendus dessinent sans rien calculer :
// le SVG de l'écran (CoupeCotee.jsx) et le plan annexé au devis (pdf/CoupePdf.jsx). Sans elle, les
// deux dessins divergeraient. Les formules sont celles des anciennes coupes par gabarit, à l'identique
// (même ordre de dessin, mêmes valeurs) : le SVG de l'écran est resté le même au caractère près.
//
// Primitives : { type: 'rect'|'polygon'|'polyline'|'line'|'texte', ton, … } — `ton` est une clé que
// chaque rendu traduit (classe Tailwind à l'écran, couleur dans le PDF). Cotes et repères à part.

const fmt = (v) => Number(v).toFixed(2).replace('.', ',');
const rad = (d) => (d * Math.PI) / 180;

/** Familles de dessin : un gabarit du moteur → une coupe. */
const FAMILLE = { G1: 'G1', G3: 'G3', G3P: 'G3', G4: 'G4', G4R: 'G4', G4P: 'G4', G4K: 'G4', G4F: 'G4', G5: 'G4', G6: 'G6' };

/** Titre accessible de la coupe, par famille. */
const TITRE = {
  G1: 'Coupe du conduit avec cotes',
  G3: 'Coupe du conduit en façade avec cotes',
  G4: 'Coupe du tubage avec cotes',
  G6: 'Coupe de la sortie en façade avec cotes',
};

/**
 * Outils de dessin d'une coupe : transformation monde (m) → pixels, et fabriques de primitives.
 * @param {{ minX:number, maxY:number, sc:number, k:number }} p
 */
function atelier({ minX, maxY, sc, k }) {
  const X = (x) => (x - minX) * sc;
  const Y = (y) => (maxY - y) * sc;
  const formes = []; const cotes = []; const reperes = [];
  const pts = (arr) => arr.map(([x, y]) => [X(x), Y(y)]);
  const ajout = (f) => { formes.push(f); return f; };
  const cote = (cle, libelle, x1, y1, x2, y2, horizontal = false, side = 'l') => {
    const texte = `${fmt(horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1))} m`;
    const bw = (texte.length * 8.2 + 10) * k;
    const mx = horizontal ? (X(x1) + X(x2)) / 2 : (side === 'r' ? X(x1) + 6 * k + bw / 2 : X(x1) - 6 * k - bw / 2);
    const my = horizontal ? Y(y1) - 16 * k : (Y(y1) + Y(y2)) / 2;
    const t = 5 * k;
    const ticks = horizontal
      ? [x1, x2].map((x) => ({ x1: X(x) - t, y1: Y(y1) + t, x2: X(x) + t, y2: Y(y1) - t }))
      : [y1, y2].map((y) => ({ x1: X(x1) - t, y1: Y(y) + t, x2: X(x1) + t, y2: Y(y) - t }));
    cotes.push({ cle, libelle, texte, ligne: { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) }, ticks,
      boite: { x: mx - bw / 2, y: my - 11 * k, w: bw, h: 22 * k }, texteX: mx, texteY: my + 4.5 * k });
  };
  const repere = (n, x, y, lx, ly) => {
    reperes.push({ n, ligne: { x1: X(x), y1: Y(y), x2: X(lx), y2: Y(ly) }, cx: X(lx), cy: Y(ly), r: 12 * k });
  };
  return { X, Y, pts, ajout, cote, repere, formes, cotes, reperes };
}

/** Libellé de la ligne d'exigence de hauteur (le rendu ajoute l'état : ✓ / ⚠ à l'écran, mots dans le PDF). */
const libelleZone = (c) => (c.flat ? `Toit plat : +${c.reqAbove.toFixed(2).replace('.', ',')} m` : `Faîtage + ${Math.round(c.reqAbove * 100)} cm (zone 1)`);

function sceneG1(c, i, k) {
  const tp = Math.tan(rad(Math.max(i.pente, 1)));
  const dec = c.dec; const xr = dec + i.dFaitage;
  const yTop = (x) => c.yRoofTop + (x <= xr ? (x - dec) : (2 * xr - x - dec)) * tp;
  let xL = dec - (c.yRoofTop - i.epToit - c.yC) / tp; xL = Math.max(Math.min(xL, -1.1), -5.5);
  const xR = Math.min(xr + (xr - xL), xr + 6);
  const topY = Math.max(c.topAct, c.yReq, c.yRidge) + 0.55;
  const minX = xL - 3.3; const maxX = Math.max(xR, dec + 1.2) + 2.4; const minY = -0.45; const maxY = topY + 0.25;
  const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
  const a = atelier({ minX, maxY, sc, k });
  const { X, Y, pts, ajout, cote, repere } = a;
  const zoneOK = c.topAct >= c.yReq - 1e-6;
  const inox = i.finition === 'inox';
  const pw = Math.max(6, (i.diametre >= 180 ? 0.24 : 0.21) * sc);
  const over = 0.45; const xa = xL - over; const xb = xR + over; const aw = 0.62; const cw = 0.36; const sw = 0.34;
  const dx1 = xL - 0.55; const dx2 = xL - 1.35;
  const slabs = [i.hsp1]; if (i.nbEtages) slabs.push(i.hsp1 + i.epPl + i.hsp2);
  const intPts = i.angle > 0 ? [[0, i.hsp1], [0, c.yDevS], [dec, c.yDevE], [dec, c.yRoofTop]] : [[0, i.hsp1], [0, c.yRoofTop]];
  ajout({ type: 'rect', ton: 'sol', x: X(xL - 0.6), y: Y(0), w: (xR - xL + 1.2) * sc, h: 0.35 * sc });
  ajout({ type: 'polygon', ton: 'maison', points: pts([[xL, 0], [xL, yTop(xL) - i.epToit], [xr, yTop(xr) - i.epToit], [xR, yTop(xR) - i.epToit], [xR, 0]]) });
  for (const y of slabs) ajout({ type: 'rect', ton: 'sol', x: X(xL), y: Y(y + i.epPl), w: (xR - xL) * sc, h: i.epPl * sc });
  ajout({ type: 'polygon', ton: 'toit', points: pts([[xa, yTop(xa)], [xr, yTop(xr)], [xb, yTop(xb)], [xb, yTop(xb) - i.epToit], [xr, yTop(xr) - i.epToit], [xa, yTop(xa) - i.epToit]]) });
  ajout({ type: 'polyline', ton: 'traitToit', points: pts([[xa, yTop(xa)], [xr, yTop(xr)], [xb, yTop(xb)]]), epaisseur: 1.2 });
  ajout({ type: 'rect', ton: 'appareil', x: X(-aw / 2), y: Y(i.hBuse - 0.06), w: aw * sc, h: (i.hBuse - 0.06) * sc, arrondi: 4 });
  ajout({ type: 'rect', ton: 'foyer', x: X(-aw / 2 + 0.1), y: Y(i.hBuse * 0.62), w: (aw - 0.2) * sc, h: i.hBuse * 0.3 * sc, arrondi: 2 });
  ajout({ type: 'line', ton: 'raccord', x1: X(0), y1: Y(i.hBuse - 0.06), x2: X(0), y2: Y(i.hsp1), epaisseur: Math.max(4, pw * 0.62) });
  ajout({ type: 'polyline', ton: 'conduit', points: pts(intPts), epaisseur: pw, jointure: 'round' });
  ajout({ type: 'polyline', ton: 'ame', points: pts(intPts), epaisseur: Math.max(1.5, pw * 0.28), jointure: 'round' });
  ajout({ type: 'line', ton: inox ? 'conduitInox' : 'conduitNoir', x1: X(dec), y1: Y(c.yRoofTop - 0.02), x2: X(dec), y2: Y(c.topAct), epaisseur: pw });
  ajout({ type: 'polygon', ton: 'piece', points: pts([[dec - sw, yTop(dec - sw) + 0.03], [dec + sw, yTop(dec + sw) + 0.03], [dec + pw / sc * 0.7, yTop(dec) + 0.28], [dec - pw / sc * 0.7, yTop(dec) + 0.22]]) });
  ajout({ type: 'rect', ton: inox ? 'finitionInox' : 'finitionNoir', x: X(dec - cw / 2), y: Y(c.topAct + 0.12), w: cw * sc, h: 0.045 * sc, arrondi: 2 });
  ajout({ type: 'rect', ton: inox ? 'finitionInox' : 'finitionNoir', x: X(dec - 0.07), y: Y(c.topAct + 0.08), w: 0.14 * sc, h: 0.08 * sc });
  ajout({ type: 'line', ton: 'faitage', x1: X(xr - 1.2), y1: Y(c.yRidge), x2: X(maxX - 0.2), y2: Y(c.yRidge), pointille: '4 4' });
  ajout({ type: 'texte', ton: 'legende', x: X(xr) + 8, y: Y(c.yRidge) + 15, texte: 'Faîtage', taille: 12 * k });
  ajout({ type: 'line', ton: zoneOK ? 'zoneOk' : 'zoneKo', x1: X(dec - 0.9), y1: Y(c.yReq), x2: X(maxX - 0.2), y2: Y(c.yReq), pointille: '8 5', epaisseur: 2.2 });
  ajout({ type: 'texte', ton: 'zoneTexte', x: X(maxX - 0.2), y: Y(c.yReq) - 7, ancre: 'end', texte: libelleZone(c), etat: zoneOK ? 'ok' : 'ko', taille: 12.5 * k, gras: true });
  cote('hBuse', 'Hauteur de buse', dx1, 0, dx1, i.hBuse);
  cote('hBuse', 'Raccordement simple paroi (calculé)', dx1, i.hBuse, dx1, i.hsp1);
  cote('hsp1', 'Hauteur sous plafond', dx2, 0, dx2, i.hsp1);
  if (i.nbEtages) cote('hsp2', 'Hauteur étage', dx2, i.hsp1 + i.epPl, dx2, i.hsp1 + i.epPl + i.hsp2);
  cote('hCombles', 'Hauteur combles', dx2, c.yC, dx2, c.yC + i.hCombles);
  cote('hSortie', 'Hauteur de sortie au-dessus du toit', Math.max(xR, dec + 0.6) + 0.6, c.yRoofTop, Math.max(xR, dec + 0.6) + 0.6, c.topAct, false, 'r');
  if (i.angle > 0) cote('decal', 'Décalage du dévoiement', 0, c.yDevS - 0.35, dec, c.yDevS - 0.35, true);
  if (i.dFaitage > 0.05) cote('dFaitage', 'Distance sortie → faîtage', dec, Math.max(c.topAct, c.yReq) + 0.35, xr, Math.max(c.topAct, c.yReq) + 0.35, true);
  repere(1, dec - cw / 2, c.topAct + 0.12, dec - 0.85, c.topAct + 0.25);
  repere(2, dec, (c.yRoofTop + c.topAct) / 2 + 0.1, dec - 0.85, (c.yRoofTop + c.topAct) / 2 + 0.1);
  repere(3, dec - sw * 0.6, yTop(dec - sw * 0.6) + 0.05, dec - 1.05, yTop(dec) - 0.45);
  if (i.angle > 0) repere(4, dec / 2, (c.yDevS + c.yDevE) / 2, 0.8 + dec, (c.yDevS + c.yDevE) / 2 - 0.1);
  else repere(4, 0, (c.yC + c.yRoofTop) / 2, 0.8, (c.yC + c.yRoofTop) / 2);
  repere(5, 0, i.hsp1 + i.epPl / 2, 0.9, i.hsp1 + i.epPl / 2 + 0.35);
  repere(6, 0, (i.hBuse + i.hsp1) / 2, 0.85, (i.hBuse + i.hsp1) / 2);
  return { largeur: (maxX - minX) * sc, hauteur: (maxY - minY) * sc, ...a };
}

function sceneG3(c, i, k) {
  const xMur = Number(i.lHoriz); const ep = Number(i.epMur); const xC = xMur + ep + 0.2; // axe du conduit extérieur
  const tp = Math.tan(rad(Math.max(Number(i.pente), 1)));
  const xr = -Number(i.dFaitage) + xMur; // faîtage (à gauche : la maison est derrière le mur)
  const minX = Math.min(xr, -1.2) - 1.2; const maxX = xC + 2.4; const minY = -0.4; const maxY = Math.max(c.topAct, c.yReq, c.yRidge) + 0.6;
  const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
  const a = atelier({ minX, maxY, sc, k });
  const { X, Y, pts, ajout, cote, repere } = a;
  const pw = Math.max(6, (Number(i.diametre) >= 180 ? 0.24 : 0.21) * sc);
  const inox = i.finition === 'inox';
  const zoneOK = c.topAct >= c.yReq - 1e-6;
  const yToit = (x) => c.yEgout + Math.max(0, (xMur - x)) * tp; // toit monte vers la gauche jusqu'au faîtage
  const aw = 0.62; const hsp = Number(i.hsp1); const yTe = c.yTe;
  const xL = minX + 0.6;
  ajout({ type: 'rect', ton: 'sol', x: X(minX + 0.2), y: Y(0), w: (maxX - minX - 0.4) * sc, h: 0.3 * sc });
  ajout({ type: 'rect', ton: 'sol', x: X(xL), y: Y(hsp + 0.25), w: (xMur - xL) * sc, h: 0.25 * sc });
  ajout({ type: 'rect', ton: 'mur', x: X(xMur), y: Y(c.yEgout), w: ep * sc, h: c.yEgout * sc });
  ajout({ type: 'polygon', ton: 'toit', points: pts([[xL, yToit(xL)], [xr, yToit(xr)], [xMur + ep, c.yEgout], [xMur + ep, c.yEgout - 0.3], [xL, yToit(xL) - 0.3]]) });
  ajout({ type: 'line', ton: 'faitage', x1: X(xr), y1: Y(c.yRidge), x2: X(maxX - 0.2), y2: Y(c.yRidge), pointille: '4 4' });
  ajout({ type: 'texte', ton: 'legende', x: X(xr) + 8, y: Y(c.yRidge) + 15, texte: 'Faîtage', taille: 12 * k });
  ajout({ type: 'line', ton: zoneOK ? 'zoneOk' : 'zoneKo', x1: X(xC - 0.9), y1: Y(c.yReq), x2: X(maxX - 0.2), y2: Y(c.yReq), pointille: '8 5', epaisseur: 2.2 });
  ajout({ type: 'texte', ton: 'zoneTexte', x: X(maxX - 0.2), y: Y(c.yReq) - 7, ancre: 'end', texte: libelleZone(c), etat: zoneOK ? 'ok' : 'ko', taille: 12.5 * k, gras: true });
  ajout({ type: 'rect', ton: 'appareil', x: X(-aw / 2), y: Y(i.hBuse - 0.06), w: aw * sc, h: (i.hBuse - 0.06) * sc, arrondi: 4 });
  ajout({ type: 'rect', ton: 'foyer', x: X(-aw / 2 + 0.1), y: Y(i.hBuse * 0.62), w: (aw - 0.2) * sc, h: i.hBuse * 0.3 * sc, arrondi: 2 });
  ajout({ type: 'polyline', ton: 'raccord', points: pts([[0, i.hBuse - 0.06], [0, yTe], [xMur, yTe]]), epaisseur: Math.max(4, pw * 0.65), jointure: 'round' });
  ajout({ type: 'line', ton: 'conduit', x1: X(xMur), y1: Y(yTe), x2: X(xC), y2: Y(yTe), epaisseur: pw });
  ajout({ type: 'rect', ton: 'piece', x: X(xC - 0.16), y: Y(yTe - 0.15), w: 0.32 * sc, h: 0.5 * sc, arrondi: 3 });
  ajout({ type: 'line', ton: inox ? 'conduitInox' : 'conduitNoir', x1: X(xC), y1: Y(yTe - 0.15), x2: X(xC), y2: Y(c.topAct), epaisseur: pw });
  ajout({ type: 'rect', ton: inox ? 'finitionInox' : 'finitionNoir', x: X(xC - 0.18), y: Y(c.topAct + 0.12), w: 0.36 * sc, h: 0.045 * sc, arrondi: 2 });
  // supports muraux indicatifs
  for (const y of Array.from({ length: Math.max(1, Math.floor(c.Lfac / 2)) }, (_, n) => yTe + 1 + n * 2).filter((v) => v < c.yEgout + 0.2)) {
    ajout({ type: 'rect', ton: 'piece', x: X(xMur + ep), y: Y(y + 0.04), w: (xC - xMur - ep) * sc, h: 0.08 * sc });
  }
  cote('hBuse', 'Hauteur de buse', -0.75, 0, -0.75, i.hBuse);
  cote('hTraversee', 'Hauteur de la traversée', -1.55, 0, -1.55, yTe);
  cote('lHoriz', 'Distance appareil → mur', 0, yTe + 0.3, xMur, yTe + 0.3, true);
  cote('hMur', 'Hauteur de la façade à l\'égout', xC + 0.75, 0, xC + 0.75, c.yEgout, false, 'r');
  cote('hSortie', 'Hauteur au-dessus de l\'égout', xC + 1.45, c.yEgout, xC + 1.45, c.topAct, false, 'r');
  if (i.dFaitage > 0.05) cote('dFaitage', 'Distance conduit → faîtage', xr, Math.max(c.topAct, c.yReq) + 0.35, xC, Math.max(c.topAct, c.yReq) + 0.35, true);
  repere(1, xC, c.topAct + 0.14, xC - 0.9, c.topAct + 0.3);
  repere(2, xC, (yTe + c.topAct) / 2, xC - 0.9, (yTe + c.topAct) / 2);
  repere(5, xC, yTe, xC + 0.9, yTe - 0.5);
  repere(7, xMur + ep / 2, yTe, xMur - 0.9, yTe - 0.6);
  repere(8, 0, (i.hBuse + yTe) / 2, 0.8, (i.hBuse + yTe) / 2 - 0.2);
  return { largeur: (maxX - minX) * sc, hauteur: (maxY - minY) * sc, ...a };
}

function sceneG4(c, i, k) {
  const mur = c.mur;
  const xB = mur ? Math.max(0.9, Number(i.lHoriz) + 0.45) : 0; // axe du boisseau
  const bw = 0.5; // largeur dessinée du boisseau
  // Raccordement seul (G5) ou foyer : pas de conduit métré → on en dessine 1,5 m à titre indicatif.
  const ySouche = c.ySouche > c.yEntree + 0.2 ? c.ySouche : c.yEntree + 1.5;
  const minX = -2.6; const maxX = xB + bw + 1.6; const minY = -0.4; const maxY = ySouche + 0.9;
  const sc = Math.min(760 / (maxX - minX), 980 / (maxY - minY));
  const a = atelier({ minX, maxY, sc, k });
  const { X, Y, pts, ajout, cote, repere } = a;
  const pw = Math.max(6, (Number(i.diametre) >= 150 ? 0.2 : 0.15) * sc);
  const conduitMetre = c.ySouche > c.yEntree + 0.2;
  const yEntree = c.yEntree; const yS = ySouche;
  const aw = 0.62; const hsp = Number(i.hsp1); const yToit = Math.min(yS - 0.6, hsp + 2.2); // trait de toiture indicatif
  const axeRaccord = mur ? [[0, i.hBuse - 0.06], [0, yEntree], [xB, yEntree]] : [[0, i.hBuse - 0.06], [0, yEntree]];
  const flexPts = [];
  if (!c.rigide) { for (let y = yEntree; y <= yS + 0.15; y += 0.25) flexPts.push([xB + (Math.round(y * 4) % 2 ? 0.035 : -0.035), y]); }
  const dx1 = -0.75; const dx2 = -1.55; const dxB = xB + bw / 2 + 0.55;
  ajout({ type: 'rect', ton: 'sol', x: X(minX + 0.2), y: Y(0), w: (xB + bw + 1.2 - minX - 0.2) * sc, h: 0.3 * sc });
  ajout({ type: 'rect', ton: 'sol', x: X(minX + 0.2), y: Y(hsp + 0.25), w: (xB - bw / 2 - minX - 0.2) * sc, h: 0.25 * sc });
  ajout({ type: 'rect', ton: 'toit', x: X(minX + 0.2), y: Y(yToit), w: (xB - bw / 2 - minX - 0.2) * sc, h: 0.06 * sc });
  ajout({ type: 'texte', ton: 'legende', x: X(minX + 0.3), y: Y(yToit) - 6, texte: 'Toiture (indicative)', taille: 12 * k });
  ajout({ type: 'rect', ton: 'boisseau', x: X(xB - bw / 2), y: Y(yS), w: bw * sc, h: yS * sc, epaisseur: 1.5, pointille: '6 4' });
  ajout({ type: 'texte', ton: 'legende', x: X(xB), y: Y(yToit + 0.35), ancre: 'middle', texte: 'Conduit existant', taille: 12 * k });
  ajout({ type: 'rect', ton: 'piece', x: X(xB - bw / 2 - 0.08), y: Y(yS + 0.05), w: (bw + 0.16) * sc, h: 0.05 * sc });
  ajout({ type: 'rect', ton: 'finitionNoir', x: X(xB - 0.2), y: Y(yS + 0.32), w: 0.4 * sc, h: 0.05 * sc, arrondi: 2 });
  ajout({ type: 'rect', ton: 'finitionNoir', x: X(xB - 0.06), y: Y(yS + 0.27), w: 0.12 * sc, h: 0.22 * sc });
  ajout({ type: 'rect', ton: 'appareil', x: X(-aw / 2), y: Y(i.hBuse - 0.06), w: aw * sc, h: (i.hBuse - 0.06) * sc, arrondi: 4 });
  ajout({ type: 'rect', ton: 'foyer', x: X(-aw / 2 + 0.1), y: Y(i.hBuse * 0.62), w: (aw - 0.2) * sc, h: i.hBuse * 0.3 * sc, arrondi: 2 });
  ajout({ type: 'polyline', ton: 'raccord', points: pts(axeRaccord), epaisseur: Math.max(4, pw * 0.7), jointure: 'round' });
  if (c.rigide) ajout({ type: 'line', ton: 'tubage', x1: X(xB), y1: Y(yEntree), x2: X(xB), y2: Y(yS + 0.15), epaisseur: pw });
  else ajout({ type: 'polyline', ton: 'tubage', points: pts(flexPts), epaisseur: pw, jointure: 'round' });
  if (mur) ajout({ type: 'rect', ton: 'piece', x: X(xB - bw / 2 - 0.12), y: Y(yEntree + 0.16), w: 0.12 * sc, h: 0.32 * sc });
  else ajout({ type: 'rect', ton: 'piece', x: X(xB - 0.3), y: Y(hsp + 0.03), w: 0.6 * sc, h: 0.05 * sc });
  cote('hBuse', 'Hauteur de buse', dx1, 0, dx1, i.hBuse);
  cote('hsp1', 'Hauteur sous plafond', dx2, 0, dx2, hsp);
  if (mur) cote('hEntree', 'Hauteur du piquage', dx1, i.hBuse, dx1, yEntree);
  if (mur) cote('lHoriz', 'Longueur horizontale', 0, yEntree + 0.3, xB - bw / 2, yEntree + 0.3, true);
  if (conduitMetre) cote('hConduit', 'Hauteur du conduit existant', dxB, yEntree, dxB, yS, false, 'r');
  else ajout({ type: 'texte', ton: 'legende', x: X(xB), y: Y(yEntree + 0.75), ancre: 'middle', texte: 'non métré', taille: 12 * k, apresCotes: true });
  repere(1, xB + 0.2, yS + 0.3, xB - 0.9, yS + 0.55);
  repere(2, xB + bw / 2 + 0.05, yS + 0.02, xB - 0.9, yS + 0.05);
  repere(3, xB, (yEntree + yS) / 2, xB - 0.9, (yEntree + yS) / 2);
  if (mur) repere(4, xB - bw / 2 - 0.06, yEntree, xB - 0.9, yEntree - 0.5);
  else repere(4, xB - 0.3, hsp + 0.05, xB - 0.9, hsp - 0.4);
  repere(5, 0, (i.hBuse + yEntree) / 2, 0.75, (i.hBuse + yEntree) / 2 - 0.2);
  return { largeur: (maxX - minX) * sc, hauteur: (maxY - minY) * sc, ...a };
}

function sceneG6(c, i, k) {
  const xMur = Number(i.lHoriz); const ep = Number(i.epMur);
  const minX = -2.2; const maxX = xMur + ep + 1.6; const minY = -0.4; const maxY = Math.max(c.yCoude + 1.2, 3);
  const sc = Math.min(760 / (maxX - minX), 620 / (maxY - minY));
  const a = atelier({ minX, maxY, sc, k });
  const { X, Y, pts, ajout, cote, repere } = a;
  const pw = Math.max(6, 0.18 * sc);
  const aw = 0.62; const yS = c.yCoude;
  const trace = [[0, i.hBuse - 0.06], [0, yS], [xMur + ep + 0.35, yS]];
  ajout({ type: 'rect', ton: 'sol', x: X(minX + 0.2), y: Y(0), w: (maxX - minX - 0.4) * sc, h: 0.3 * sc });
  ajout({ type: 'rect', ton: 'mur', x: X(xMur), y: Y(yS + 1.2), w: ep * sc, h: (yS + 1.2) * sc });
  ajout({ type: 'texte', ton: 'legende', x: X(xMur + ep) + 8, y: Y(yS + 1.0), texte: 'Extérieur', taille: 12 * k });
  ajout({ type: 'rect', ton: 'appareil', x: X(-aw / 2), y: Y(i.hBuse - 0.06), w: aw * sc, h: (i.hBuse - 0.06) * sc, arrondi: 4 });
  ajout({ type: 'rect', ton: 'foyer', x: X(-aw / 2 + 0.1), y: Y(i.hBuse * 0.62), w: (aw - 0.2) * sc, h: i.hBuse * 0.3 * sc, arrondi: 2 });
  ajout({ type: 'polyline', ton: 'conduit', points: pts(trace), epaisseur: pw, jointure: 'round' });
  ajout({ type: 'polyline', ton: 'ame', points: pts(trace), epaisseur: Math.max(1.5, pw * 0.3), jointure: 'round' });
  ajout({ type: 'rect', ton: 'finitionNoir', x: X(xMur + ep + 0.3), y: Y(yS + 0.14), w: 0.12 * sc, h: 0.28 * sc, arrondi: 2 });
  cote('hBuse', 'Hauteur de buse', -0.75, 0, -0.75, i.hBuse);
  cote('hSortie', 'Hauteur de l\'axe de sortie', -1.55, 0, -1.55, yS);
  cote('lHoriz', 'Longueur horizontale', 0, yS + 0.3, xMur, yS + 0.3, true);
  cote('epMur', 'Épaisseur du mur', xMur, yS - 0.35, xMur + ep, yS - 0.35, true);
  repere(1, xMur + ep + 0.36, yS, xMur + ep + 0.36, yS + 0.7);
  repere(2, xMur / 2, yS, xMur / 2, yS - 0.7);
  repere(3, 0, yS, -0.6, yS + 0.5);
  repere(4, 0, (i.hBuse + yS) / 2, 0.7, (i.hBuse + yS) / 2);
  return { largeur: (maxX - minX) * sc, hauteur: (maxY - minY) * sc, ...a };
}

const SCENES = { G1: sceneG1, G3: sceneG3, G4: sceneG4, G6: sceneG6 };

/**
 * Scène de la coupe cotée d'un métré.
 * @param {string} gabaritCode code du gabarit (G1, G3, G3P, G4, G4R, G4P, G4K, G4F, G5, G6)
 * @param {object} geometrie géométrie calculée par le moteur (ou enregistrée dans fum_metres.resultat)
 * @param {object} releve relevé du métré
 * @param {{ police?: number }} [opts] taille du texte des cotes (13 à l'écran) ; boîtes, repères et marges suivent
 * @returns {{ titre:string, largeur:number, hauteur:number, formes:object[], cotes:object[], reperes:object[] } | null}
 */
export function construireScene(gabaritCode, geometrie, releve, opts = {}) {
  const famille = FAMILLE[gabaritCode];
  if (!famille || !geometrie || !releve) return null;
  const k = (opts.police ?? 13) / 13;
  const s = SCENES[famille](geometrie, releve, k);
  return { titre: TITRE[famille], largeur: s.largeur, hauteur: s.hauteur, formes: s.formes, cotes: s.cotes, reperes: s.reperes };
}
