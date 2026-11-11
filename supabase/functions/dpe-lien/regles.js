// Règles PURES de l'edge function dpe-lien (aucun import, aucun réseau) — testées par scripts/dpe-lien-edge.test.mjs.
// Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md

/** Les codes d'erreur que l'edge function rend au front (traduits par src/lib/dpeLien.js). */
export const CODES = Object.freeze([
  'module_ferme', 'droit_requis', 'action_inconnue', 'client_introuvable', 'adresse_incomplete',
  'client_sans_numero', 'numero_mal_forme', 'numero_absent', 'sans_rapport_complet', 'corpus_indisponible',
  'partenaire_indisponible', 'enregistrement_impossible',
  // refonte 2026-11-12
  'numero_protege', 'numero_ecarte', 'module_communication_inactif', 'no_from_email', 'client_sans_email',
  'template_missing', 'pdf_indisponible', 'resend_failed',
  // revue finale 2026-11-12
  'numero_desynchronise',
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

/**
 * Le rapport complet MonsieurDPE existe-t-il pour ce dossier ? Réponse de GET /dossier/{numero}.
 * MÊMES règles que la page du site (C:/Dev/DPE/site, `sansDetailArchive` et `estImmeubleDerive`) : aucun
 * composant archivé (la plupart des DPE de 2021-2022), ou étiquette dérivée de l'immeuble entier (27 % de la
 * base), et la page refuse avant même le mur. La porte partenaire applique la règle qui fait foi ; celle-ci
 * sert à ne pas PROPOSER le bouton.
 * @param {{ dossier?: Record<string, unknown> | null, composants?: unknown } | null | undefined} data
 * @returns {boolean}
 */
export function rapportCompletPossible(data) {
  if (!data || !Array.isArray(data.composants) || data.composants.length === 0) return false;
  const methode = data.dossier?.methode_application_dpe;
  return !(typeof methode === 'string' && methode.toLowerCase().startsWith('dpe appartement généré'));
}

const CHAMPS_CANDIDAT = ['identifiant_dpe', 'date_etablissement_dpe', 'etiquette_dpe', 'surface_habitable_logement', 'type_batiment', 'fiabilite_geocodage'];

/**
 * Un DPE candidat tel qu'il part vers le navigateur : les seuls champs que l'écran lit, pas la ligne brute du corpus.
 * @param {unknown} ligne
 * @returns {Record<string, unknown> | null}
 */
export function projeterCandidat(ligne) {
  if (!ligne || typeof ligne !== 'object') return null;
  return Object.fromEntries(CHAMPS_CANDIDAT.filter((c) => c in ligne).map((c) => [c, ligne[c]]));
}

// ============================================================================
// Rattachement automatique (refonte 2026-11-12, spec 2026-11-12-logement-monsieurdpe-fiche-client-design.md §5).
// Seuils PROVISOIRES : à remplacer par la mesure de scripts/dpe/mesure-rattachement-auto.mjs (plan, tâche 1).
// ============================================================================

/**
 * Interrupteur du rattachement AUTOMATIQUE. Faux tant que la mesure de la tâche 1 n'a pas fixé les seuils
 * (le géocodeur national répondait 504 le 2026-11-12, la mesure n'a pas pu tourner) : un DPE unique et sûr est
 * alors PROPOSÉ en un clic, jamais rattaché seul. Spec §10 : pas d'automatique avant la mesure.
 */
export const RATTACHEMENT_AUTO_ACTIF = false;

/** Score minimal du géocodage IGN de l'adresse du client (0 à 1). */
export const SCORE_GEOCODAGE_MIN = 0.8;
/** Types de résultat IGN acceptés : le numéro de la rue, jamais une rue ou une commune entière. */
export const TYPES_GEOCODAGE_ACCEPTES = Object.freeze(['housenumber']);
/** Fiabilité du rattachement BDNB d'un DPE à son bâtiment (`fiabilite_geocodage`). */
export const FIABILITES_BDNB_ACCEPTEES = Object.freeze(['très fiable', 'fiable']);

/**
 * Décide du rattachement à partir du géocodage de l'adresse du client, des DPE du bâtiment et, quand il n'y en a
 * qu'un, de son dossier. La machine ne choisit JAMAIS entre plusieurs candidats.
 * @param {{ geocodage: { score?: number, type?: string } | null, candidats: unknown[],
 *   dossierUnique: { dossier?: Record<string, unknown> | null } | null, ecartes: string[], autoActif?: boolean }} p
 * @returns {{ etat: 'rattache' | 'candidats' | 'aucun_dpe' | 'adresse_non_trouvee', numero?: string,
 *   candidats: Record<string, unknown>[] }}
 */
export function decisionRattachement({ geocodage, candidats, dossierUnique, ecartes, autoActif = RATTACHEMENT_AUTO_ACTIF }) {
  if (!geocodage) return { etat: 'adresse_non_trouvee', candidats: [] };
  const exclus = new Set(ecartes || []);
  const liste = (Array.isArray(candidats) ? candidats : [])
    .map(projeterCandidat)
    .filter((c) => c && numeroValide(c.identifiant_dpe) && !exclus.has(c.identifiant_dpe));
  if (liste.length === 0) return { etat: 'aucun_dpe', candidats: [] };
  if (liste.length > 1) return { etat: 'candidats', candidats: liste };

  const [seul] = liste;
  const methode = String(dossierUnique?.dossier?.methode_application_dpe || '').toLowerCase();
  const sur = autoActif === true
    && typeof geocodage.score === 'number' && geocodage.score >= SCORE_GEOCODAGE_MIN
    && TYPES_GEOCODAGE_ACCEPTES.includes(geocodage.type)
    && FIABILITES_BDNB_ACCEPTEES.includes(seul.fiabilite_geocodage)
    && Boolean(dossierUnique?.dossier)
    && !methode.startsWith('dpe appartement généré');
  return sur ? { etat: 'rattache', numero: seul.identifiant_dpe, candidats: liste } : { etat: 'candidats', candidats: liste };
}

/**
 * Le numéro de la fiche est-il celui de la ligne client_dpe ? Garde de `detacher`, `ouvrir` et `envoyer` : sans elle,
 * un numéro tapé et pas encore relu laissait l'écran agir sur l'ANCIEN (rapport envoyé pour un autre DPE que celui
 * annoncé, numéro tapé effacé). Avec `rapportRequis`, le rapport complet doit être connu VRAI (NULL refusé).
 * @param {{ numeroFiche?: string|null, ligne: { dpe_number?: string|null, rapport_complet?: boolean|null } | null,
 *   rapportRequis?: boolean }} p
 * @returns {string | null} un code de CODES, ou null si tout est cohérent
 */
export function controleNumero({ numeroFiche, ligne, rapportRequis = false }) {
  const fiche = (numeroFiche || '').trim().toUpperCase();
  if (!fiche) return 'client_sans_numero';
  if (fiche !== (ligne?.dpe_number || '').trim().toUpperCase()) return 'numero_desynchronise';
  if (rapportRequis && ligne?.rapport_complet !== true) return 'sans_rapport_complet';
  return null;
}
