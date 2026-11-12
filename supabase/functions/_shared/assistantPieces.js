// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/assistantPieces.js — ne pas éditer.
// Assistant « Trouver une pièce » — règles PURES (aucun import : ni React, ni Supabase, ni alias), testées par
// scripts/assistant-pieces.test.mjs. Utilisé par l'écran ET copié tel quel pour l'edge function
// (npm run sync:tournee-engine → supabase/functions/_shared/assistantPieces.js ; ne jamais éditer la copie).
// Spec : docs/superpowers/specs/2026-11-11-assistant-pieces-sav-hermes-design.md
//
// Règle qui tient tout le module : la consigne envoyée à l'agent ne porte QUE l'appareil et la demande du
// technicien — jamais une donnée du client. `controlerDemande` refuse une demande qui en contiendrait une.
//
// Ce que ce contrôle couvre : chaque mot du nom de famille (3 lettres et plus, hors civilités et liaisons), la
// société en entier, chaque numéro de téléphone rangé sur la fiche (sur ses 9 derniers chiffres) et l'e-mail.
// Ce qu'il ne couvre PAS : l'adresse et la ville, le nom d'une autre personne, le prénom seul (il n'identifie
// personne et « pierre », « rose », « olivier » sont des mots du métier), ni les champs libres de l'appareil.
// C'est une garde contre l'erreur de saisie, pas une anonymisation : la consigne, elle, ne lit jamais le client.

/** Longueur maximale de la demande du technicien, en caractères. */
export const DEMANDE_MAX = 500;

/**
 * Les codes d'erreur que l'edge function renvoie, ou qu'elle range dans la colonne `erreur` d'une recherche.
 * `recherche_echouee` et `delai_depasse` ne sont jamais renvoyés par une action : ils sont rangés dans la colonne
 * `erreur` d'une ligne en échec, et l'écran les traduit par le même `messageErreurAssistant`.
 */
export const CODES = Object.freeze([
  'module_ferme', 'droit_requis', 'equipement_introuvable', 'appareil_inconnu',
  'demande_vide', 'demande_trop_longue', 'donnee_client', 'quota_atteint', 'assistant_indisponible',
  'recherche_introuvable', 'recherche_echouee', 'delai_depasse', 'action_inconnue',
]);

/** Les états d'une recherche. */
export const STATUTS = Object.freeze(['en_cours', 'terminee', 'echec']);

/**
 * @typedef {Object} Appareil
 * @property {string} [type] Type d'appareil (« Poêle à granulés »).
 * @property {string} [marque] Marque ; « À RENSEIGNER » ou vide = inconnue.
 * @property {string} [modele] Modèle.
 * @property {string} [numero_serie] Numéro de série.
 * @property {{ marque?: string|null, reference?: string|null, nom?: string|null } | null} [fiche] Fiche fabricant rattachée.
 * @property {boolean} [a_plaque] Une photo de la plaque signalétique existe.
 */

/**
 * @typedef {Object} ClientProtege
 * @property {string|null} [nom]
 * @property {string|null} [prenom] Accepté mais non consulté : un prénom seul n'identifie personne.
 * @property {string|null} [societe]
 * @property {string|null} [telephone]
 * @property {string|null} [telephone2]
 * @property {string|null} [email]
 */

/**
 * @typedef {Object} Piece
 * @property {string} reference
 * @property {string} designation
 * @property {'origine'|'compatible'} type
 * @property {string} caracteristiques
 */

/**
 * @typedef {Object} Offre
 * @property {string} vendeur
 * @property {string} reference
 * @property {number|null} prix_ttc Null quand le prix n'a pas été lu.
 * @property {string} disponibilite
 * @property {string} url
 * @property {boolean} verifie Vrai seulement pour un prix lu sur une page réellement ouverte.
 */

/**
 * @typedef {Object} Reponse
 * @property {string} appareil Ce que l'agent déduit de l'appareil.
 * @property {string[]} pistes
 * @property {Piece[]} pieces
 * @property {Offre[]} offres
 * @property {string[]} verifications Ce que le technicien contrôle avant de commander.
 */

