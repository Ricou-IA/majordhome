// ============================================================================
// Parseur PUR d'une ligne du tarif fournisseur (MAYER002, MODINOX/ALTEMA 2026) :
// « GAMME - COMPOSANT - attributs » → attributs de fum_article_attrs.
// Aucune dépendance. Testé : scripts/fumisterie/parse-designation.test.mjs.
// Tout ce qui n'est pas reconnu baisse parse_confidence et s'écrit dans parse_notes :
// le rapport d'import liste ces lignes, on ne les avale pas.
// ============================================================================

/** Ordre = priorité : première expression qui matche. */
const TYPES_PIECE = [
  ['chapeau_anti_refouleur', /CHAPEAU ANTI[ -]?REFOULEUR/],
  ['chapeau', /\bCHAPEAU\b/],
  ['element_reglable', /ELT REGLABLE|ELEMENT REGLABLE|COULISSANT/],
  ['raccord_simple_paroi', /RACCORD SIMPLE PAROI/],
  ['element_droit', /ELT DROIT|ELEMENT DROIT|\bTUYAU\b|\bTUBE\b/],
  ['coude', /\bCOUDE\b/],
  ['te', /\bTE\b\s*\d*/],
  ['collier_jonction', /COLLIER DE JONCTION/],
  ['collier_sous_toiture', /COLLIER UNIVERSEL/],
  ['collier_mural', /COLLIER MURAL/],
  ['collier', /\bCOLLIER\b/],
  ['couronne_coupe_feu', /COURONNE COUPE[ -]?FEU/],
  ['plaque_proprete', /PLAQUE DE PROPRETE/],
  ['plaque_habillage', /PLAQUE (D )?HAB/],
  ['solin', /\bSOLIN\b/],
  ['collerette', /COLLERETTE/],
  ['support_mural', /SUPPORT MURAL/],
  ['support', /\bSUPPORT\b/],
  ['purge', /\bPURGE\b/],
  ['manchon', /\bMANCHON\b/],
  ['kit', /\bKIT\b/],
  ['plaque', /\bPLAQUE\b/],
];

const HORS_PERIMETRE = /\bGAZ\b|FIOUL|CHARBON|904L|ALUMINI|POLYPROP/;
const SUR_MESURE = /RAL\s*:\s*X|A PRECISER|\.{3}|…|\bD XXX\b|SUR MESURE/i;

/** Gamme nettoyée : espaces multiples, point final de parenthèse, espaces de bord. */
export function normaliserGamme(texte) {
  return String(texte || '')
    .replace(/\s+/g, ' ')
    .replace(/\.\)/g, ')')
    .trim()
    .toUpperCase();
}

function couleurDe(segments, gamme) {
  const tout = segments.join(' ');
  if (/INOX NOIR|\bNOIR\b/.test(tout)) return 'noir';
  if (/\bBLANC\b/.test(tout)) return 'blanc';
  if (/\bRAL\b/.test(tout)) return 'ral';
  if (/\bGALVA\b/.test(tout) || /\bG\b$/.test(gamme) || /\bG LAQ$/.test(gamme)) return 'galva';
  if (/\bINOX\b/.test(tout) || /\bI$/.test(gamme) || /INOX/.test(gamme)) return 'inox';
  return null;
}

/**
 * @param {{ reference: string, designation: string, famille_n1?: string|number|null }} ligne
 */
export function parseDesignation({ designation, famille_n1 }) {
  const texte = String(designation || '').replace(/\u00A0/g, ' ');
  const segments = texte.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const notes = [];
  let gamme = normaliserGamme(segments[0] || '');
  const reste = segments.slice(1).join(' - ').toUpperCase();
  const tout = texte.toUpperCase();

  // Solin : la plage de pente est dans le 1er segment, la gamme est « SOLIN <finition> »
  let pente_min = null; let pente_max = null;
  const solin = gamme.match(/^SOLIN\s+(\d{1,2})\s*A\s*(\d{1,2})\s*°?\s*(.*)$/);
  if (solin) {
    pente_min = Number(solin[1]); pente_max = Number(solin[2]);
    gamme = normaliserGamme(`SOLIN ${solin[3]}`);
  } else {
    const pente = reste.match(/PENTE\s*(\d{1,2})\s*A\s*(\d{1,2})/);
    if (pente) { pente_min = Number(pente[1]); pente_max = Number(pente[2]); }
  }

  let type_piece = null;
  for (const [code, re] of TYPES_PIECE) { if (re.test(tout)) { type_piece = code; break; } }
  if (!type_piece) notes.push('type_piece non reconnu');

  const dInt = tout.match(/\bD\s*(\d{2,3})\b/);
  const dExt = tout.match(/D\s*EXT\s*(\d{2,3})/);
  const lg = tout.match(/\b(?:LG|L)\s*(\d{3,4})(?:\s*A\s*(\d{3,4}))?/);
  const angle = tout.match(/COUDE\s*(\d{2,3})/);
  const version = tout.match(/\bV(\d)\b/);

  const diametre_int = dInt ? Number(dInt[1]) : null;
  if (!diametre_int) notes.push('diametre absent');

  const parse_confidence = type_piece && diametre_int ? 1 : (type_piece || diametre_int ? 0.6 : 0.3);

  return {
    gamme_tarif: gamme,
    type_piece,
    diametre_int,
    diametre_ext: dExt ? Number(dExt[1]) : null,
    longueur_mm: lg ? Number(lg[1]) : null,
    longueur_max_mm: lg && lg[2] ? Number(lg[2]) : null,
    angle: angle ? Number(angle[1]) : null,
    pente_min,
    pente_max,
    couleur: couleurDe(segments.slice(1), gamme),
    version: version ? `V${version[1]}` : null,
    sur_mesure: SUR_MESURE.test(texte),
    hors_perimetre: String(famille_n1 ?? '') === '22' || HORS_PERIMETRE.test(tout),
    parse_confidence,
    parse_notes: notes.length ? notes.join(' ; ') : null,
  };
}
