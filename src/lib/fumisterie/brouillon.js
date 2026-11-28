// src/lib/fumisterie/brouillon.js
// Règles du brouillon du métré (module PUR). Recette du 2026-11-28 : brouillon écrit au premier clic sur une carte,
// bannière avec un code interne (« CFG-27 »), sans date, jamais retirée. Ici : un brouillon n'existe qu'après une
// vraie saisie, se résume en français, porte sa date et vieillit (30 jours).

export const VERSION_BROUILLON = 1;
export const DUREE_BROUILLON_JOURS = 30;
const JOUR_MS = 24 * 3600 * 1000;

/**
 * Brouillon reprenable : un relevé, et pas plus vieux que 30 jours. Un brouillon d'avant ce format (sans version ni
 * date) reste reprenable : on ne jette pas une saisie parce qu'elle est d'avant la mise à jour.
 * @param {any} d
 * @param {number} [maintenant]
 * @returns {boolean}
 */
export function brouillonValide(d, maintenant = Date.now()) {
  if (!d || typeof d !== 'object' || !d.releve) return false;
  if (d.savedAt == null) return true;
  const t = new Date(d.savedAt).getTime();
  return Number.isFinite(t) && maintenant - t <= DUREE_BROUILLON_JOURS * JOUR_MS;
}

/**
 * @param {{ etape: number, criteres: object, configurationId: string|null, configLibelle?: string|null, releve: object|null, modifies?: string[] }} etat
 * @param {number} [maintenant]
 */
export function nouveauBrouillon({ etape, criteres, configurationId, configLibelle = null, releve, modifies = [] }, maintenant = Date.now()) {
  return { version: VERSION_BROUILLON, savedAt: new Date(maintenant).toISOString(), etape, criteres, configurationId, configLibelle, releve, modifies };
}

/** Clés du relevé dont la valeur a changé (une saisie, « Ajuster »). @param {object|null} avant @param {object|null} apres @returns {string[]} */
export function clesModifiees(avant, apres) {
  const a = avant || {};
  const b = apres || {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
}

/** @param {string[]|null|undefined} modifies @param {string[]} cles @returns {string[]} */
export function ajouterModifies(modifies, cles) {
  return [...new Set([...(modifies || []), ...cles])];
}

/** « Conduit isolé PTR30 neuf, à travers la maison · Ø150 » — jamais un code de configuration. @param {any} d @returns {string} */
export function resumeBrouillon(d) {
  const libelle = d?.configLibelle || 'Relevé en cours';
  return d?.releve?.diametre ? `${libelle} · Ø${d.releve.diametre}` : libelle;
}

/** « Reprendre le relevé du 28 nov. à 12:46 ? » (heure de Paris). @param {any} d @returns {string} */
export function titreReprise(d) {
  const t = d?.savedAt ? new Date(d.savedAt) : null;
  if (!t || !Number.isFinite(t.getTime())) return 'Reprendre le relevé en cours ?';
  const jour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(t);
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(t);
  return `Reprendre le relevé du ${jour} à ${heure} ?`;
}

const COMBUSTIBLE = { bois_buches: 'le bois bûches', pellets: 'les granulés' };

/**
 * Le brouillon contredit la famille du devis (combustible) : la phrase à dire, sinon null.
 * @param {any} d @param {{ combustible?: string|null }} criteresFamille @returns {string|null}
 */
export function contradictionFamille(d, criteresFamille) {
  const du = d?.criteres?.combustible;
  const devis = criteresFamille?.combustible;
  if (!du || !devis || du === devis) return null;
  return `Ce relevé est prévu pour ${COMBUSTIBLE[du] || du}, le devis pour ${COMBUSTIBLE[devis] || devis}.`;
}
