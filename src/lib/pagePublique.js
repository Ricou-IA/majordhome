// ============================================================================
// pagePublique.js — habillage des pages ouvertes au client sans compte (/pv/:token).
// Règles PURES : la couleur de l'entreprise devient trois teintes sûres à lire, et un
// prénom saisi en capitales s'écrit comme un prénom. Testé : scripts/page-publique.test.mjs
// ============================================================================

/** Teinte neutre d'une entreprise sans couleur réglée (slate 600). */
export const ACCENT_NEUTRE = '#475569';

const TEXTE_SOMBRE = '#020617';
const TEXTE_CLAIR = '#ffffff';
/** Part de la couleur dans le fond teinté d'un élément sélectionné. */
const PART_FOND_DOUX = 0.1;

/** `#rgb` ou `#rrggbb` → [r, g, b], sinon `null`. */
function lireHex(couleur) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(couleur ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function versHex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Luminance relative (WCAG 2.1). */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste (WCAG 2.1) entre deux couleurs `#rrggbb`. */
export function contraste(a, b) {
  const [la, lb] = [luminance(lireHex(a)), luminance(lireHex(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Les trois teintes d'une page publique à partir de la couleur de l'entreprise.
 * `surAccent` est le texte posé SUR la couleur : blanc s'il s'y lit (4,5:1), sinon le
 * plus lisible des deux — un orange clair reçoit un texte sombre, pas un blanc illisible.
 * @param {string|null|undefined} couleur `#rgb` ou `#rrggbb` ; autre chose ⇒ teinte neutre
 * @returns {{ accent: string, surAccent: string, doux: string }}
 */
export function teintesDeMarque(couleur) {
  const rgb = lireHex(couleur) || lireHex(ACCENT_NEUTRE);
  const accent = versHex(rgb);
  const surBlanc = contraste(accent, TEXTE_CLAIR);
  const surAccent = surBlanc >= 4.5 || surBlanc >= contraste(accent, TEXTE_SOMBRE) ? TEXTE_CLAIR : TEXTE_SOMBRE;
  const doux = versHex(rgb.map((v) => 255 - (255 - v) * PART_FOND_DOUX));
  return { accent, surAccent, doux };
}

/**
 * Prénom tel qu'on l'écrit : « JULIEN » → « Julien », « jean-pierre » → « Jean-Pierre ».
 * Une casse déjà mixte est laissée telle quelle (« McKenzie »).
 * @param {string|null|undefined} prenom
 * @returns {string}
 */
export function prenomLisible(prenom) {
  const p = String(prenom ?? '').trim().replace(/\s+/g, ' ');
  if (!p) return '';
  const bas = p.toLocaleLowerCase('fr-FR');
  if (p !== bas && p !== p.toLocaleUpperCase('fr-FR')) return p;
  return bas.replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, lettre) => sep + lettre.toLocaleUpperCase('fr-FR'));
}
