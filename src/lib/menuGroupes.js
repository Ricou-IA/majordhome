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
  // Carte, visibilité locale, publicité : outils consultés de temps en temps (DA § 9).
  Object.freeze({ cle: 'outils', titre: 'Outils', replie: true }),
  // Prospection et Cédants : à part des ventes du quotidien (Eric, recette du 2026-11-22).
  Object.freeze({ cle: 'developpement', titre: 'Développement', replie: true }),
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
 * Pages proposées en priorité dans la barre du bas du téléphone, dans cet ordre : celles
 * qu'on ouvre plusieurs fois par jour. Les autres restent dans le menu complet (« Plus »).
 */
export const PRIORITE_BARRE = Object.freeze(['/', '/planning', '/clients', '/entretiens', '/pipeline', '/chantiers']);

/**
 * Raccourcis de la barre du bas (téléphone) : les pages prioritaires que la personne peut
 * ouvrir, complétées par ses autres pages quand il en manque (compte sans accès aux
 * clients, entreprise sans CRM). Trois raccourcis à côté du bouton « Créer », quatre sans lui.
 * @param {Array<{ href: string }>} items  entrées visibles du menu, dans leur ordre
 * @param {{ avecCreer?: boolean }} [options]  vrai si la personne peut créer quelque chose
 * @returns {Array<object>}  les entrées retenues (mêmes objets), dans l'ordre d'affichage
 */
export function raccourcisBarre(items = [], { avecCreer = false } = {}) {
  const prioritaires = PRIORITE_BARRE
    .map((href) => items.find((item) => item.href === href))
    .filter(Boolean);
  const autres = items.filter((item) => !PRIORITE_BARRE.includes(item.href));
  return [...prioritaires, ...autres].slice(0, avecCreer ? 3 : 4);
}

/**
 * Libellé d'un raccourci de la barre du bas : court, une ligne sous l'icône.
 * @param {{ href: string, name: string }} item
 * @returns {string}  « Accueil » pour la page d'accueil, sinon le nom de l'entrée
 */
export function libelleDeBarre(item) {
  return item.href === '/' ? 'Accueil' : item.name;
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

/**
 * Clé de stockage du choix « menu replié » (icônes seules), propre à chaque utilisateur.
 * @param {string} userId
 * @returns {string}
 */
export function cleMenuReplie(userId) {
  return `mdh-menu-replie:${userId}`;
}
