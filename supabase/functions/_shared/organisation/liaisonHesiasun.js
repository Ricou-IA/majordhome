// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/organisation/liaisonHesiasun.js — ne pas éditer.
// src/lib/organisation/liaisonHesiasun.js
// ============================================================================
// Liaison Majord'home → HésiaSun : l'identité de l'entreprise est saisie une fois, ici, et envoyée à
// HésiaSun (`PUT /api/v1/organization`). Module PUR (seul import : ./identite.js), testé par
// scripts/organisation-liaison-hesiasun.test.mjs, copié pour Deno par `npm run sync:tournee-engine`
// (_shared/organisation/) : l'edge `hesiasun-identite` et l'écran appliquent les mêmes règles.
// Spec : docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md
// ============================================================================
import { CHAMPS_IDENTITE, VERSION_IDENTITE, formaterPourSaisie, identitePourEnvoi, validerEnvoi } from './identite.js';

/** Clé du coffre de l'organisation où est rangée la clé d'API HésiaSun. */
export const CLE_COFFRE = 'hesiasun:api_key';
/** Au-delà, le rejeu automatique cesse : l'erreur reste affichée, « Renvoyer » reste possible. */
export const DUREE_REJEU_MS = 24 * 60 * 60 * 1000;

/**
 * Codes rendus par l'edge `hesiasun-identite` ↔ messages de l'écran. Un code ajouté d'un côté s'ajoute de
 * l'autre (le test le vérifie).
 */
export const CODES_LIAISON = {
  non_configure: 'La liaison avec HésiaSun n’est pas encore ouverte sur cette plateforme.',
  non_reliee: 'Cette entreprise n’est pas reliée à HésiaSun.',
  cle_invalide: 'Collez une clé HésiaSun complète (elle commence par bk_live_).',
  cle_refusee: 'HésiaSun refuse cette clé : vérifiez qu’elle n’est pas révoquée et qu’elle porte la permission « Recevoir l’identité de l’entreprise ».',
  siret_different: 'Le SIRET de cette entreprise n’est pas celui de l’entreprise HésiaSun de cette clé.',
  tva_incoherente: 'Le n° de TVA ne correspond pas au SIRET : enregistrez l’onglet Identité pour le recalculer, puis renvoyez.',
  deja_reliee: 'L’entreprise HésiaSun de cette clé est déjà reliée à une autre entreprise.',
  liaison_rompue: 'La gestion de l’identité a été reprise dans HésiaSun : la liaison est rompue. Reliez à nouveau pour la rétablir.',
  version_inconnue: 'HésiaSun n’a pas encore les dernières règles d’identité : l’envoi reprendra après sa mise à jour.',
  identite_invalide: 'L’identité n’a pas pu être envoyée : un champ est mal formé.',
  hesiasun_injoignable: 'HésiaSun ne répond pas pour l’instant.',
  hesiasun_refus: 'HésiaSun a refusé l’envoi.',
  ecriture_refusee: 'L’état de la liaison n’a pas pu être enregistré.',
  logo_externe: 'Le logo affiché vient d’une adresse extérieure : téléversez-le ici pour qu’il parte aussi vers HésiaSun.',
  logo_trop_lourd: 'Le logo dépasse 2 Mo : HésiaSun ne l’a pas pris.',
  logo_format: 'HésiaSun n’accepte le logo qu’en PNG, JPG ou WebP.',
  logo_illisible: 'Le logo n’a pas pu être relu dans Majord’home.',
  action_inconnue: 'Demande non reconnue.',
  service_injoignable: 'Le service de liaison ne répond pas.',
};

/**
 * Message d'un code de l'edge, avec le détail des champs refusés quand il y en a.
 * @param {string|null|undefined} code
 * @param {Record<string, string>} [champs]
 * @returns {string}
 */
export function messageLiaison(code, champs) {
  const base = CODES_LIAISON[code] || 'La liaison avec HésiaSun a rencontré une erreur.';
  const details = champs && Object.keys(champs).length
    ? ` (${Object.entries(champs).map(([cle, m]) => `${libelle(cle)} : ${m}`).join(' ; ')})`
    : '';
  return base + details;
}

