// Contrôles réglementaires et de cohérence d'un métré — module PUR. Chaque alerte :
// { niveau: 'ok'|'info'|'warn'|'verifier', code, message, source }. AUCUNE ne bloque l'injection (un `warn`
// demande seulement confirmation) ; `verifier` = point à contrôler sur place, imprimé sur la fiche chantier.
// Une donnée absente rend une règle « non vérifiée » (silence ou `verifier`), jamais « conforme ».
// Sources : NF DTU 24.1 P1-1-1 (2020), Cahier CSTB 3708_V4 (2026), arrêté du 22/10/1969 art. 18 —
// synthèses dans docs/devis-fumisterie/regles/. Jamais de rouge/vert seuls côté UI.
import { lireComplement } from './complements.js';

const fmt = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');

const S = {
  arrete: 'Arrêté du 22/10/1969, art. 18 (NF DTU 24.1 § 5.4.6)',
  devoiement: 'NF DTU 24.1 § 5.4.1.2.2',
  tubageDevoiement: 'NF DTU 24.1 § 15.1',
  trace: 'NF DTU 24.1 § 13.1.7',
  te: 'NF DTU 24.1 § 5.4.4.2',
  section: 'NF DTU 24.1 § 13.1.3',
  flexible: 'NF DTU 24.1 § 15.4.1.1',
  annulaire: 'NF DTU 24.1 § 15.4',
  plaque: 'NF DTU 24.1 § 5.4.9',
  essais: 'NF DTU 24.1 § 16',
  diagnostic: 'NF DTU 24.1 Annexe C',
  epaisseur: 'NF DTU 24.1 § 15.2.1, Tableau 13',
  distances: 'NF DTU 24.1 § 10.2.3.1, Tableau 5',
  coffrage: 'NF DTU 24.1 § 10.2.3.2',
  vacuite: 'NF DTU 24.1 § 15.3.3',
  c3708trace: 'Cahier CSTB 3708 § 3.5.1.2',
  c3708batiment: 'Cahier CSTB 3708 § 2.1 et 3.3.1',
  c3708terminal: 'Cahier CSTB 3708 § 3.3.1.3',
  c3708: 'Cahier CSTB 3708 § 3.3',
  at: 'Avis Technique du conduit et notice de l\'appareil',
};

/** Longueur d'une couronne de flexible au tarif (m) : au-delà, un raccord flexible/flexible. */
const COURONNE_FLEXIBLE_M = 30;

/**
 * Nature de l'installation, qui décide du texte applicable (le NF DTU 24.1 exclut les appareils étanches
 * et les systèmes concentriques, § 1.3 et 3.11).
 * @param {{ appareil_etanche_requis?: boolean, combustibles?: string[] } | null | undefined} configuration
 * @returns {'traditionnelle'|'etanche_granules'|'etanche_bois'}
 */
export function natureInstallation(configuration) {
  if (!configuration?.appareil_etanche_requis) return 'traditionnelle';
  return (configuration.combustibles || []).includes('bois_buches') ? 'etanche_bois' : 'etanche_granules';
}

/** Alerte de hauteur de sortie (G1, G3), selon la nature de l'installation. */
function alerteHauteur(g, configuration, detail) {
  const nature = natureInstallation(configuration);
  const marge = (g.topAct - g.yReq) * 100;
  const conforme = marge >= -0.5;
  const exigence = g.exigence || (g.flat ? `toit plat : +${fmt(g.reqAbove)} m` : `faîtage + ${fmt(g.reqAbove * 100, 0)} cm`);
  if (nature === 'etanche_bois') {
    return { niveau: 'info', code: 'zone1', source: S.at, message: 'Appareil étanche au bois : la position du débouché suit l\'Avis Technique du conduit et la notice de l\'appareil, non vérifiés par le métré.' };
  }
  if (nature === 'etanche_granules') {
    // Une sortie concentrique peut être en zone de surpression (Cahier 3708) : la règle de l'arrêté devient une indication.
    return { niveau: 'info', code: 'zone1', source: S.c3708,
      message: `Appareil étanche à granulés : la sortie peut être hors zone 1 si l'Avis Technique le permet. Repère zone 1 : ${conforme ? 'atteint' : `${fmt(-marge, 0)} cm sous`} le minimum (${exigence}).` };
  }
  if (conforme) return { niveau: 'ok', code: 'zone1', source: S.arrete, message: `Hauteur de sortie respectée : ${fmt(Math.max(0, marge), 0)} cm au-dessus du minimum (${detail}).` };
  return { niveau: 'warn', code: 'zone1', source: S.arrete, message: `Sortie trop basse de ${fmt(-marge, 0)} cm. Il faut au moins ${fmt(g.minSortie)} m (${exigence}).` };
}

