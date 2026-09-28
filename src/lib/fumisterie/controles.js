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

/**
 * Contrôles du tubage (G4 / G4R). Le débouché est celui du conduit existant : la zone 1 n'est
 * PAS vérifiée par le métré, et l'écran le dit (info) plutôt que de se taire.
 * @param {ReturnType<import('./gabarits/g4.js').geometrieG4>} g
 * @param {Parameters<import('./gabarits/g4.js').geometrieG4>[0]} r
 * @param {Parameters<import('./gabarits/g4.js').geometrieG4>[1]} cfg
 * @returns {{niveau:string, code:string, message:string, source:string}[]}
 */
export function controlesG4(g, r, cfg) {
  const a = [];
  a.push({ niveau: 'info', code: 'zone1_non_verifiee', source: 'catalogue p.23', message: 'Conduit existant : la hauteur du débouché (zone 1) n\'est pas vérifiée par le métré — à contrôler sur place.' });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: g.mur ? 'La buse est au niveau du piquage ou au-dessus : vérifiez la hauteur de buse et celle du piquage.' : 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  if (Number(r.hConduit) < 1) a.push({ niveau: 'warn', code: 'conduit_court', source: 'géométrie', message: `Conduit existant de ${fmt(r.hConduit)} m seulement : vérifiez la hauteur relevée.` });
  if (g.mur && Number(r.diametre) > 150) a.push({ niveau: 'warn', code: 'piquage_diametre', source: 'catalogue (R-POLYPERF-02)', message: `Entrée par le mur en Ø${r.diametre} : l'adaptateur de piquage boisseau bas existe jusqu'au Ø150. Prévoir un té ou une entrée par le plafond.` });
  if (!g.rigide && g.Lflex > 30) a.push({ niveau: 'info', code: 'flexible_long', source: 'tarif', message: `${fmt(g.Lflex, 1)} m de flexible : au-delà d'un rouleau de 30 m, vérifier le conditionnement au tarif.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: g.rigide ? 'surlongueur_prh' : 'surlongueur_emaillee', source: 'calcul', message: `Raccordement : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  const sc = g.troncons.conduit_existant.composition?.surlongueur || 0;
  if (sc > 0) a.push({ niveau: 'info', code: 'surlongueur_conduit', source: 'calcul', message: `Tuyaux rigides : ${sc} mm de trop dans le conduit, à recouper.` });
  if (!g.rigide) a.push({ niveau: 'info', code: 'flexible_marge', source: 'réglage', message: `Flexible commandé : ${fmt(g.Lflex, 1)} m (${fmt(r.hConduit, 2)} m de conduit + ${fmt(cfg.flexible_marge_m, 2)} m de débord, arrondi au ${fmt(cfg.flexible_arrondi_m, 2)} m).` });
  return a;
}

/**
 * Contrôles du raccordement seul (G5) : pas de conduit métré, le conduit existant est réputé conforme.
 * @param {ReturnType<import('./gabarits/g4.js').geometrieG4>} g
 * @param {Record<string, unknown>} r
 */
export function controlesG5(g, r) {
  const a = [];
  a.push({ niveau: 'info', code: 'conduit_non_metre', source: 'catalogue', message: 'Raccordement seul : le conduit existant n\'est pas métré, sa conformité (section, zone 1, ramonage) est à contrôler sur place.' });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: g.mur ? 'La buse est au niveau du piquage ou au-dessus : vérifiez les hauteurs.' : 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  void r;
  return a;
}

/**
 * Contrôles de la création extérieure en façade (G3).
 * @param {ReturnType<import('./gabarits/g3.js').geometrieG3>} g
 * @param {Parameters<import('./gabarits/g3.js').geometrieG3>[0]} r
 * @param {Parameters<import('./gabarits/g3.js').geometrieG3>[1]} cfg
 */
export function controlesG3(g, r, cfg) {
  const a = [];
  const marge = (g.topAct - g.yReq) * 100;
  if (marge >= -0.5) a.push({ niveau: 'ok', code: 'zone1', source: 'catalogue p.23', message: `Zone 1 respectée : le sommet dépasse le minimum de ${fmt(Math.max(0, marge), 0)} cm (${fmt(g.hAct)} m au-dessus de l'égout).` });
  else a.push({ niveau: 'warn', code: 'zone1', source: 'catalogue p.23', message: `Sommet trop bas de ${fmt(-marge, 0)} cm pour la zone 1. Il faut au moins ${fmt(g.minSortie)} m au-dessus de l'égout (${g.flat ? `toit ≤ ${cfg.zone1.pente_plat_deg}° : ${fmt(cfg.zone1.plat_m)} m` : `faîtage + ${fmt(cfg.zone1.pente_m * 100, 0)} cm`}).` });
  if (g.flat) a.push({ niveau: 'info', code: 'toit_plat', source: 'catalogue p.23', message: `Pente ≤ ${cfg.zone1.pente_plat_deg}° : la toiture est traitée comme un toit plat.` });
  if (g.hLibre > cfg.haubanage_m) a.push({ niveau: 'warn', code: 'haubanage', source: 'catalogue p.33 (à confirmer)', message: `Plus de ${fmt(cfg.haubanage_m, 0)} m de conduit libre au-dessus de l'égout : prévoir un haubanage ou un kit de non-haubanage.` });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La buse est au niveau de la traversée ou au-dessus : vérifiez la hauteur de buse et celle de la traversée.' });
  if (Number(r.epMur) < 0.15) a.push({ niveau: 'warn', code: 'mur_mince', source: 'géométrie', message: `Mur de ${fmt(r.epMur)} m : vérifiez l'épaisseur relevée.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement intérieur : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  const sf = g.troncons.facade.composition.surlongueur;
  if (sf > 0) a.push({ niveau: 'info', code: 'surlongueur_facade', source: 'calcul', message: `Façade : ${sf} mm de surlongueur avec les éléments standard, le sommet monte d'autant.` });
  a.push({ niveau: 'info', code: 'supports_provisoires', source: 'réglage', message: `Supports muraux comptés 1 tous les ${fmt(cfg.supports_muraux_tous_les_m, 1)} m de façade (règle provisoire).` });
  return a;
}

/**
 * Contrôles de la sortie horizontale en façade (G6, ventouse zone 3).
 * @param {ReturnType<import('./gabarits/g6.js').geometrieG6>} g
 * @param {Record<string, unknown>} r
 */
export function controlesG6(g, r) {
  const a = [];
  a.push({ niveau: 'warn', code: 'zone3_non_verifiee', source: 'catalogue p.80-89', message: 'Sortie en zone 3 (ventouse) : les distances aux ouvrants, au sol et aux limites de propriété ne sont pas vérifiées par le métré — validation technicien obligatoire.' });
  if (g.Lv <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La sortie est au niveau de la buse ou en dessous : vérifiez la hauteur de sortie.' });
  if (Number(r.epMur) < 0.15) a.push({ niveau: 'warn', code: 'mur_mince', source: 'géométrie', message: `Mur de ${fmt(r.epMur)} m : vérifiez l'épaisseur relevée.` });
  if (g.Lh > 3) a.push({ niveau: 'warn', code: 'horizontal_long', source: 'catalogue (à confirmer)', message: `${fmt(g.Lh)} m d'horizontal : vérifier la longueur admise par l'avis technique de l'appareil.` });
  return a;
}