const libelle = (cle) => CHAMPS_IDENTITE.find((c) => c.cle === cle)?.libelle || cle;

/**
 * @typedef {Object} EtatLiaison
 * @property {string} liaison_id
 * @property {string} relie_le
 * @property {string} entreprise          nom de l'entreprise côté HésiaSun
 * @property {boolean} ouverte            le premier envoi a été accepté (Majord'home est la source)
 * @property {string|null} dernier_envoi_le
 * @property {string|null} erreur         code du dernier échec
 * @property {Record<string,string>|null} erreur_champs
 * @property {boolean} en_attente         un envoi a échoué et doit être rejoué
 * @property {string|null} en_attente_depuis
 * @property {string|null} logo_envoye     adresse du logo tel qu'il a été envoyé (null : aucun logo chez HésiaSun par nous)
 * @property {string|null} logo_erreur     code du dernier échec d'envoi du logo
 */

/**
 * État de la liaison lu dans les réglages de l'organisation (`settings.hesiasun`), ou null.
 * `rompue_le` seul (liaison défaite depuis HésiaSun) n'est pas une liaison : voir `ruptureConnue`.
 * @param {Record<string, unknown>|null|undefined} settings
 * @returns {EtatLiaison|null}
 */
export function lireEtatLiaison(settings) {
  const e = settings?.hesiasun;
  if (!e || typeof e !== 'object' || typeof e.liaison_id !== 'string' || !e.liaison_id) return null;
  return {
    liaison_id: e.liaison_id,
    relie_le: typeof e.relie_le === 'string' ? e.relie_le : '',
    entreprise: typeof e.entreprise === 'string' ? e.entreprise : '',
    ouverte: e.ouverte === true,
    dernier_envoi_le: typeof e.dernier_envoi_le === 'string' ? e.dernier_envoi_le : null,
    erreur: typeof e.erreur === 'string' ? e.erreur : null,
    erreur_champs: e.erreur_champs && typeof e.erreur_champs === 'object' ? e.erreur_champs : null,
    en_attente: e.en_attente === true,
    en_attente_depuis: typeof e.en_attente_depuis === 'string' ? e.en_attente_depuis : null,
    logo_envoye: typeof e.logo_envoye === 'string' && e.logo_envoye ? e.logo_envoye : null,
    logo_erreur: typeof e.logo_erreur === 'string' ? e.logo_erreur : null,
  };
}

/**
 * Date à laquelle HésiaSun a repris la main, quand la liaison a été rompue de son côté.
 * @param {Record<string, unknown>|null|undefined} settings
 * @returns {string|null}
 */
export function ruptureConnue(settings) {
  const e = settings?.hesiasun;
  return e && typeof e === 'object' && !e.liaison_id && typeof e.rompue_le === 'string' ? e.rompue_le : null;
}

/**
 * Corps de `PUT /api/v1/organization`, ou le refus local (identité mal formée : rien ne part).
 * @param {Record<string, unknown>} settings  réglages de l'organisation, relus en base
 * @param {{ liaisonId: string, ouverture: boolean }} liaison
 * @returns {{ ok: true, corps: object } | { ok: false, code: 'identite_invalide', champs: Record<string,string> }}
 */
export function corpsEnvoi(settings, { liaisonId, ouverture }) {
  const { version, identite } = identitePourEnvoi(settings);
  const champs = validerEnvoi(identite);
  if (Object.keys(champs).length) return { ok: false, code: 'identite_invalide', champs };
  return { ok: true, corps: { version, source: 'majordhome', liaison_id: liaisonId, ...(ouverture ? { ouverture: true } : {}), identite } };
}

/**
 * Lecture d'une réponse de l'API HésiaSun en code. `statut` 0 = pas de réponse (réseau, délai).
 * @param {number} statut
 * @param {unknown} json
 * @returns {{ ok: true, data: any } | { ok: false, code: string, champs?: Record<string,string> }}
 */
