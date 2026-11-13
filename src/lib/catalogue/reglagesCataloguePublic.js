// src/lib/catalogue/reglagesCataloguePublic.js
// Réglages d'un catalogue de pièces PUBLIC sur la fiche du fournisseur — module PUR, testé
// (scripts/catalogue/reglages-catalogue-public.test.mjs). Trois besoins des écrans :
//   - fusionner `connector_config` à l'enregistrement SANS perdre une clé (celles qu'on ne connaît pas comprises) ;
//   - dire où en est l'accord du marchand (et pourquoi le relevé est bloqué) ;
//   - mettre en forme le compte rendu du dernier relevé de pièces (`catalog_sync_result.compte` / `.rayons`).
// La règle « accord valable » reste dans cataloguePieces.js (lue aussi par l'edge) : jamais recopiée ici.
import { accordValide } from './cataloguePieces.js';
import { remisePiecesValide } from './piecesDetachees.js';

/** Phrase affichée à côté d'un relevé désactivé faute d'accord. */
export const RAISON_ACCORD_MANQUANT = "Renseignez le contact et la date de l'accord du fournisseur pour activer le relevé.";

/**
 * @param {unknown} v
 * @returns {Record<string, any>|null}
 */
function objet(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : null;
}

/**
 * `connector_config` à enregistrer : l'existant COMPLET, puis uniquement les changements demandés.
 * @param {unknown} existant `connector_config` actuel (toute clé inconnue est conservée)
 * @param {{ boutique?: object, public?: boolean, cataloguePieces?: boolean, accord?: { contact?: string, date?: string }, remisePieces?: string|number|null }} [changements]
 * @returns {Record<string, any>}
 */
export function connectorConfigFusionne(existant, changements = {}) {
  const out = { ...(objet(existant) || {}) };
  if (changements.boutique) Object.assign(out, changements.boutique);
  if (changements.public !== undefined) {
    out.public = changements.public === true;
    if (!out.public) out.catalogue_pieces = false; // sans boutique publique, le chemin « pièces » n'existe pas
  }
  if (changements.cataloguePieces !== undefined) {
    out.catalogue_pieces = out.public === true && changements.cataloguePieces === true;
  }
  if (changements.accord) {
    const contact = String(changements.accord.contact ?? '').trim();
    const date = String(changements.accord.date ?? '').trim();
    if (contact || date) out.accord = { contact, date };
    else delete out.accord;
  }
  const remise = remisePiecesValide(changements.remisePieces);
  if (remise != null) {
    const pieces = objet(out.pieces) || {};
    out.pieces = { ...pieces, remise_pct: remise };
  }
  return out;
}

/**
 * État de l'accord saisi.
 * @param {{ contact?: string, date?: string }|null|undefined} accord
 * @param {string} [aujourdhui] AAAA-MM-JJ (paramètre pour des tests déterministes)
 * @returns {'incomplet'|'invalide'|'futur'|'ok'}
 */
export function etatAccord(accord, aujourdhui) {
  const contact = String(accord?.contact ?? '').trim();
  const date = String(accord?.date ?? '').trim();
  if (!contact || !date) return 'incomplet';
  // La date est « réelle » si elle passe la règle commune en étant sa propre date du jour.
  if (!accordValide({ accord: { contact, date } }, date)) return 'invalide';
  return accordValide({ accord: { contact, date } }, aujourdhui) ? 'ok' : 'futur';
}

/**
 * Raison écrite d'un relevé désactivé : seulement pour une boutique publique dont l'accord n'est pas valable.
 * @param {unknown} connectorConfig configuration ENREGISTRÉE (celle que lira l'edge)
 * @param {string} [aujourdhui]
 * @returns {string|null}
 */
export function raisonRelevePublicBloque(connectorConfig, aujourdhui) {
  const c = objet(connectorConfig);
  if (!c || c.public !== true) return null;
  return accordValide(c, aujourdhui) ? null : RAISON_ACCORD_MANQUANT;
}

const LIBELLES_MOTIFS = Object.freeze({
  variantes: 'variantes (produits à options)',
  hors_rayon: 'hors rayon de pièces',
  sans_prix: 'sans prix',
  sans_reference: 'sans référence',
});

/**
 * Compte rendu du dernier relevé de pièces, ou null s'il n'y en a pas (jamais relevé, relevé d'articles).
 * Un motif inconnu garde sa clé comme libellé : rien n'est avalé.
 * @param {Record<string, any>|null|undefined} resultat `catalog_sync_result`
 * @returns {{ retenues: number, exclus: Array<{ cle: string, libelle: string, nombre: number }>, rayons: string[] }|null}
 */
export function compteRenduPieces(resultat) {
  const compte = objet(resultat?.compte);
  if (!compte) return null;
  const exclus = [];
  for (const [cle, valeur] of Object.entries(compte)) {
    if (cle === 'retenues') continue;
    const nombre = Number(valeur) || 0;
    const connu = Object.prototype.hasOwnProperty.call(LIBELLES_MOTIFS, cle);
    if (connu && nombre <= 0) continue;
    exclus.push({ cle, libelle: connu ? LIBELLES_MOTIFS[cle] : cle, nombre });
  }
  const rayons = Array.isArray(resultat?.rayons) ? resultat.rayons.filter((r) => typeof r === 'string' && r) : [];
  return { retenues: Number(compte.retenues) || 0, exclus, rayons };
}

/** Phrase affichée sous le champ « Site du fournisseur » d'une boutique publique en http. */
export const RAISON_ADRESSE_HTTPS = "L'adresse d'une boutique publique doit commencer par https://.";

/**
 * L'adresse d'une boutique publique est-elle acceptable ? https obligatoire (le relevé refuse sinon), aucune espace.
 * Ne concerne que les fournisseurs « boutique publique » ; les autres gardent leur règle (http ou https).
 * @param {unknown} url
 * @returns {boolean}
 */
export function adresseBoutiquePubliqueValide(url) {
  return typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim());
}

/** Traduction du refus de la base quand un non-administrateur touche la connexion, le site ou l'accord d'un fournisseur. */
export const MESSAGE_CONNECTEUR_ADMIN = "Seul un administrateur peut modifier la connexion, le site ou l'accord d'un fournisseur.";

/**
 * Message d'écran d'une erreur d'enregistrement de fournisseur : le jeton `connecteur_admin_requis` de la base est traduit,
 * toute autre erreur garde son message (ou `parDefaut`).
 * @param {unknown} err
 * @param {string} parDefaut
 * @returns {string}
 */
export function messageErreurFournisseur(err, parDefaut) {
  const message = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : '';
  if (message.includes('connecteur_admin_requis')) return MESSAGE_CONNECTEUR_ADMIN;
  return message || parDefaut;
}
