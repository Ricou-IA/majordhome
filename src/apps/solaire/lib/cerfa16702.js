// src/apps/solaire/lib/cerfa16702.js
// Field map PUR du CERFA n°16702*03 (Déclaration Préalable — constructions et travaux
// non soumis à permis de construire). Noms de champs issus de l'énumération AcroForm
// réelle du PDF officiel (386 champs, reconnaissance 2026-07-11).
// AUCUN import (ni pdf-lib, ni asset) — testé via `node --test scripts/cerfa16702.test.mjs`.
// Le remplissage runtime vit dans fillCerfa.js.
//
// Décisions (plan 2026-07-11) :
// - PV en TOITURE = case « travaux sur construction existante » (C2ZB1) + description libre.
//   La rubrique 4.2.1 « puissance crête » (C2ZP1) ne vise que le PV AU SOL → jamais remplie.
// - Surimposition : aucune surface de plancher ni emprise créée → W3ES2/W3ES3 = '0',
//   tableau 4.4 laissé vierge.
// - 3 slots parcelles seulement sur le formulaire → au-delà : overflowParcelles=true
//   (fiche complémentaire papier à joindre).
// - Champs vides : ABSENTS du mapping (on ne setText('') jamais — laisse le PDF vierge).

// Champs à aligner à DROITE au remplissage : leur texte doit toucher un séparateur imprimé
// juste à leur droite. D5GE1_email (partie locale avant « @ ») est un champ large aligné à
// gauche → « e.pudebat » flotte loin du « @ » imprimé ; aligné à droite, il colle au @.
export const CERFA_RIGHT_ALIGNED = ['D5GE1_email'];

