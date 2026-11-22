// Lecture du fichier déposé (CSV ou feuille Excel) en tableau d'en-têtes et de lignes.
// Module PUR : ni React, ni Supabase, ni ExcelJS. Le chargement du classeur est ailleurs ;
// ce module ne voit que des valeurs de cellule déjà extraites.

export const LIGNES_MAX = 10000;
export const OCTETS_MAX = 10 * 1024 * 1024;

/**
 * Refuse un fichier avant toute lecture (format d'abord, taille ensuite).
 * @param {{ nom: string, taille: number }} fichier
 * @returns {string | null} message à afficher, null = fichier accepté
 */
export function refusFichier({ nom, taille }) {
  const n = String(nom || '').toLowerCase();
  if (n.endsWith('.xls')) return 'Ancien format Excel (.xls) : enregistrez-le en .xlsx ou .csv, puis déposez-le.';
  if (!n.endsWith('.xlsx') && !n.endsWith('.csv')) return 'Format non pris en charge : déposez un fichier .xlsx ou .csv.';
  if (taille > OCTETS_MAX) return 'Fichier trop lourd (10 Mo au plus).';
  return null;
}

/**
 * Décode les octets d'un CSV : UTF-16 si un BOM UTF-16 l'annonce, sinon UTF-8 (BOM retiré), sinon Windows-1252.
 * @param {Uint8Array} octets
 * @returns {string}
 */
export function decoderTexte(octets) {
  if (octets[0] === 0xFF && octets[1] === 0xFE) return new TextDecoder('utf-16le').decode(octets);
  if (octets[0] === 0xFE && octets[1] === 0xFF) return new TextDecoder('utf-16be').decode(octets);
  let texte;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    texte = new TextDecoder('windows-1252').decode(octets);
  }
  return texte.charCodeAt(0) === 0xFEFF ? texte.slice(1) : texte;
}

// Les 27 caractères du bloc 0x80–0x9F de Windows-1252 et leur octet (les autres caractères de ce codage, U+0000–U+00FF,
// ont pour octet leur propre code ; les cinq octets non définis, 0x81, 0x8D, 0x8F, 0x90, 0x9D, sont lus en U+0081…).
const OCTETS_CP1252 = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91],
  [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98],
  [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

/** Octet Windows-1252 d'un caractère, -1 s'il n'en a pas. */
function octetCp1252(code) {
  if (code <= 0xFF) return code;
  return OCTETS_CP1252.has(code) ? OCTETS_CP1252.get(code) : -1;
}

/**
 * Répare un texte UTF-8 qu'un tableur a lu en Windows-1252 (« SociÃ©tÃ© » → « Société »). Témoin : un premier octet
 * d'UTF-8 (Â à ô) suivi d'un octet de suite (0x80–0xBF). Chaque caractère est repassé en son octet Windows-1252 et
 * l'ensemble relu en UTF-8 strict. Un caractère sans octet, un décodage qui échoue ou un résultat identique : le texte
 * d'origine est rendu tel quel. Jamais de réparation partielle.
 * @param {string} texte
 * @returns {string}
 */
export function reparerAccents(texte) {
  const t = String(texte ?? '');
  const codes = Array.from(t, (c) => c.codePointAt(0));
  const octets = codes.map(octetCp1252);
  const temoin = octets.some((o, i) => o >= 0xC2 && o <= 0xF4 && i + 1 < octets.length && octets[i + 1] >= 0x80 && octets[i + 1] <= 0xBF);
  if (!temoin || octets.includes(-1)) return t;
  let repare;
  try {
    repare = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(octets));
  } catch {
    return t;
  }
  return repare === t ? t : repare;
}

/**
 * Répare chaque cellule de la matrice (cf. reparerAccents).
 * @param {string[][]} matrice
 * @returns {{ matrice: string[][], reparees: number }} matrice réparée, nombre de cellules changées
 */
export function reparerMatrice(matrice) {
  let reparees = 0;
  const sortie = (matrice || []).map((ligne) => (ligne || []).map((cellule) => {
    const r = reparerAccents(cellule);
    if (r !== String(cellule ?? '')) reparees += 1;
    return r;
  }));
  return { matrice: sortie, reparees };
}

// Séparateur le plus fréquent, hors guillemets, sur les 10 premières lignes non vides.
// À égalité (ou zéro partout) : `;`, puis tabulation, puis `,`.
function detecterSeparateur(texte) {
  const compte = { ';': 0, '	': 0, ',': 0 };
  let dansGuillemets = false;
  let debutCellule = true;
  let vu = false;
  let lignes = 0;
  for (const c of texte) {
    if (dansGuillemets) {
      if (c === '"') dansGuillemets = false;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (vu) { lignes += 1; vu = false; if (lignes >= 10) break; }
      debutCellule = true;
      continue;
    }
    vu = true;
    if (c === '"' && debutCellule) { dansGuillemets = true; debutCellule = false; continue; }
    if (c in compte) { compte[c] += 1; debutCellule = true; } else debutCellule = false;
  }
  let meilleur = ';';
  for (const sep of [';', '	', ',']) if (compte[sep] > compte[meilleur]) meilleur = sep;
  return meilleur;
}

