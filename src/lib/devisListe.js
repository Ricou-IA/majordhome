/**
 * devisListe.js — règles de la page Devis (liste des devis faits dans Majord'home, module pur).
 * ============================================================================
 * La page lit TOUS les devis de l'entreprise (lecture paginée en entier, jamais un plafond
 * silencieux), puis filtre ici : statut ET recherche se cumulent, les compteurs des pastilles
 * se comptent sur la recherche en cours (une pastille ne contredit jamais la liste affichée).
 * La recherche ignore casse et accents (numéro, client, objet, ville).
 * Les devis Pennylane jamais créés ici restent dans l'onglet « Orphelins Pennylane ».
 * Testé : scripts/devis-liste.test.mjs.
 * ============================================================================
 */

/** Statuts d'un devis Majord'home, dans l'ordre de son cycle (valeurs de `quotes.status`). */
export const STATUTS_DEVIS = Object.freeze([
  { value: 'brouillon', label: 'Brouillon', ton: 'neutre' },
  { value: 'envoye', label: 'Envoyé', ton: 'info' },
  { value: 'accepte', label: 'Accepté', ton: 'ok' },
  { value: 'refuse', label: 'Refusé', ton: 'alerte' },
  { value: 'expire', label: 'Expiré', ton: 'attente' },
]);

const PAR_VALEUR = new Map(STATUTS_DEVIS.map((s) => [s.value, s]));

/** Libellé et ton d'un statut (inconnu ⇒ son code, ton neutre : jamais masqué). */
export function statutDevis(valeur) {
  return PAR_VALEUR.get(valeur) || { value: valeur, label: valeur || '—', ton: 'neutre' };
}

export function normaliserRecherche(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function correspond(devis, terme) {
  if (!terme) return true;
  const champs = [devis.quote_number, devis.client_display_name, devis.subject, devis.client_city];
  return champs.some((c) => normaliserRecherche(c).includes(terme));
}

/** Devis qui répondent à la recherche (sans filtre de statut). */
export function rechercherDevis(rows = [], q = '') {
  const terme = normaliserRecherche(q);
  return rows.filter((d) => correspond(d, terme));
}

/** Liste affichée : recherche ET statut. `statut` vide = tous. */
export function filtrerDevis(rows = [], { statut = '', q = '' } = {}) {
  return rechercherDevis(rows, q).filter((d) => !statut || d.status === statut);
}

/** Compteurs des pastilles, sur la recherche en cours : `{ tous, brouillon, envoye, … }`. */
export function compterDevis(rows = [], q = '') {
  const trouves = rechercherDevis(rows, q);
  const compte = { tous: trouves.length };
  for (const s of STATUTS_DEVIS) compte[s.value] = 0;
  for (const d of trouves) if (Object.hasOwn(compte, d.status)) compte[d.status] += 1;
  return compte;
}