/** Raccordement : compte des changements de direction hors té (DTU 24.1 § 13.1.7), fonction séparée pour être testée. */
export function alerteDirections(degres) {
  if (!(degres > 180)) return null;
  return { niveau: 'warn', code: 'raccordement_directions', source: S.trace, message: `Raccordement : ${degres}° de changements de direction cumulés, au-delà des 180° admis (té de pied non compté).` };
}

/** Règles du raccordement communes à tous les gabarits (compléments facultatifs). */
function controlesRaccordement(r, { horizontal = 0, directions = 0 } = {}) {
  const a = [];
  if (horizontal > 3) a.push({ niveau: 'warn', code: 'raccordement_horizontal', source: S.trace, message: `Raccordement : ${fmt(horizontal)} m de parcours horizontal, au-delà des 3 m admis vers un conduit individuel.` });
  const dir = alerteDirections(directions);
  if (dir) a.push(dir);
  const dBuse = lireComplement(r, 'diametreBuse');
  if (dBuse != null && Number(r.diametre) > 0) {
    if (dBuse > Number(r.diametre)) a.push({ niveau: 'warn', code: 'section_buse', source: S.section, message: `Conduit Ø${r.diametre} plus petit que la buse Ø${dBuse} : la section du raccordement doit être au moins celle de la buse.` });
    else if (dBuse < Number(r.diametre)) a.push({ niveau: 'info', code: 'section_buse', source: S.section, message: `Buse Ø${dBuse} sur conduit Ø${r.diametre} : augmentation par une pièce de forme de 45° au plus.` });
  }
  return a;
}

/**
 * @param {ReturnType<import('./gabarits/g1.js').geometrieG1>} g géométrie calculée
 * @param {Parameters<import('./gabarits/g1.js').geometrieG1>[0]} r relevé
 * @param {Parameters<import('./gabarits/g1.js').geometrieG1>[1]} cfg config Fumisterie
 * @param {object} [configuration] configuration du catalogue (nature de l'installation)
 * @returns {{niveau:string, code:string, message:string, source:string}[]} alertes
 */
