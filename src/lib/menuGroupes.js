/**
 * menuGroupes.js - Majord'home
 * ============================================================================
 * Rangement du menu latéral en groupes repliables. Module PUR (aucun import
 * React / Supabase / alias), testé par scripts/menu-groupes.test.mjs —
 * AppLayout ne fait qu'afficher.
 *
 * Un menu court reste une liste simple : des titres au-dessus de quatre ou six
 * entrées (technicien, entreprise sans module) alourdissent au lieu d'aider.
 * Aucune entrée n'est jamais retirée : une entrée sans groupe connu va dans le
 * premier groupe, sans titre.
 * ============================================================================
 */

/** Groupes du menu, dans l'ordre d'affichage. `titre: null` = sans titre, jamais replié. */
export const GROUPES_MENU = Object.freeze([
  Object.freeze({ cle: 'quotidien', titre: null }),
  Object.freeze({ cle: 'ventes', titre: 'Clients & ventes' }),
  Object.freeze({ cle: 'terrain', titre: 'Terrain' }),
  Object.freeze({ cle: 'marketing', titre: 'Marketing', replie: true }),
  Object.freeze({ cle: 'etudes', titre: 'Études', replie: true }),
]);

/** Jusqu'à ce nombre d'entrées visibles, le menu reste une liste simple. */
export const SEUIL_MENU_GROUPE = 8;

/**
 * Range les entrées visibles en groupes.
 * @param {Array<{ groupe?: string }>} items  entrées visibles, dans l'ordre du menu
 * @returns {Array<{ cle: string, titre: string|null, replie?: boolean, items: Array<object> }>}
 *   un seul groupe sans titre pour un menu court ; sinon les groupes non vides, dans
 *   l'ordre de GROUPES_MENU, chaque entrée gardant son rang d'origine dans son groupe.
 */
export function grouperMenu(items = []) {
  if (items.length <= SEUIL_MENU_GROUPE) {
    return items.length ? [{ cle: GROUPES_MENU[0].cle, titre: null, items }] : [];
  }
  const connus = new Set(GROUPES_MENU.map((g) => g.cle));
  return GROUPES_MENU
    .map((groupe, rang) => ({
      ...groupe,
      items: items.filter((item) => (connus.has(item.groupe) ? item.groupe === groupe.cle : rang === 0)),
    }))
    .filter((groupe) => groupe.items.length > 0);
}

/**
 * Entrée du menu à laquelle appartient la page affichée.
 * @param {{ href: string }} item
 * @param {string} pathname
 * @returns {boolean}  l'accueil (`/`) ne vaut que pour lui-même
 */
export function pageDansEntree(item, pathname = '') {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Un groupe est-il déplié ? Le groupe de la page affichée l'est toujours (on ne
 * cache jamais l'entrée où l'on se trouve) ; sinon le choix de la personne,
 * sinon le réglage par défaut du groupe.
 * @param {{ cle: string, titre: string|null, replie?: boolean, items: Array<{ href: string }> }} groupe
 * @param {{ preferences?: Record<string, boolean>, pathname?: string }} [contexte]
 * @returns {{ ouvert: boolean, force: boolean }}  `force` = déplié d'office, le repli est sans effet
 */
export function etatDuGroupe(groupe, { preferences = {}, pathname = '' } = {}) {
  if (!groupe.titre) return { ouvert: true, force: true };
  if (groupe.items.some((item) => pageDansEntree(item, pathname))) return { ouvert: true, force: true };
  const choix = preferences?.[groupe.cle];
  return { ouvert: typeof choix === 'boolean' ? choix : !groupe.replie, force: false };
}

/**
 * Choix de repli enregistrés (texte du stockage du navigateur).
 * @param {string|null|undefined} texte
 * @returns {Record<string, boolean>}  objet vide si absent ou illisible
 */
export function lirePreferencesMenu(texte) {
  if (!texte) return {};
  try {
    const lu = JSON.parse(texte);
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {};
    return Object.fromEntries(Object.entries(lu).filter(([, v]) => typeof v === 'boolean'));
  } catch {
    return {};
  }
}
