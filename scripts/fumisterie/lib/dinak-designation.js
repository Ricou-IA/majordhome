// scripts/fumisterie/lib/dinak-designation.js
// Attributs de fumisterie d'un article DINAK, lus dans sa désignation, sa gamme et sa colonne diamètre —
// module PUR (même rôle que parseDesignation.mjs pour MODINOX). Vocabulaire des types = celui du moteur
// (element_droit, element_reglable, coude, chapeau_anti_refouleur, solin, collier_jonction…). Une désignation
// non reconnue rend `type_piece: null` : elle est LISTÉE par le test et par l'import, jamais devinée.

/** Désignation ramenée à une forme comparable : sans accent, minuscules, espaces simples, première ligne. */
export function normaliserDesignation(s) {
  // \s couvre les espaces insécables (U+00A0, U+202F) ; \p{M} = accents séparés par NFD.
  return String(s ?? '').split(/\r?\n/)[0].normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/º/g, '°').toLowerCase().replace(/\s+/g, ' ').trim();
}

const nombre = (s) => (s == null ? null : Number(String(s).replace(',', '.')));

/** Règles dans l'ordre : la première qui reconnaît la désignation l'emporte. */
const REGLES = [
  [/^el[ei]me[nt]*t? droit d.?inspection/, 'element_inspection'],
  [/^el[ei]me[nt]*t? (droit|extra court)\b/, 'element_droit'],
  [/^el[ei]ment (test|de descente)\b/, 'element_special'],
  [/^ajustable\b/, 'element_reglable'],
  [/^coude \d+ ?° (avec inspection|premium|avec offset)|^coude .*inspection/, 'coude_special'],
  [/^coude \d+ ?°$/, 'coude'],
  [/^te \d+ ?° ?$/, 'te'],
  [/^te\b/, 'te_special'],
  [/^(augmentation|reduction|augmentation \/ reduction)\b/, 'reduction'],
  [/^solin (de )?toit inox en pente/, 'solin'],
  [/^solin\b/, 'solin_autre'],
  [/^collet (pour solin|de finition)/, 'collet_solin'],
  [/^capuchon antivent$/, 'chapeau_anti_refouleur'],
  [/^capuchon pare-pluie$/, 'chapeau_pare_pluie'],
  [/^(capuchon|cone de finition|terminal|terminarl|sortie (horizontale|verticale)|deflecteur)/, 'terminal'],
  [/^collier d.union$/, 'collier_jonction'],
  [/^collier d.union avec/, 'collier_jonction_special'],
  [/^collier (mural|a dalle|pour haubans|de serrage|haut pour tubage)/, 'collier_mural'],
  [/^support au toit avec profil$/, 'collier_sous_toiture'],
  [/^(support|suport|suppot)\b/, 'support'],
  [/^plaque (d.)?ecart (au )?feu ventilee/, 'plaque_ecart_feu_ventilee'],
  [/^plaque (d.)?ecart (au )?feu/, 'plaque_ecart_feu'],
  [/^plaque signaletique$/, 'plaque_signaletique'],
  [/^plaques? (de )?(propret|propet)/, 'plaque_proprete'],
  [/^plaque de rehausse ventilee/, 'plaque_ventilee'],
  [/^plaque/, 'plaque_autre'],
  [/^rosace (de )?finition$/, 'rosace'],
  [/^rosace/, 'rosace_special'],
  [/^raccord (d.)?adaptation deko - dw/, 'raccord_simple_paroi'],
  [/^raccord femelle$/, 'raccord_femelle'],
  [/^(raccord|bague|manchon|transformation|joint|fourreau)/, 'raccord_autre'],
  [/^tampon/, 'tampon'],
  [/^couronne \d+ ?metres/, 'flexible'],
  [/^flexible pour raccordement/, 'flexible'],
  [/^corps? de souche/, 'souche'],
  [/^(couronne|tire-flex|bride|kit|silicone|spray|profiles|fixation|bavette|pied|sachet|trappe|grille|mitron|coiffe|finition brique|couronnement)/, 'accessoire'],
];

/**
 * @param {{ reference: string, name: string, gamme: string, diametre: string|number|null }} a
 * @returns {{ type_piece: string|null, diametre_int: number|null, longueur_mm: number|null, longueur_max_mm: number|null,
 *   angle: number|null, pente_min: number|null, pente_max: number|null, couleur: 'noir'|'inox', gamme_tarif: string,
 *   parse_confidence: number, parse_notes: string|null }}
 */
export function parserDinak(a) {
  const n = normaliserDesignation(a.name);
  const regle = REGLES.find(([re]) => re.test(n));
  let type = regle ? regle[1] : null;
  // Diamètre « 80/125 » des concentriques DIFLUX : intérieur (fumées) / extérieur (air).
  const [dInt, dExt] = String(a.diametre ?? '').split('/').map((x) => nombre(x.trim()));
  const out = {
    type_piece: type, diametre_int: Number.isFinite(dInt) ? dInt : null, diametre_ext: Number.isFinite(dExt) ? dExt : null,
    longueur_mm: null, longueur_max_mm: null, angle: null, pente_min: null, pente_max: null,
    couleur: /black|deko/i.test(a.gamme) || /N(AH)?$|DWN|FLN|DEN/.test(String(a.reference)) ? 'noir' : 'inox',
    gamme_tarif: a.gamme, parse_confidence: type ? 0.9 : 0, parse_notes: null,
  };
  const plage = /l ?= ?(\d+) ?- ?(\d+) ?mm/.exec(n);
  const lg = /l ?= ?(\d+) ?mm/.exec(n);
  if (plage) { out.longueur_mm = Number(plage[1]); out.longueur_max_mm = Number(plage[2]); }
  else if (lg) out.longueur_mm = Number(lg[1]);
  const ang = /^(coude|te) (\d+) ?°/.exec(n);
  if (ang) out.angle = Number(ang[2]);
  const pente = /pente (\d+) ?\/ ?(\d+) ?°/.exec(n);
  if (pente) { out.pente_min = Number(pente[1]); out.pente_max = Number(pente[2]); }
  if (type === 'flexible') { const ml = /couronne (\d+) ?metres|couronne de (\d+) ?m/.exec(n); out.longueur_mm = ml ? Number(ml[1] || ml[2]) * 1000 : null; }
  // Raccord d'adaptation DEKO → DW : la version courte (330-400) est le raccord simple paroi ; la longue est à part.
  if (type === 'raccord_simple_paroi' && out.longueur_mm != null && out.longueur_mm >= 500) { type = 'raccord_adaptation_long'; out.type_piece = type; }
  if (!type) out.parse_notes = `désignation non reconnue : ${n}`;
  return out;
}
