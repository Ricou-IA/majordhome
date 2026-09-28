// Contrôles réglementaires et de cohérence d'un métré — module PUR. Chaque alerte :
// { niveau: 'ok'|'info'|'warn', code, message, source }. Jamais de rouge/vert seuls côté UI :
// le niveau porte une icône + un libellé.
const fmt = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');

/**
 * @param {ReturnType<import('./gabarits/g1.js').geometrieG1>} g géométrie calculée
 * @param {Parameters<import('./gabarits/g1.js').geometrieG1>[0]} r relevé
 * @param {Parameters<import('./gabarits/g1.js').geometrieG1>[1]} cfg config Fumisterie
 * @returns {{niveau:string, code:string, message:string, source:string}[]} alertes
 */
export function controlesG1(g, r, cfg) {
  const a = [];
  const marge = (g.topAct - g.yReq) * 100;
  if (marge >= -0.5) a.push({ niveau: 'ok', code: 'zone1', source: 'catalogue p.23',
    message: `Zone 1 respectée : la sortie dépasse le minimum de ${fmt(Math.max(0, marge), 0)} cm (hauteur réelle ${fmt(g.hAct)} m au-dessus du toit).` });
  else a.push({ niveau: 'warn', code: 'zone1', source: 'catalogue p.23',
    message: `Sortie trop basse de ${fmt(-marge, 0)} cm pour la zone 1. Il faut au moins ${fmt(g.minSortie)} m au-dessus du toit (${g.flat ? `toit ≤ ${cfg.zone1.pente_plat_deg}° : ${fmt(cfg.zone1.plat_m)} m` : `faîtage + ${fmt(cfg.zone1.pente_m * 100, 0)} cm`}).` });
  if (g.flat) a.push({ niveau: 'info', code: 'toit_plat', source: 'catalogue p.23', message: `Pente ≤ ${cfg.zone1.pente_plat_deg}° : la toiture est traitée comme un toit plat.` });
  if (!g.devOK) a.push({ niveau: 'warn', code: 'devoiement', source: 'géométrie', message: `Le dévoiement ne tient pas dans les combles : il demande ${fmt(g.vg)} m de hauteur. Réduisez le décalage ou augmentez l'angle.` });
  if (g.hAct > cfg.haubanage_m) a.push({ niveau: 'warn', code: 'haubanage', source: 'catalogue p.33 (à confirmer)', message: `Plus de ${fmt(cfg.haubanage_m, 0)} m de conduit libre au-dessus du toit : prévoir un kit de non-haubanage ou un haubanage.` });
  if (g.Lsp <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  const si = g.troncons.conduit_interieur.composition.surlongueur;
  if (si > 0) a.push({ niveau: 'info', code: 'surlongueur_interieure', source: 'calcul', message: `Conduit intérieur : ${si} mm de surlongueur avec les éléments standard, reportés sur la hauteur de sortie.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement émaillé : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  return a;
}
