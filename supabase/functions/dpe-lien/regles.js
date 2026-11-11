// Règles PURES de l'edge function dpe-lien (aucun import, aucun réseau) — testées par scripts/dpe-lien-edge.test.mjs.
// Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md

/** Les codes d'erreur que l'edge function rend au front (traduits par src/lib/dpeLien.js). */
export const CODES = Object.freeze([
  'module_ferme', 'droit_requis', 'action_inconnue', 'client_introuvable', 'adresse_incomplete',
  'client_sans_numero', 'numero_mal_forme', 'numero_absent', 'corpus_indisponible',
  'partenaire_indisponible', 'enregistrement_impossible',
]);

const FORME_NUMERO = /^[0-9A-Za-z]{13}$/;

/**
 * Un numéro de DPE ADEME : 13 caractères alphanumériques, rien d'autre. Même règle que le site MonsieurDPE.
 * @param {unknown} n
 * @returns {boolean}
 */
export function numeroValide(n) {
  return typeof n === 'string' && FORME_NUMERO.test(n);
}

/**
 * L'adresse envoyée au corpus. Rue ET commune (ou code postal) obligatoires : une commune seule géocode
 * la mairie, pas le logement.
 * @param {{ address?: string | null, postal_code?: string | null, city?: string | null } | null | undefined} client
 * @returns {string | null}
 */
export function adresseDeRecherche(client) {
  const propre = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const rue = propre(client?.address);
  const cp = propre(client?.postal_code);
  const ville = propre(client?.city);
  if (!rue || (!cp && !ville)) return null;
  return [rue, cp, ville].filter(Boolean).join(' ');
}

/**
 * Le code d'erreur d'une réponse du corpus, ou null si elle est exploitable.
 * Un 401 (secret faux chez nous) se lit « indisponible » : l'utilisateur n'y peut rien.
 * @param {number} statut
 * @param {string | null | undefined} error
 * @returns {string | null}
 */
export function codeDepuisCorpus(statut, error) {
  if (statut === 404) return 'numero_absent';
  if (statut === 400) return 'numero_mal_forme';
  if (statut < 200 || statut >= 300) return 'corpus_indisponible';
  if (error) return 'corpus_indisponible';
  return null;
}

/**
 * Le résumé d'un dossier du corpus (entête de GET /dossier/{numero}) : de quoi reconnaître le logement.
 * Un champ absent vaut null, jamais undefined.
 * @param {Record<string, unknown> | null | undefined} dossier
 * @returns {{ etiquette: string | null, date: string | null, surface: number | null, type: string | null }}
 */
export function resumeDossier(dossier) {
  const d = dossier || {};
  const texte = (...cles) => {
    for (const c of cles) if (typeof d[c] === 'string' && d[c] !== '') return d[c];
    return null;
  };
  const nombre = (...cles) => {
    for (const c of cles) if (typeof d[c] === 'number' && Number.isFinite(d[c])) return d[c];
    return null;
  };
  return {
    etiquette: texte('classe_bilan_dpe', 'etiquette_dpe'),
    date: texte('date_etablissement_dpe'),
    surface: nombre('surface_habitable_logement'),
    type: texte('type_bien', 'type_batiment'),
  };
}
