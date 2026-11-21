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
 * Décode les octets d'un CSV : UTF-8 (BOM retiré), sinon Windows-1252.
 * @param {Uint8Array} octets
 * @returns {string}
 */
export function decoderTexte(octets) {
  let texte;
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    texte = new TextDecoder('windows-1252').decode(octets);
  }
  return texte.charCodeAt(0) === 0xFEFF ? texte.slice(1) : texte;
}

const SEPARATEURS = [';', ',', '\t'];

// Séparateur le plus fréquent, hors guillemets, sur la première ligne non vide.
function detecterSeparateur(texte) {
  const compte = { ';': 0, ',': 0, '\t': 0 };
  let dansGuillemets = false;
  let vu = false;
  for (const c of texte) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (!dansGuillemets) {
      if (c === '\n' || c === '\r') {
        if (vu) break;
      } else {
        vu = true;
        if (c in compte) compte[c] += 1;
      }
    }
  }
  let meilleur = ';';
  for (const s of SEPARATEURS) if (compte[s] > compte[meilleur]) meilleur = s;
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
    } else if (c === '"') dansGuillemets = true;
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
 * Découpe la matrice en en-têtes et lignes de données.
 * @param {string[][]} matrice
 * @param {number} indexEntete
 * @returns {{ entetes: string[], lignes: Array<{ numero: number, cellules: string[] }> }}
 */
export function tableau(matrice, indexEntete) {
  const brut = matrice[indexEntete] || [];
  const entetes = brut.map((c, i) => {
    const t = String(c ?? '').trim();
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