export function lireReponseHesiasun(statut, json) {
  const corps = json && typeof json === 'object' ? json : null;
  if (statut >= 200 && statut < 300 && corps && corps.data && typeof corps.data === 'object') return { ok: true, data: corps.data };
  if (statut === 401 || statut === 403) return { ok: false, code: 'cle_refusee' };
  if (statut === 409) {
    const raison = corps?.error?.details?.raison;
    return { ok: false, code: typeof raison === 'string' && raison in CODES_LIAISON ? raison : 'hesiasun_refus' };
  }
  if (statut === 422) {
    const champs = {};
    for (const d of Array.isArray(corps?.error?.details) ? corps.error.details : []) {
      if (d && typeof d.path === 'string' && typeof d.message === 'string') champs[d.path] = d.message;
    }
    return { ok: false, code: 'identite_invalide', champs };
  }
  // 0, 5xx, 429, page d'erreur d'hébergeur, JSON inattendu : panne passagère, à rejouer.
  return { ok: false, code: statut === 0 || statut >= 500 || statut === 429 || statut === 404 ? 'hesiasun_injoignable' : 'hesiasun_refus' };
}

/** Un échec passager se rejoue ; un refus motivé attend un geste (corriger, relier, mettre à jour). */
const A_REJOUER = new Set(['hesiasun_injoignable', 'version_inconnue']);

/**
 * État de la liaison après un envoi. Un refus `liaison_rompue` défait la liaison (voir `etatRompu`).
 * @param {EtatLiaison} etat
 * @param {{ ok: true } | { ok: false, code: string, champs?: Record<string,string> }} resultat
 * @param {string} maintenant  date ISO
 * @returns {EtatLiaison}
 */
export function etatApresEnvoi(etat, resultat, maintenant) {
  if (resultat.ok) {
    return { ...etat, ouverte: true, dernier_envoi_le: maintenant, erreur: null, erreur_champs: null, en_attente: false, en_attente_depuis: null };
  }
  const rejouer = A_REJOUER.has(resultat.code);
  return {
    ...etat,
    erreur: resultat.code,
    erreur_champs: resultat.champs && Object.keys(resultat.champs).length ? resultat.champs : null,
    en_attente: rejouer,
    en_attente_depuis: rejouer ? (etat.en_attente_depuis || maintenant) : null,
  };
}

/**
 * Ce qui reste dans `settings.hesiasun` quand HésiaSun a repris la main : plus de liaison, la date.
 * @param {string} maintenant
 * @returns {{ rompue_le: string }}
 */
export function etatRompu(maintenant) {
  return { rompue_le: maintenant };
}

/**
 * Le rejeu automatique a-t-il encore lieu ? Non au-delà de 24 h d'échecs.
 * @param {EtatLiaison|null} etat
 * @param {number} maintenantMs
 * @returns {boolean}
 */
export function aRejouer(etat, maintenantMs) {
  if (!etat || !etat.ouverte || !etat.en_attente) return false;
  const depuis = Date.parse(etat.en_attente_depuis || '');
  return Number.isNaN(depuis) || maintenantMs - depuis < DUREE_REJEU_MS;
}

/**
 * Comparaison champ par champ des deux identités (forme d'envoi), pour le choix au moment de relier.
 * @param {Record<string, unknown>} settings        réglages Majord'home
 * @param {Record<string, string>} identiteHesiasun identité rendue par HésiaSun
 * @returns {{ lignes: { cle: string, libelle: string, ici: string, labas: string, different: boolean }[], iciVide: boolean, labasVide: boolean, identiques: boolean }}
 */
export function comparerIdentites(settings, identiteHesiasun) {
  const ici = identitePourEnvoi(settings).identite;
  const labas = identitePourEnvoi(identiteHesiasun || {}).identite;
  const lignes = CHAMPS_IDENTITE.map((c) => ({
    cle: c.cle,
    libelle: c.libelle,
    ici: formaterPourSaisie(c.cle, ici[c.cle]),
    labas: formaterPourSaisie(c.cle, labas[c.cle]),
    different: ici[c.cle] !== labas[c.cle],
  }));
  return {
    lignes,
    iciVide: Object.values(ici).every((v) => !v),
    labasVide: Object.values(labas).every((v) => !v),
    identiques: lignes.every((l) => !l.different),
  };
}