/**
 * Lit un texte CSV en matrice de cellules.
 * @param {string} texte
 * @returns {string[][]}
 */
export function lireCsv(texte) {
  if (!texte) return [];
  const sep = detecterSeparateur(texte);
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let dansGuillemets = false;
  const finCellule = () => { ligne.push(cellule); cellule = ''; };
  const finLigne = () => { finCellule(); lignes.push(ligne); ligne = []; };

  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { cellule += '"'; i += 1; } else dansGuillemets = false;
      } else cellule += c;
    } else if (c === '"' && cellule === '') dansGuillemets = true; // n'ouvre qu'en début de cellule
    else if (c === sep) finCellule();
    else if (c === '\r') {
      if (texte[i + 1] === '\n') i += 1;
      finLigne();
    } else if (c === '\n') finLigne();
    else cellule += c;
  }
  // Dernière ligne sans fin de ligne ; une ligne finale vide ne produit rien.
  if (cellule !== '' || ligne.length > 0) finLigne();
  // Les lignes vides de fin de fichier ne comptent pas (celles du milieu sont gardées : numéros de ligne fidèles).
  while (lignes.length > 0 && lignes[lignes.length - 1].every((c) => c === '')) lignes.pop();
  return lignes;
}

function nombreEnTexte(n) {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? String(n) : BigInt(n).toString();
  const s = String(n);
  if (!s.includes('e')) return s;
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Valeur de cellule ExcelJS → texte (même lecture que `cellToString` de SupplierManagement).
 * @param {unknown} valeur
 * @returns {string}
 */
export function celluleEnTexte(valeur) {
  if (valeur == null) return '';
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? '' : valeur.toISOString().slice(0, 10);
  if (typeof valeur === 'number') return nombreEnTexte(valeur);
  if (typeof valeur === 'boolean') return valeur ? 'true' : 'false';
  if (typeof valeur === 'string') return valeur.trim();
  if (typeof valeur === 'object') {
    if (valeur.text) return celluleEnTexte(valeur.text); // lien hypertexte
    if (valeur.result != null) return celluleEnTexte(valeur.result); // formule
    if (Array.isArray(valeur.richText)) return valeur.richText.map((rt) => rt.text || '').join('').trim();
  }
  return '';
}

/**
 * Index de la ligne d'en-tête : parmi les dix premières, celle qui a le plus de cellules non vides.
 * @param {string[][]} matrice
 * @returns {number}
 */
export function trouverEntete(matrice) {
  let meilleur = 0;
  let max = -1;
  matrice.slice(0, 10).forEach((ligne, i) => {
    const n = ligne.filter((c) => String(c ?? '').trim() !== '').length;
    if (n > max) { max = n; meilleur = i; }
  });
  return meilleur;
}

// 0 → A, 25 → Z, 26 → AA…
function lettreColonne(index) {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Découpe la matrice en en-têtes et lignes de données. Une colonne remplie au-delà de la ligne d'en-tête n'est pas
 * perdue : elle reçoit l'en-tête « Colonne X » (lettre Excel), comme une colonne d'en-tête vide.
 * @param {string[][]} matrice
 * @param {number} indexEntete
 * @returns {{ entetes: string[], lignes: Array<{ numero: number, cellules: string[] }> }}
 */
export function tableau(matrice, indexEntete) {
  const brut = matrice[indexEntete] || [];
  let largeur = brut.length;
  for (const ligne of matrice.slice(indexEntete + 1)) {
    for (let k = ligne.length - 1; k >= largeur; k -= 1) {
      if (String(ligne[k] ?? '').trim() !== '') { largeur = k + 1; break; }
    }
  }
  const entetes = Array.from({ length: largeur }, (_, i) => {
    const t = String(brut[i] ?? '').trim();
    return t || `Colonne ${lettreColonne(i)}`;
  });
  const lignes = [];
  matrice.slice(indexEntete + 1).forEach((ligne, i) => {
    const cellules = entetes.map((_, k) => String(ligne[k] ?? '').trim());
    if (cellules.every((c) => c === '') && ligne.every((c) => String(c ?? '').trim() === '')) return;
    lignes.push({ numero: indexEntete + 2 + i, cellules });
  });
  return { entetes, lignes };
}
