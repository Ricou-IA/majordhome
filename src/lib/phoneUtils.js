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