const DATE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** '1980-03-07' → '07031980' (les champs date du CERFA font 8 chars, JJMMAAAA). */
export function toJJMMAAAA(iso) {
  const m = DATE_ISO_RE.exec(iso ?? '');
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

/** Le CERFA imprime le @ entre deux champs → scinde sur le premier @. */
export function splitEmail(email) {
  const s = String(email ?? '');
  const i = s.indexOf('@');
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// Helvetica AcroForm = WinAnsi (CP1252) : l'espace fine insécable U+202F, le moins U+2212…
// font planter l'encodage. Les guillemets/tirets typographiques sont dans CP1252 mais on
// les normalise aussi (rendu plus sûr dans les petits champs).
const WINANSI_MAP = [
  [' ', ' '], [' ', ' '], ['−', '-'], ['‑', '-'],
  ['‘', "'"], ['’', "'"], ['“', '"'], ['”', '"'],
  ['–', '-'], ['—', '-'], ['…', '...'],
];

/** Texte sûr pour un champ AcroForm Helvetica (latin-1 imprimable + € œ Œ). */
export function sanitizeWinAnsi(str) {
  if (str == null) return '';
  let out = String(str);
  for (const [from, to] of WINANSI_MAP) out = out.split(from).join(to);
  // Filet : tout caractère restant hors latin-1 imprimable → espace.
  return out.replace(/[^\x20-\x7E\xA1-\xFFŒœ€]/g, ' ');
}

/** Téléphone FR → 10 chiffres (maxLen du champ D3T). +33 → 0. */
export function cleanPhone10(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('33') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.slice(0, 10);
}

/**
 * Courte description des travaux (champ C2ZD1, max 1000 chars) — partagée avec la notice.
 * Jamais de « undefined » : marque/modèle optionnels.
 */
export function buildCerfaDescription({ kwc, panels, marque, modele, aspect }) {
  const materiel = [marque, modele].filter(Boolean).join(' ');
  const aspectTxt = aspect === 'full_black' ? " d'aspect noir uniforme (full black)" : '';
  return (
    `Installation de ${panels} modules photovoltaïques (${String(kwc).replace('.', ',')} kWc) ` +
    `en surimposition sur la toiture existante de l'habitation, parallèlement au plan de couverture ` +
    `(épaisseur < 15 cm).${materiel ? ` Modules ${materiel}${aspectTxt}.` : aspectTxt ? ` Modules${aspectTxt}.` : ''} ` +
    `Aucune modification de la structure du bâtiment. ` +
    `Aucune création de surface de plancher ni d'emprise au sol.`
  );
}

// Suffixes des 3 slots parcelles du cadre 3.1 : T2{F|S|N|T}, puis T2{F|S|N|T}P2, P3.
const PARCELLE_SLOTS = ['', 'P2', 'P3'];

// Périmètres protégés (cadre 5) ← catégories de servitude GPU.
const ABF_CHECKBOX_BY_SUPTYPE = {
  ac1: 'X2H_historique', // abords de monuments historiques
  ac2: 'X2C_classe', // site classé ou inscrit
  ac4: 'X2R_remarquable', // site patrimonial remarquable
};

// Bordereau des pièces jointes ← pièces effectivement générées (tranche 3).
const BORDEREAU_CHECKBOX_BY_PIECE = {
  dpc1: 'P5PA2', // plan de situation
  dpc2: 'P5PB1', // plan de masse
};

const put = (obj, key, value) => {
  const v = value == null ? '' : String(value).trim();
  if (v) obj[key] = v;
};

/**
 * Données du dossier → champs du CERFA 16702*03.
 * @returns {{ text: Record<string,string>, checks: string[], overflowParcelles: boolean }}
 */
export function buildCerfaFields({ declarant, terrain, parcelles, abf, description, todayIso, signedAtIso, signatureLieu, piecesPresentes }) {
  const text = {};
  const checks = [];

  // --- 1. Identité du déclarant (personne physique) ---
  put(text, 'D1N_nom', declarant?.nom);
  put(text, 'D1P_prenom', declarant?.prenom);
  put(text, 'D1A_naissance', toJJMMAAAA(declarant?.date_naissance));
  put(text, 'D1C_commune', declarant?.naissance_commune);
  put(text, 'D1D_dept', declarant?.naissance_departement);
  put(text, 'D1E_pays', declarant?.naissance_pays);

  // --- 2. Coordonnées du déclarant ---
  const adr = declarant?.adresse ?? {};
  put(text, 'D3N_numero', adr.numero);
  put(text, 'D3V_voie', adr.voie);
  put(text, 'D3W_lieudit', adr.lieudit);
  put(text, 'D3L_localite', adr.localite);
  put(text, 'D3C_code', adr.code_postal);
  put(text, 'D3T_telephone', cleanPhone10(declarant?.telephone));
  const [emailUser, emailDomain] = splitEmail(declarant?.email);
  if (emailUser && emailDomain) {
    text.D5GE1_email = emailUser;
    text.D5GE2_email = emailDomain;
  }
  if (declarant?.notif_electronique) checks.push('D5A_acceptation');

  // --- 3.1 Le terrain + références cadastrales ---
  put(text, 'T2Q_numero', terrain?.numero);
  put(text, 'T2V_voie', terrain?.voie);
  put(text, 'T2W_lieudit', terrain?.lieudit);
  put(text, 'T2L_localite', terrain?.localite);
  put(text, 'T2C_code', terrain?.code_postal);
  const list = parcelles ?? [];
  list.slice(0, PARCELLE_SLOTS.length).forEach((p, i) => {
    const s = PARCELLE_SLOTS[i];
    put(text, `T2F${s}_prefixe`, p.prefixe);
    put(text, `T2S${s}_section`, p.section);
    put(text, `T2N${s}_numero`, p.numero);
    if (p.superficie_m2 != null) put(text, `T2T${s}_superficie`, Math.round(p.superficie_m2));
  });
  // Superficie totale du terrain = somme de TOUTES les parcelles (y compris au-delà des 3 slots) ;
  // inconnue si une superficie manque (jamais un total partiel silencieux).
  if (list.length && list.every((p) => p.superficie_m2 != null)) {
    put(text, 'D5T_total', list.reduce((s, p) => s + Math.round(p.superficie_m2), 0));
  }

  // --- 4. Nature des travaux (PV toiture = travaux sur existant) ---
  checks.push('C2ZB1_existante');
  put(text, 'C2ZD1_description', description);
  // Surimposition : rien de créé ni supprimé.
  text.W3ES2_creee = '0';
  text.W3ES3_supprimee = '0';

  // --- 5. Périmètres de protection connus via le GPU ---
  for (const p of abf?.protections ?? []) {
    const box = ABF_CHECKBOX_BY_SUPTYPE[String(p.suptype ?? '').toLowerCase()];
    if (box && !checks.includes(box)) checks.push(box);
  }

  // --- Bordereau des pièces jointes : cochées uniquement si la pièce est réellement générée ---
  for (const piece of piecesPresentes ?? []) {
    const box = BORDEREAU_CHECKBOX_BY_PIECE[String(piece).toLowerCase()];
    if (box && !checks.includes(box)) checks.push(box);
  }

  // --- 7. Engagement du déclarant (lieu + date du consentement si signé, sinon aujourd'hui) ---
  put(text, 'E1L_lieu', signatureLieu || adr.localite);
  put(text, 'E1D_date', toJJMMAAAA(signedAtIso || todayIso));

  return { text, checks, overflowParcelles: list.length > PARCELLE_SLOTS.length };
}