/**
 * Identité reçue de HésiaSun, dans la forme que Majord'home enregistre (SIRET, TVA, téléphone par groupes).
 * @param {Record<string, string>} identiteHesiasun
 * @returns {Record<string, string>}
 */
export function identitePourReglages(identiteHesiasun) {
  const recu = identitePourEnvoi(identiteHesiasun || {}).identite;
  return Object.fromEntries(CHAMPS_IDENTITE.map((c) => [c.cle, formaterPourSaisie(c.cle, recu[c.cle])]));
}

// ─── Logo ─────────────────────────────────────────────────────────────────

/** Compartiment public du logo de l'entreprise (migration 20261121_8). */
export const COMPARTIMENT_LOGO = 'org-branding';
export const LOGO_MAX_OCTETS = 2 * 1024 * 1024;
/** Formats acceptés (pas de SVG : il peut porter du script). */
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Chemin d'un nouveau logo dans le compartiment : un nom par téléversement, pour que l'adresse change
 * (les e-mails et les navigateurs gardent l'ancienne image en mémoire).
 * @param {string} orgId
 * @param {string} ext          'png' | 'jpg' | 'webp'
 * @param {number} horodatage   Date.now()
 * @returns {string}
 */
export function cheminLogo(orgId, ext, horodatage) {
  return `${orgId}/logo-${horodatage}.${ext}`;
}

/**
 * Chemin, dans le compartiment, d'un logo hébergé par Majord'home pour CETTE organisation ; null pour toute
 * autre adresse (site de l'entreprise, autre organisation, autre compartiment). C'est la seule adresse que
 * l'edge accepte de relire : elle ne va jamais chercher une image à une adresse arbitraire.
 * @param {unknown} logoUrl
 * @param {{ baseStockage: string, orgId: string }} ctx  baseStockage = adresse du projet Supabase
 * @returns {string|null}
 */
export function logoHeberge(logoUrl, { baseStockage, orgId }) {
  if (typeof logoUrl !== 'string' || !baseStockage || !orgId) return null;
  const prefixe = `${String(baseStockage).replace(/\/+$/, '')}/storage/v1/object/public/${COMPARTIMENT_LOGO}/`;
  if (!logoUrl.startsWith(prefixe)) return null;
  const chemin = logoUrl.slice(prefixe.length);
  return new RegExp(`^${orgId}/logo-\\d{1,16}\\.(png|jpg|webp)$`).test(chemin) ? chemin : null;
}

/**
 * Que faire du logo après un envoi d'identité réussi ?
 * - `rien`     : déjà envoyé tel quel, ou aucun logo de part et d'autre ;
 * - `envoyer`  : logo hébergé ici, différent du dernier envoyé ;
 * - `retirer`  : plus de logo ici, alors qu'on en avait envoyé un ;
 * - `externe`  : le logo vient d'une adresse extérieure, on ne l'envoie pas (on le dit).
 * @param {Record<string, unknown>} settings
 * @param {EtatLiaison} etat
 * @param {{ baseStockage: string, orgId: string }} ctx
 * @returns {{ geste: 'rien'|'envoyer'|'retirer'|'externe', chemin?: string, url?: string }}
 */
export function gesteLogo(settings, etat, ctx) {
  const url = typeof settings?.logo_url === 'string' ? settings.logo_url.trim() : '';
  if (!url) return { geste: etat?.logo_envoye ? 'retirer' : 'rien' };
  const chemin = logoHeberge(url, ctx);
  if (!chemin) return { geste: 'externe' };
  return url === etat?.logo_envoye ? { geste: 'rien' } : { geste: 'envoyer', chemin, url };
}

/**
 * Code d'un refus de logo par HésiaSun (422 avec `details.raison`), sinon le code ordinaire de la réponse.
 * @param {number} statut
 * @param {unknown} json
 * @returns {string|null}  null si l'envoi est accepté
 */
export function codeReponseLogo(statut, json) {
  const lu = lireReponseHesiasun(statut, json);
  if (lu.ok) return null;
  const raison = json && typeof json === 'object' ? json.error?.details?.raison : null;
  if (statut === 422) return raison === 'logo_trop_lourd' || raison === 'logo_format' ? raison : 'logo_format';
  return lu.code;
}

export { VERSION_IDENTITE };