const MESSAGES = {
  module_ferme: "L'assistant « Trouver une pièce » n'est pas activé pour votre organisation.",
  droit_requis: "Vous n'avez pas le droit de lancer une recherche de pièce.",
  equipement_introuvable: "Cet équipement n'a pas été retrouvé dans votre organisation.",
  appareil_inconnu: "On ne sait rien de cet appareil : renseignez au moins la marque, le modèle, le numéro de série ou la plaque avant de chercher.",
  demande_vide: 'Décrivez la pièce recherchée avant de lancer la recherche.',
  demande_trop_longue: 'La demande est trop longue : résumez la pièce recherchée en quelques mots.',
  donnee_client: "La demande contient le nom, le téléphone ou l'e-mail du client. Un nom de famille qui est aussi un mot courant (« Petit », « Blanc ») suffit à la bloquer : reformulez sans ce mot.",
  quota_atteint: "La limite de recherches de la journée est atteinte. Réessayez demain.",
  assistant_indisponible: "L'assistant ne répond pas pour le moment. Réessayez dans quelques minutes.",
  recherche_introuvable: "Cette recherche n'a pas été retrouvée.",
  recherche_echouee: "La recherche n'a pas abouti. Relancez-la, et prévenez-nous si cela se reproduit.",
  delai_depasse: "La recherche a pris trop de temps et a été arrêtée. Relancez-la avec une demande plus précise.",
  action_inconnue: "Action non reconnue par l'assistant.",
};
const MESSAGE_GENERIQUE = "L'assistant a rencontré une erreur. Réessayez dans quelques minutes.";

/**
 * Le message français d'un code (ou d'une erreur qui le porte en `message`). Un code inconnu, ou
 * `service_injoignable`, donne un message générique.
 * @param {unknown} code
 * @returns {string}
 */
export function messageErreurAssistant(code) {
  const cle = typeof code === 'string' ? code
    : (code && typeof (/** @type {{ message?: unknown }} */ (code)).message === 'string')
      ? /** @type {{ message: string }} */ (code).message : '';
  return Object.prototype.hasOwnProperty.call(MESSAGES, cle)
    ? MESSAGES[/** @type {keyof typeof MESSAGES} */ (cle)]
    : MESSAGE_GENERIQUE;
}

