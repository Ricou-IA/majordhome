/**
 * avatarCouleur.js — couleur et initiales d'un avatar (module PUR, testé scripts/avatar-couleur.test.mjs).
 *
 * Six teintes fixes (direction artistique § 7), choisies par hachage de l'identifiant : la même
 * personne garde la même couleur partout. La couleur d'une personne au planning, quand on la
 * connaît, passe par la propriété `couleur` d'Avatar et ne vient pas d'ici.
 */

export const PALETTE_AVATAR = Object.freeze(['#C2532B', '#2D5BC7', '#1E7A4C', '#7A4BB8', '#A86A0E', '#0E7490']);

/**
 * Teinte d'un avatar, stable pour un identifiant donné.
 * @param {string|null|undefined} id
 * @returns {string} un hex de PALETTE_AVATAR
 */
export function couleurAvatar(id) {
  const texte = String(id ?? '');
  let hash = 0;
  for (let i = 0; i < texte.length; i += 1) hash = (hash * 31 + texte.charCodeAt(i)) >>> 0;
  return PALETTE_AVATAR[hash % PALETTE_AVATAR.length];
}

/**
 * Initiales d'un nom : première lettre du premier et du dernier mot, en majuscules ; « ? » si vide.
 * @param {string|null|undefined} nom
 * @returns {string}
 */
export function initiales(nom) {
  const mots = String(nom ?? '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  const premier = mots[0][0];
  const dernier = mots.length > 1 ? mots[mots.length - 1][0] : '';
  return (premier + dernier).toLocaleUpperCase('fr-FR');
}