export function controlesG1(g, r, cfg, configuration) {
  const a = [alerteHauteur(g, configuration, `hauteur réelle ${fmt(g.hAct)} m au-dessus du toit`)];
  if (g.flat) a.push({ niveau: 'info', code: 'toit_plat', source: S.arrete, message: `Pente inférieure à ${cfg.zone1.pente_plat_deg}° : la toiture est traitée comme un toit plat.` });
  if (!g.devOK) a.push({ niveau: 'warn', code: 'devoiement', source: 'géométrie', message: `Le dévoiement ne tient pas dans les combles : il demande ${fmt(g.vg)} m de hauteur. Réduisez le décalage ou augmentez l'angle.` });
  if (Number(r.angle) > 45) a.push({ niveau: 'warn', code: 'devoiement_angle', source: S.devoiement, message: `Dévoiement à ${r.angle}° de la verticale : 45° au plus pour un conduit métallique.` });
  if (Number(r.angle) > 0 && g.vg > 5) a.push({ niveau: 'warn', code: 'devoiement_hauteur', source: S.devoiement, message: `${fmt(g.vg)} m entre les deux coudes du dévoiement : 5 m au plus.` });
  if (g.hAct > cfg.haubanage_m) a.push({ niveau: 'warn', code: 'haubanage', source: 'catalogue p.33 (à confirmer)', message: `Plus de ${fmt(cfg.haubanage_m, 0)} m de conduit libre au-dessus du toit : prévoir un kit de non-haubanage ou un haubanage.` });
  if (g.Lsp <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  const si = g.troncons.conduit_interieur.composition.surlongueur;
  if (si > 0) a.push({ niveau: 'info', code: 'surlongueur_interieure', source: 'calcul', message: `Conduit intérieur : ${si} mm de surlongueur avec les éléments standard, reportés sur la hauteur de sortie.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement émaillé : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  a.push(...controlesRaccordement(r));
  return a;
}

/**
 * Contrôles du tubage (G4 et variantes). Le débouché est celui du conduit existant : il n'est PAS vérifié
 * par le métré, et la fiche chantier le dit (point à vérifier) plutôt que de se taire.
 * @param {ReturnType<import('./gabarits/g4.js').geometrieG4>} g
 * @param {Parameters<import('./gabarits/g4.js').geometrieG4>[0]} r
 * @param {Parameters<import('./gabarits/g4.js').geometrieG4>[1]} cfg
 * @returns {{niveau:string, code:string, message:string, source:string}[]}
 */
export function controlesG4(g, r, cfg) {
  const a = [];
  a.push({ niveau: 'verifier', code: 'zone1_non_verifiee', source: S.arrete, message: 'Hauteur du débouché du conduit existant : 0,40 m au-dessus de toute construction à moins de 8 m (non vérifiée par le métré).' });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: g.mur ? 'La buse est au niveau du piquage ou au-dessus : vérifiez la hauteur de buse et celle du piquage.' : 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  if (Number(r.hConduit) < 1) a.push({ niveau: 'warn', code: 'conduit_court', source: 'géométrie', message: `Conduit existant de ${fmt(r.hConduit)} m seulement : vérifiez la hauteur relevée.` });
  if (g.mur && Number(r.diametre) > 150) a.push({ niveau: 'warn', code: 'piquage_diametre', source: 'catalogue (R-POLYPERF-02)', message: `Entrée par le mur en Ø${r.diametre} : l'adaptateur de piquage boisseau bas existe jusqu'au Ø150. Prévoir un té ou une entrée par le plafond.` });
  if (!g.rigide && g.Lflex > COURONNE_FLEXIBLE_M) a.push({ niveau: 'info', code: 'flexible_long', source: 'tarif', message: `${fmt(g.Lflex, 1)} m de flexible : au-delà d'un rouleau de ${COURONNE_FLEXIBLE_M} m, vérifier le conditionnement au tarif.` });
  if (!g.rigide && Math.ceil(g.Lflex / COURONNE_FLEXIBLE_M - 1e-9) - 1 > 1) a.push({ niveau: 'warn', code: 'flexible_raccords', source: S.flexible, message: `${fmt(g.Lflex, 1)} m de flexible demandent plus d'un raccord flexible/flexible : un seul est admis.` });
  const angle = lireComplement(r, 'angleBoisseau');
  if (angle != null && angle > 45) a.push({ niveau: 'warn', code: 'devoiement_tubage', source: S.tubageDevoiement, message: `Conduit existant dévoyé à ${fmt(angle, 0)}° : un tubage est admis jusqu'à 45°, si le gabarit passe.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: g.rigide ? 'surlongueur_prh' : 'surlongueur_emaillee', source: 'calcul', message: `Raccordement : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  const sc = g.troncons.conduit_existant.composition?.surlongueur || 0;
  if (sc > 0) a.push({ niveau: 'info', code: 'surlongueur_conduit', source: 'calcul', message: `Tuyaux rigides : ${sc} mm de trop dans le conduit, à recouper.` });
  if (!g.rigide) a.push({ niveau: 'info', code: 'flexible_marge', source: 'réglage', message: `Flexible commandé : ${fmt(g.Lflex, 1)} m (${fmt(r.hConduit, 2)} m de conduit + ${fmt(cfg.flexible_marge_m, 2)} m de débord, arrondi au ${fmt(cfg.flexible_arrondi_m, 2)} m).` });
  a.push(...controlesRaccordement(r, { horizontal: g.mur ? Number(r.lHoriz) || 0 : 0, directions: g.mur ? 90 : 0 }));
  return a;
}

/**
 * Contrôles du raccordement seul (G5) : pas de conduit métré, son diagnostic est à faire sur place.
 * @param {ReturnType<import('./gabarits/g4.js').geometrieG4>} g
 * @param {Record<string, unknown>} r
 */
export function controlesG5(g, r) {
  const a = [];
  a.push({ niveau: 'info', code: 'conduit_non_metre', source: 'catalogue', message: 'Raccordement seul : le conduit existant n\'est pas métré, sa conformité (section, débouché, ramonage) est à contrôler sur place.' });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: g.mur ? 'La buse est au niveau du piquage ou au-dessus : vérifiez les hauteurs.' : 'La buse est au niveau du plafond ou au-dessus : vérifiez la hauteur de buse.' });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  a.push(...controlesRaccordement(r, { horizontal: g.mur ? Number(r.lHoriz) || 0 : 0, directions: g.mur ? 90 : 0 }));
  return a;
}

/**
 * Contrôles de la création extérieure en façade (G3).
 * @param {ReturnType<import('./gabarits/g3.js').geometrieG3>} g
 * @param {Parameters<import('./gabarits/g3.js').geometrieG3>[0]} r
 * @param {Parameters<import('./gabarits/g3.js').geometrieG3>[1]} cfg
 * @param {object} [configuration]
 */
export function controlesG3(g, r, cfg, configuration) {
  const a = [alerteHauteur(g, configuration, 'sommet au-dessus de l\'égout')];
  if (g.flat) a.push({ niveau: 'info', code: 'toit_plat', source: S.arrete, message: `Pente inférieure à ${cfg.zone1.pente_plat_deg}° : la toiture est traitée comme un toit plat.` });
  if (g.hLibre > cfg.haubanage_m) a.push({ niveau: 'warn', code: 'haubanage', source: 'catalogue p.33 (à confirmer)', message: `Plus de ${fmt(cfg.haubanage_m, 0)} m de conduit libre au-dessus de l'égout : prévoir un haubanage ou un kit de non-haubanage.` });
  if (g.Lsp_v <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La buse est au niveau de la traversée ou au-dessus : vérifiez la hauteur de buse et celle de la traversée.' });
  if (Number(r.epMur) < 0.15) a.push({ niveau: 'warn', code: 'mur_mince', source: 'géométrie', message: `Mur de ${fmt(r.epMur)} m : vérifiez l'épaisseur relevée.` });
  const ss = g.troncons.raccordement_sp.composition.surlongueur;
  if (ss > 0) a.push({ niveau: 'info', code: 'surlongueur_emaillee', source: 'calcul', message: `Raccordement intérieur : ${ss} mm de trop, à recouper ou à remplacer par un tuyau coulissant.` });
  const sf = g.troncons.facade.composition.surlongueur;
  if (sf > 0) a.push({ niveau: 'info', code: 'surlongueur_facade', source: 'calcul', message: `Façade : ${sf} mm de surlongueur avec les éléments standard, le sommet monte d'autant.` });
  a.push({ niveau: 'info', code: 'supports_provisoires', source: 'réglage', message: `Supports muraux comptés 1 tous les ${fmt(cfg.supports_muraux_tous_les_m, 1)} m de façade (règle provisoire).` });
  // Vertical → horizontal vers le mur : un coude de 90° ; le té au pied du conduit extérieur ne compte pas.
  a.push(...controlesRaccordement(r, { horizontal: Number(r.lHoriz) || 0, directions: 90 }));
  return a;
}

/**
 * Contrôles de la sortie horizontale en façade (G6, ventouse) — Cahier CSTB 3708 (le NF DTU 24.1 exclut les
 * appareils étanches). Les distances du terminal sont des points à vérifier sur place.
 * @param {ReturnType<import('./gabarits/g6.js').geometrieG6>} g
 * @param {Record<string, unknown>} r
 */
export function controlesG6(g, r) {
  const a = [];
  if (g.Lv <= 0.05) a.push({ niveau: 'warn', code: 'buse', source: 'géométrie', message: 'La sortie est au niveau de la buse ou en dessous : vérifiez la hauteur de sortie.' });
  if (Number(r.epMur) < 0.15) a.push({ niveau: 'warn', code: 'mur_mince', source: 'géométrie', message: `Mur de ${fmt(r.epMur)} m : vérifiez l'épaisseur relevée.` });
  if (g.Lh > 3) a.push({ niveau: 'warn', code: 'horizontal_long', source: 'catalogue (à confirmer)', message: `${fmt(g.Lh)} m d'horizontal : vérifier la longueur admise par l'avis technique de l'appareil.` });
  const notice = lireComplement(r, 'hVerticalNotice');
  const minV = Math.max(1.5, notice ?? 0);
  if (g.Lv > 0.05 && g.Lv < minV) a.push({ niveau: 'warn', code: 'ventouse_vertical', source: S.c3708trace, message: `${fmt(g.Lv)} m de vertical avant le coude de traversée : au moins ${fmt(minV)} m (${notice != null ? 'notice de l\'appareil' : '1,50 m sans Avis Technique, sauf valeur plus faible de la notice'}).` });
  a.push({ niveau: 'info', code: 'ventouse_trace', source: S.c3708trace, message: 'Ventouse : un té en pied et un seul coude à 90° pour traverser le mur, aucun autre dévoiement.' });
  const recent = lireComplement(r, 'batimentRecentOuErp');
  if (recent === 'oui') a.push({ niveau: 'warn', code: 'ventouse_batiment', source: S.c3708batiment, message: 'Ventouse horizontale interdite dans un bâtiment de moins de 3 ans et en établissement recevant du public.' });
  else if (recent == null) a.push({ niveau: 'verifier', code: 'ventouse_batiment', source: S.c3708batiment, message: 'Bâtiment de plus de 3 ans et hors établissement recevant du public (ventouse horizontale interdite sinon).' });
  return a;
}

/**
 * Règles qui lisent la nomenclature (calculée après la géométrie) : té en pied quand la buse sort par
 * l'arrière, ventilation de l'espace annulaire d'un tubage.
 * @param {string} code code du gabarit
 * @param {Array<{ composant_code?: string }>} lignes
 * @param {Record<string, unknown>} r relevé
 */
export function controlesNomenclature(code, lignes, r) {
  const a = [];
  const codes = lignes.map((l) => String(l.composant_code || ''));
  if (lireComplement(r, 'sortieBuse') === 'arriere' && !codes.some((c) => /(^|_)te(_|$)/.test(c))) {
    a.push({ niveau: 'warn', code: 'te_buse_arriere', source: S.te, message: 'Buse à sortie arrière ou latérale : un té avec tampon est obligatoire au pied du conduit, absent de la liste.' });
  }
  if (['G4', 'G4R', 'G4K'].includes(code) && !codes.some((c) => /ventil|couronnement/.test(c))) {
    a.push({ niveau: 'info', code: 'ventilation_annulaire', source: S.annulaire, message: 'Tubage : ventiler l\'espace entre le tube et le conduit (5 cm² en haut, 20 cm² en bas) ; aucune pièce de ventilation dans la liste.' });
  }
  return a;
}

/**
 * Points à vérifier sur place, dérivés du gabarit et de la nature de l'installation (sans case à cocher).
 * @param {string} code code du gabarit
 * @param {object} [configuration]
 * @returns {{niveau:'verifier', code:string, message:string, source:string}[]}
 */
export function pointsAVerifier(code, configuration) {
  const nature = natureInstallation(configuration);
  const v = (c, message, source) => ({ niveau: 'verifier', code: c, message, source });
  const a = [];
  if (['G4', 'G4R', 'G4P', 'G4K', 'G4F', 'G5'].includes(code)) {
    a.push(v('diagnostic_existant', 'Diagnostic du conduit existant : vacuité (passage de l\'ogive sur toute la hauteur), état, étanchéité.', `${S.diagnostic}, ${S.vacuite}`));
    a.push(v('epaisseur_distances', 'Épaisseur des parois du conduit existant et distance aux matériaux combustibles.', S.epaisseur));
  }
  if (['G4', 'G4R', 'G4P', 'G4K', 'G4F'].includes(code)) a.push(v('gabarit_passage', 'Passage du gabarit dans le conduit (dévoiement de 45° au plus).', S.tubageDevoiement));
  if (['G1', 'G3', 'G3P'].includes(code)) {
    a.push(v('planchers', 'Nature des planchers et plafonds traversés (combustibles ou non).', S.distances));
    a.push(nature === 'traditionnelle'
      ? v('distance_securite', 'Distance de sécurité aux matériaux combustibles selon la classe du conduit (Tableau 5).', S.distances)
      : v('distance_securite', 'Distance de sécurité du conduit selon son Avis Technique.', S.at));
    if (code === 'G1') a.push(v('coffrage', 'Coffrage ventilé dans les pièces traversées autres que celle de l\'appareil.', S.coffrage));
  }
  if (code === 'G6') {
    a.push(v('terminal_sol', 'Terminal à plus de 2 m au-dessus du sol extérieur.', S.c3708terminal));
    a.push(v('terminal_ouvrant', 'Terminal à 2 m au moins de tout ouvrant ou entrée d\'air (et pas sous un ouvrant).', S.c3708terminal));
    a.push(v('terminal_angle', 'Terminal à 1 m au moins d\'un angle rentrant.', S.c3708terminal));
    a.push(v('terminal_obstacle', 'Aucun obstacle plus haut que le terminal à moins de 3 m en face.', S.c3708terminal));
    a.push(v('terminal_limite', 'Limite de propriété à plus de 3 m (6 m si la façade voisine a un ouvrant ou s\'il n\'y a pas de maison voisine).', S.c3708terminal));
    a.push(v('terminal_passage', 'Le terminal ne donne ni sur un passage public ni dans une cour fermée.', S.c3708terminal));
    a.push(v('classe_etancheite', 'Appareil de classe d\'étanchéité CM50 ou CC50 (ou Avis Technique : fuite de 3 m³/h au plus sous 50 Pa).', 'Cahier CSTB 3708 § 2.2'));
  }
  if (code !== 'G5') a.push(v('plaque_signaletique', 'Plaque signalétique à poser et fiche d\'identification à remettre au client.', S.plaque));
  a.push(v('essais', 'Essais avant mise en service : vacuité, étanchéité, distances, tirage.', S.essais));
  return a;
}
