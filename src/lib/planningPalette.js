/**
 * planningPalette.js — palette des couleurs planning (une couleur par PERSONNE).
 * ============================================================================
 * Module PUR (aucun import React / Supabase) : consommé par le sélecteur de
 * couleur de Settings → Équipe et par la création automatique d'une ressource
 * planning (`ensureTeamMember` choisit ici une teinte libre).
 *
 * Règle : le violet `#6D28D9` est RÉSERVÉ au statut « facturé » du calendrier
 * (`INVOICED_EVENT_COLOR` de planningEvents.js) ; la palette l'exclut, et
 * `isReservedColor` refuse aussi ses voisins pour une saisie libre.
 *
 * Testé : `node --test scripts/planning-palette.test.mjs`.
 * ============================================================================
 */

/** Même valeur que `INVOICED_EVENT_COLOR` (planningEvents.js) — dupliquée pour garder ce module sans import. */
export const RESERVED_INVOICED_COLOR = '#6D28D9';

/** Couleur d'une personne sans couleur (fallback du calendrier). */
export const FALLBACK_COLOR = '#94A3B8';

// 14 familles × 2 intensités (Tailwind 500 / 700). Les familles violet / purple
// sont absentes (réservées), fuchsia est gardé (teinte 292°, distinguable).
const FAMILIES = [
  ['Rouge', '#EF4444', '#B91C1C'],
  ['Orange', '#F97316', '#C2410C'],
  ['Ambre', '#F59E0B', '#B45309'],
  ['Citron', '#84CC16', '#4D7C0F'],
  ['Vert', '#22C55E', '#15803D'],
  ['Émeraude', '#10B981', '#047857'],
  ['Sarcelle', '#14B8A6', '#0F766E'],
  ['Cyan', '#06B6D4', '#0E7490'],
  ['Ciel', '#0EA5E9', '#0369A1'],
  ['Bleu', '#3B82F6', '#1D4ED8'],
  ['Indigo', '#6366F1', '#4338CA'],
  ['Fuchsia', '#D946EF', '#A21CAF'],
  ['Rose', '#EC4899', '#BE185D'],
  ['Ardoise', '#64748B', '#334155'],
];

/**
 * Palette ordonnée par famille, intensité claire puis foncée.
 * @type {Array<{ hex: string, label: string, family: string, shade: 'clair'|'fonce' }>}
 */
export const PLANNING_PALETTE = FAMILIES.flatMap(([family, clair, fonce]) => [
  { hex: clair, label: family, family, shade: 'clair' },
  { hex: fonce, label: `${family} foncé`, family, shade: 'fonce' },
]);

/**
 * Normalise une saisie en `#RRGGBB` majuscule. Accepte `#abc`, `abc123`, espaces autour.
 * @param {unknown} input
 * @returns {string|null} null si ce n'est pas une couleur hexadécimale
 */
export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) return `#${s.split('').map((c) => c + c).join('').toUpperCase()}`;
  return null;
}

/** @returns {{ r: number, g: number, b: number }|null} */
function rgbOf(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

/** Teinte (0–360) et saturation HSL (0–1). */
function hueSaturation({ r, g, b }) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0 };
  const l = (max + min) / 2;
  const saturation = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === R) hue = 60 * (((G - B) / d) % 6);
  else if (max === G) hue = 60 * ((B - R) / d + 2);
  else hue = 60 * ((R - G) / d + 4);
  if (hue < 0) hue += 360;
  return { hue, saturation };
}

/**
 * Vrai si la couleur est le violet facturé ou un voisin (teinte 250–285°, saturée) :
 * sur le calendrier elle se confondrait avec un RDV facturé.
 * Une valeur invalide renvoie false (elle est invalide, pas réservée).
 */
export function isReservedColor(hex) {
  const n = normalizeHex(hex);
  if (!n) return false;
  if (n === RESERVED_INVOICED_COLOR) return true;
  const { hue, saturation } = hueSaturation(rgbOf(n));
  return saturation >= 0.25 && hue >= 250 && hue <= 285;
}

/**
 * Première teinte de la palette non prise ; si tout est pris, boucle sur le nombre de couleurs prises.
 * @param {Iterable<string>} usedColors couleurs déjà attribuées (casse libre)
 */
export function pickFreeColor(usedColors) {
  const used = new Set();
  for (const c of usedColors || []) { const n = normalizeHex(c); if (n) used.add(n); }
  const libre = PLANNING_PALETTE.find((c) => !used.has(c.hex));
  return libre ? libre.hex : PLANNING_PALETTE[used.size % PLANNING_PALETTE.length].hex;
}

/**
 * Vrai si un texte sombre se lit mieux que du blanc sur cette couleur : au-dessus d'une luminance
 * relative de 0,179 le contraste avec le noir dépasse celui avec le blanc (WCAG).
 * Une valeur invalide est traitée comme sombre (texte blanc).
 */
export function isLightColor(hex) {
  const rgb = rgbOf(hex);
  if (!rgb) return false;
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return L > 0.179;
}

/** Libellé de la teinte si elle est dans la palette, sinon le code tel quel. */
export function paletteLabel(hex) {
  const n = normalizeHex(hex);
  return PLANNING_PALETTE.find((c) => c.hex === n)?.label || hex;
}
