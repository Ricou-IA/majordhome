/**
 * savProjet.js — une demande SAV qui débouche sur un devis de remplacement
 * ============================================================================
 * Module PUR, testé `scripts/sav-projet.test.mjs`.
 *
 * Le SAV est une porte d'entrée (Eric 2026-11-25) : quand la demande aboutit à un devis de
 * remplacement, elle devient un PROJET — un lead, relié à la carte SAV par
 * `interventions.lead_id` — dès que le devis existe. Le lead se suit dans le pipeline ; le
 * chantier naît tout seul quand le devis Pennylane est accepté (trigger existant). Rien n'est
 * écrit sur la carte SAV ensuite : sa place dans le kanban se LIT sur l'état du projet
 * (`etatProjet`, puis `colonneDeCarte` de kanbanEntretienSav.js).
 *
 * Les devis proposés sont ceux du miroir Pennylane (jamais un appel direct) : ceux du client de
 * la carte qui ne sont rattachés à aucun lead.
 * ============================================================================
 */

import { buildExplorerRows } from './quotesExplorer.js';

/** Statuts Pennylane d'un devis de remplacement à suivre : en attente, expiré (relançable), accepté. */
export const STATUTS_DEVIS_REMPLACEMENT = ['pending', 'expired', 'accepted'];

const CIVILITES = new Set(['m', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle', 'et']);

/**
 * Mots d'un nom, sans accents, casse ni civilité, triés — « M. Sontag Vincent » = « VINCENT SONTAG ».
 * @param {string | null | undefined} nom
 * @returns {string[]}
 */
export function motsDuNom(nom) {
  return String(nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot && !CIVILITES.has(mot))
    .sort();
}

/**
 * Deux noms désignent-ils la même personne ? Mêmes mots, dans n'importe quel ordre, et au
 * moins deux mots : un nom de famille seul ne suffit pas (homonymes).
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function memeNom(a, b) {
  const ma = motsDuNom(a);
  const mb = motsDuNom(b);
  return ma.length >= 2 && ma.length === mb.length && ma.every((mot, i) => mot === mb[i]);
}

/**
 * Ce que le miroir Pennylane propose pour le client d'une carte SAV.
 * Un devis est celui du client si son customer Pennylane est ponté à la fiche (`customerIds`),
 * sinon si le nom est le même (`parNom: true` — à faire vérifier par la personne).
 *
 * @param {object} params
 * @param {Array} params.quotes  devis du miroir (forme de pennylaneQuotesService.getAll().rows)
 * @param {Map} [params.linkByQuoteId]  rattachements actifs (devis → { lead_id, lead_name })
 * @param {Set} [params.dismissedIds]  devis écartés dans l'explorateur
 * @param {Array<string|number>} [params.customerIds]  customers Pennylane pontés au client
 * @param {string} [params.nomClient]
 * @returns {{ orphelins: Array<object>, projet: ({ lead_id: string, lead_name: (string|null) } | null) }}
 *   `orphelins` = devis du client rattachés à aucun lead, du plus récent au plus ancien ;
 *   `projet` = lead qui porte déjà le devis le plus récent du client, s'il y en a un
 */
export function propositionRemplacement({
  quotes = [], linkByQuoteId = new Map(), dismissedIds = new Set(), customerIds = [], nomClient = '',
} = {}) {
  const pontes = new Set((customerIds || []).map((id) => String(id)));
  const duClient = buildExplorerRows({
    quotes, linkByQuoteId, dismissedIds, minAmountHt: 0, sinceDays: Number.POSITIVE_INFINITY,
  })
    .filter((ligne) => !ligne.is_dismissed && STATUTS_DEVIS_REMPLACEMENT.includes(ligne.status))
    .map((ligne) => {
      if (ligne.customer_id != null && pontes.has(String(ligne.customer_id))) return { ...ligne, parNom: false };
      if (memeNom(ligne.customer_name, nomClient)) return { ...ligne, parNom: true };
      return null;
    })
    .filter(Boolean);

  const rattache = duClient.find((ligne) => !ligne.is_orphan && ligne.lead_id);
  return {
    orphelins: duClient.filter((ligne) => ligne.is_orphan),
    projet: rattache ? { lead_id: rattache.lead_id, lead_name: rattache.lead_name || null } : null,
  };
}

/**
 * État du projet relié à une carte SAV.
 *   - `inconnu`  : lecture en cours ou en échec — on ne conclut rien ;
 *   - `absent`   : le lead n'est plus dans le pipeline (supprimé) — la carte redevient une demande ordinaire ;
 *   - `chantier` : un chantier existe pour ce lead (devis accepté) — la demande est sortie du SAV ;
 *   - `perdu`    : le lead est en colonne Perdu — la demande revient à traiter ;
 *   - `en_cours` : devis envoyé, pas encore de réponse.
 *
 * @param {{ intervention_type?: string, lead_id?: (string|null) } | null | undefined} item
 * @param {{ chantiers?: Array<{ id: string, lead_id: string }>, cartes?: Array<{ lead_id: string, column_key: string }> } | null | undefined} etats
 *   lectures du pipeline pour les leads reliés ; `null` / `undefined` = pas encore connues
 * @returns {{ leadId: string, etat: 'inconnu'|'absent'|'chantier'|'perdu'|'en_cours', chantierId: (string|null) } | null}
 *   `null` = la carte n'a pas de projet
 */
export function etatProjet(item, etats) {
  if (!item?.lead_id || item.intervention_type !== 'sav') return null;
  const leadId = item.lead_id;
  if (!etats || !Array.isArray(etats.chantiers) || !Array.isArray(etats.cartes)) {
    return { leadId, etat: 'inconnu', chantierId: null };
  }
  const chantier = etats.chantiers.find((c) => c.lead_id === leadId);
  if (chantier) return { leadId, etat: 'chantier', chantierId: chantier.id };
  const cartes = etats.cartes.filter((c) => c.lead_id === leadId);
  if (cartes.length === 0) return { leadId, etat: 'absent', chantierId: null };
  if (cartes.every((c) => c.column_key === 'perdu')) return { leadId, etat: 'perdu', chantierId: null };
  return { leadId, etat: 'en_cours', chantierId: null };
}

/**
 * Mention du projet sur la carte et dans la fiche SAV. `null` = rien à dire.
 * @param {{ etat?: string } | null | undefined} projet
 * @returns {{ texte: string, ton: 'info'|'ok'|'alerte'|'neutre' } | null}
 */
export function mentionProjet(projet) {
  switch (projet?.etat) {
    case 'en_cours': return { texte: 'Projet · devis envoyé', ton: 'info' };
    case 'chantier': return { texte: 'Passé en chantier', ton: 'ok' };
    case 'perdu': return { texte: 'Devis refusé', ton: 'alerte' };
    case 'inconnu': return { texte: 'Projet', ton: 'neutre' };
    default: return null;
  }
}

/**
 * Statut à écrire sur la carte quand on la relie à un projet : une demande devient
 * « Devis envoyé » ; une carte déjà plus loin ne recule pas.
 * @param {{ workflow_status?: (string|null) } | null | undefined} item
 * @returns {string | null} statut à écrire, null = rien à changer
 */
export function statutApresLiaison(item) {
  return item?.workflow_status === 'demande' ? 'devis_envoye' : null;
}
