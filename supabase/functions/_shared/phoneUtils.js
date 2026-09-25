// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/phoneUtils.js — ne pas éditer.
/**
 * phoneUtils.js — Utilitaires téléphone pour les services
 * ============================================================================
 * Centralise les fonctions de nettoyage et formatage téléphone utilisées
 * par clients.service et leads.service pour la recherche.
 *
 * Note : formatPhoneNumber() pour l'affichage UI reste dans utils.js.
 * ============================================================================
 */

/**
 * Nettoie un numéro de téléphone (garde chiffres, espaces et +)
 * @param {string} phone - Numéro brut
 * @returns {string|null} Numéro nettoyé ou null
 */
export function cleanPhone(phone) {
  if (!phone) return null;
  return phone.replace(/[^\d\s+]/g, '').trim() || null;
}

/**
 * Formate un terme de recherche en version "téléphone avec espaces"
 * pour matcher les formats stockés en base.
 *
 * @param {string} term - Terme de recherche
 * @returns {string|null} Terme formaté ou null si pas un numéro
 *
 * @example
 * formatPhoneForSearch("0675740138") → "06 75 74 01 38"
 * formatPhoneForSearch("0675") → "06 75"
 * formatPhoneForSearch("bonjour") → null
 */
export function formatPhoneForSearch(term) {
  const digits = term.replace(/\s/g, '');
  if (!/^[+]?\d{2,}$/.test(digits)) return null;
  const hasPlus = digits.startsWith('+');
  const raw = hasPlus ? digits.slice(1) : digits;
  const pairs = raw.match(/.{1,2}/g) || [];
  const spaced = (hasPlus ? '+' : '') + pairs.join(' ');
  return spaced;
}

/**
 * Teste si un champ téléphone contient un numéro joignable (≥ 9 chiffres :
 * tolère le format Pennylane sans 0 initial « 679217420 »). Sert de garde
 * avant la prise d'une visite technique : pas de numéro, pas de RDV.
 * @param {string} phone - Numéro brut
 * @returns {boolean}
 */
export function hasPhoneNumber(phone) {
  if (!phone) return false;
  return String(phone).replace(/\D/g, '').length >= 9;
}

/**
 * Teste si un numéro est un mobile français (06/07), au format national
 * (0612345678) ou international (+33/0033/33). Tolère espaces, points, tirets.
 * @param {string} phone - Numéro brut
 * @returns {boolean}
 */
export function isMobileFR(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[\s.-]/g, '');
  return /^0[67]\d{8}$/.test(cleaned) || /^(?:\+33|0033|33)[67]\d{8}$/.test(cleaned);
}