/** Minuscules, sans accents. @param {unknown} v @returns {string} */
function normaliser(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** @param {string} s @returns {string} */
function echapper(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ce nom apparaît-il comme mot (ou suite de mots) entier dans le texte ? Les deux sont déjà normalisés. */
function contientMotEntier(texteNorm, nomNorm) {
  return new RegExp(`(^|[^a-z0-9])${echapper(nomNorm)}(?=$|[^a-z0-9])`).test(texteNorm);
}

/** Civilités et liaisons d'un nom de famille, qui ne désignent personne (comparées sans casse ni accents). */
const MOTS_IGNORES = new Set([
  'm', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle', 'epoux', 'epouse', 'veuve', 'vve',
  'et', 'ou', 'de', 'du', 'des', 'la', 'le', 'les', 'aux', 'chez', 'nee',
]);

/**
 * Les mots d'un nom de famille qui font refuser : découpé sur tout ce qui n'est ni lettre ni chiffre, après
 * normalisation ; mots de 3 lettres et plus, hors `MOTS_IGNORES`. @param {unknown} nom @returns {string[]}
 */
function motsDuNom(nom) {
  return normaliser(nom).split(/[^a-z0-9]+/)
    .filter((m) => m.replace(/[^a-z]/g, '').length >= 3 && !MOTS_IGNORES.has(m));
}

/**
 * Les numéros d'un champ téléphone, qui peut en porter plusieurs (« 05 63 11 22 33 / 06 12 34 56 78 ») : chaque
 * suite de chiffres, séparateurs internes (espace, point, tiret, parenthèses) et `+` retirés, d'au moins 9 chiffres,
 * réduite à ses 9 derniers. @param {unknown} champ @returns {string[]}
 */
function numerosDuChamp(champ) {
  return (String(champ ?? '').match(/\+?\d[\d\s().+-]*\d/g) || [])
    .map((s) => s.replace(/\D/g, ''))
    .filter((c) => c.length >= 9)
    .map((c) => c.slice(-9));
}

/**
 * La demande est-elle recevable ? Refuse une demande vide, trop longue, ou qui contient une donnée du client :
 * un mot du nom de famille (3 lettres et plus, hors civilités et liaisons) en mot entier ; la société en entier
 * (3 lettres et plus), en mot(s) entier(s) ; un des numéros de téléphone de la fiche, sur ses 9 derniers chiffres ;
 * l'e-mail. Le prénom n'est pas consulté. Ne couvre ni l'adresse, ni la ville, ni une autre personne.
 * @param {unknown} texte
 * @param {ClientProtege | null | undefined} client
 * @returns {null | 'demande_vide' | 'demande_trop_longue' | 'donnee_client'}
 */
export function controlerDemande(texte, client) {
  const brut = typeof texte === 'string' ? texte.trim() : '';
  if (!brut) return 'demande_vide';
  if (brut.length > DEMANDE_MAX) return 'demande_trop_longue';
  if (!client || typeof client !== 'object') return null;

  const norm = normaliser(brut);

  if (motsDuNom(client.nom).some((mot) => contientMotEntier(norm, mot))) return 'donnee_client';

  const societe = normaliser(client.societe).trim();
  if (societe.replace(/[^a-z]/g, '').length >= 3 && contientMotEntier(norm, societe)) return 'donnee_client';

  // Les suites de chiffres séparées par des espaces, points, tirets ou parenthèses valent un numéro.
  const suites = brut.match(/\+?\d[\d\s().-]{6,}\d/g) || [];
  const chiffresDemande = suites.map((s) => s.replace(/\D/g, ''));
  for (const fin of [...numerosDuChamp(client.telephone), ...numerosDuChamp(client.telephone2)]) {
    if (chiffresDemande.some((c) => c.includes(fin))) return 'donnee_client';
  }

  const email = normaliser(client.email).trim();
  if (email.includes('@') && norm.includes(email)) return 'donnee_client';

  return null;
}

/**
 * Le chemin de la photo de plaque peut-il être signé ? Seulement s'il est rangé sous l'org validée et nomme
 * l'équipement validé : `<orgId>/…/equipements/<equipmentId>-plaque.jpg`, sans segment `..`. Les deux
 * identifiants sont ceux déjà contrôlés par l'appelant ; vides, rien n'est signé.
 * @param {unknown} chemin
 * @param {unknown} orgId
 * @param {unknown} equipmentId
 * @returns {boolean}
 */
export function cheminPlaqueValide(chemin, orgId, equipmentId) {
  if (typeof chemin !== 'string' || typeof orgId !== 'string' || typeof equipmentId !== 'string') return false;
  if (!orgId || !equipmentId) return false;
  if (chemin.split('/').some((segment) => segment === '..' || segment === '.')) return false;
  return chemin.startsWith(`${orgId}/`) && chemin.endsWith(`/equipements/${equipmentId}-plaque.jpg`);
}

/** Une valeur texte renseignée ? @param {unknown} v @returns {boolean} */
function renseigne(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Sait-on quelque chose de l'appareil ? Vrai si une marque (autre que vide ou « À RENSEIGNER »), un modèle,
 * un numéro de série, une fiche fabricant ou une plaque est connu.
 * @param {Appareil | null | undefined} appareil
 * @returns {boolean}
 */
export function appareilConnu(appareil) {
  if (!appareil || typeof appareil !== 'object') return false;
  const marque = normaliser(appareil.marque).trim();
  const marqueConnue = marque !== '' && marque !== 'a renseigner';
  return marqueConnue || renseigne(appareil.modele) || renseigne(appareil.numero_serie)
    || Boolean(appareil.fiche) || appareil.a_plaque === true;
}

/** @param {unknown} v @returns {string} */
function ouNonRenseigne(v) {
  return renseigne(v) ? /** @type {string} */ (v).trim() : 'non renseigné';
}

/**
 * Construit la consigne envoyée à l'agent. Elle ne porte que l'appareil et la demande : aucune donnée du client.
 * @param {{ appareil: Appareil, demande: string, plaqueUrl?: string | null }} p
 * @returns {string}
 */
export function construireConsigne({ appareil, demande, plaqueUrl = null }) {
  const a = appareil || {};
  const fiche = a.fiche || null;
  const lignes = [
    "Tu es l'assistant SAV d'un artisan chauffagiste français (poêles, pompes à chaleur, climatisation). Un technicien cherche une pièce détachée.",
    '',
    `Appareil : ${ouNonRenseigne(a.type)}.`,
    `Marque : ${ouNonRenseigne(a.marque)}.`,
    `Modèle : ${ouNonRenseigne(a.modele)}.`,
    `Numéro de série : ${ouNonRenseigne(a.numero_serie)}.`,
  ];
  if (fiche && (renseigne(fiche.marque) || renseigne(fiche.reference) || renseigne(fiche.nom))) {
    lignes.push(`Fiche fabricant rattachée : marque ${ouNonRenseigne(fiche.marque)}, référence ${ouNonRenseigne(fiche.reference)}, nom ${ouNonRenseigne(fiche.nom)}.`);
  }
  if (plaqueUrl) lignes.push(`Photo de la plaque signalétique : ${plaqueUrl}`);
  lignes.push(
    `Demande : ${String(demande ?? '').trim()}`,
    '',
    'Ton travail :',
    "1. Dis ce qu'on peut déduire sur le fabricant et le modèle (le numéro de série aide-t-il ?).",
    '2. Identifie la ou les pièces compatibles : référence, dimensions, caractéristiques utiles.',
    '3. Trouve des sites marchands français, ou livrant en France, qui la vendent : prix TTC, disponibilité, lien direct vers la fiche produit.',
    "4. Dis ce que le technicien doit vérifier sur l'appareil avant de commander.",
    '',
    "Règles : ne visite ni tereva.fr ni le site Domos. N'invente aucune référence ni aucun prix : un prix doit venir d'une page que tu as réellement ouverte, sinon écris « non vérifié ». Réponds en français, de façon courte, avec un tableau des offres.",
    '',
    'Termine ta réponse par un unique bloc ```json de cette forme, sans rien après :',
    '{',
    '  "appareil": "ce que tu déduis du fabricant et du modèle (texte)",',
    '  "pistes": ["autres pistes ou hypothèses (liste de textes, éventuellement vide)"],',
    '  "pieces": [{ "reference": "...", "designation": "...", "type": "origine ou compatible", "caracteristiques": "..." }],',
    '  "offres": [{ "vendeur": "...", "reference": "...", "prix_ttc": 30.0, "disponibilite": "...", "url": "https://...", "verifie": true }],',
    '  "verifications": ["ce que le technicien contrôle avant de commander (liste de textes)"]',
    '}',
    '"prix_ttc" est un nombre en euros, ou null si le prix est inconnu. "verifie" vaut true uniquement pour un prix lu sur une page que tu as réellement ouverte, sinon false.',
  );
  return lignes.join('\n');
}

/** @param {unknown} v @returns {boolean} */
function listeDeTextes(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** @param {unknown} v @returns {boolean} */
function listeDObjets(v) {
  return Array.isArray(v) && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
}

/**
 * Lit la réponse de l'agent : prend le DERNIER bloc ```json, exige les cinq clés aux bons types, sinon
 * `structure: null` (l'écran affiche alors le texte brut). Ne jette jamais, quelle que soit l'entrée.
 * @param {unknown} texteBrut
 * @returns {{ structure: Reponse | null, texte: string }}
 */
export function lireReponse(texteBrut) {
  if (typeof texteBrut !== 'string') return { structure: null, texte: '' };
  const blocs = [...texteBrut.matchAll(/```json[^\S\n]*\r?\n([\s\S]*?)```/gi)];
  if (blocs.length === 0) return { structure: null, texte: texteBrut };
  try {
    const o = JSON.parse(blocs[blocs.length - 1][1]);
    const valide = o !== null && typeof o === 'object' && !Array.isArray(o)
      && typeof o.appareil === 'string'
      && listeDeTextes(o.pistes)
      && listeDObjets(o.pieces)
      && listeDObjets(o.offres)
      && listeDeTextes(o.verifications);
    return { structure: valide ? /** @type {Reponse} */ (o) : null, texte: texteBrut };
  } catch {
    return { structure: null, texte: texteBrut };
  }
}

/** Âge, en minutes, au-delà duquel une recherche encore en route est close en `delai_depasse`. */
export const DUREE_MAX_RECHERCHE_MIN = 15;

const RUN_ECHOUE = new Set(['failed', 'cancelled', 'interrupted']);

/**
 * L'issue d'une recherche d'après l'état de son run chez Hermes et l'âge de la ligne. `completed` l'emporte
 * toujours ; `failed` / `cancelled` / `interrupted` sont un échec de la recherche ; tout autre état (`queued`,
 * `started`, `running`, `stopping`, inconnu, ou absent quand Hermes n'a pas répondu) reste en cours jusqu'à
 * `DUREE_MAX_RECHERCHE_MIN`. Un âge illisible ferme la recherche plutôt que de la laisser tourner.
 * @param {unknown} etatRun
 * @param {number} ageMinutes
 * @returns {'en_cours' | 'terminee' | 'echec_recherche' | 'echec_delai'}
 */
export function verdictRun(etatRun, ageMinutes) {
  if (etatRun === 'completed') return 'terminee';
  if (typeof etatRun === 'string' && RUN_ECHOUE.has(etatRun)) return 'echec_recherche';
  return Number.isFinite(ageMinutes) && ageMinutes < DUREE_MAX_RECHERCHE_MIN ? 'en_cours' : 'echec_delai';
}

/** Le corps JSON d'une réponse s'il est un objet, sinon null. Ne jette jamais. @param {unknown} texte */
function objetJson(texte) {
  if (typeof texte !== 'string' || !texte.trim()) return null;
  try {
    const o = JSON.parse(texte);
    return o !== null && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/**
 * Lit la réponse d'Hermes au lancement d'un run (POST /v1/runs). `statut` null = réseau coupé ou délai dépassé ;
 * `texte` null = corps illisible. Seul un 2xx portant un `run_id` non vide donne un run.
 * @param {number | null} statut
 * @param {string | null} texte
 * @returns {{ runId: string, motif: null } | { runId: null, motif: 'injoignable' | 'occupe' | 'refuse' | 'illisible' | 'sans_run_id' }}
 */
export function lireReponseLancement(statut, texte) {
  if (typeof statut !== 'number') return { runId: null, motif: 'injoignable' };
  if (statut === 429) return { runId: null, motif: 'occupe' };
  if (statut < 200 || statut > 299) return { runId: null, motif: 'refuse' };
  const o = objetJson(texte);
  if (!o) return { runId: null, motif: 'illisible' };
  const runId = typeof o.run_id === 'string' ? o.run_id.trim() : '';
  return runId ? { runId, motif: null } : { runId: null, motif: 'sans_run_id' };
}

/**
 * Lit la réponse d'Hermes à la lecture d'un run (GET /v1/runs/{id}). Un 404 dont le corps est un objet JSON = run
 * inconnu (le relais répond toujours en JSON) ; un 404 au corps vide, non JSON ou non objet vient d'ailleurs (reverse
 * proxy) et vaut panne passagère : il ne doit pas clore une recherche vivante. Un 2xx dont le corps est un objet
 * JSON = run lu ; tout le reste (réseau, délai, autre statut, corps illisible) = panne passagère.
 * @param {number | null} statut
 * @param {string | null} texte
 * @returns {{ issue: 'inconnu' } | { issue: 'passager' } | { issue: 'lu', etat: unknown, texte: string | null, usage: object | null }}
 */
export function lireReponseSuivi(statut, texte) {
  if (statut === 404) return objetJson(texte) ? { issue: 'inconnu' } : { issue: 'passager' };
  if (typeof statut !== 'number' || statut < 200 || statut > 299) return { issue: 'passager' };
  const o = objetJson(texte);
  if (!o) return { issue: 'passager' };
  return {
    issue: 'lu',
    etat: o.status,
    texte: typeof o.output === 'string' ? o.output : null,
    usage: o.usage !== null && typeof o.usage === 'object' && !Array.isArray(o.usage) ? o.usage : null,
  };
}

/**
 * Un lien sûr à afficher : seulement `https:`, avec son domaine (sans `www.`). Tout le reste donne null.
 * @param {unknown} url
 * @returns {{ href: string, domaine: string } | null}
 */
export function lienSur(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' || !u.hostname) return null;
    return { href: u.href, domaine: u.hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}
