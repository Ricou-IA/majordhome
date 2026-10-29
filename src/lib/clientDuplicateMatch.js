/**
 * clientDuplicateMatch.js — Détection de doublons de CLIENTS (module PUR)
 * ============================================================================
 * Filet anti-doublon à la création d'une fiche client (page Clients, assistant
 * de contrat, requalification d'un lead). Pendant client de leadDuplicateMatch,
 * dont il reprend les normaliseurs.
 *
 * Deux forces de rapprochement :
 *   - FORT  : même téléphone (principal ou secondaire, 9 derniers chiffres) ou
 *             même email → presque toujours la même personne (ERNY, 2026-09-22 :
 *             fiche recréée à l'identique, 2ᵉ compte Pennylane ouvert) ;
 *   - FAIBLE : même nom + prénom, ou même nom dans le même code postal.
 * Un rapprochement fort exige une confirmation explicite pour créer quand même
 * (un couple, un propriétaire et son locataire partagent parfois un numéro).
 *
 * Aucun import React/Supabase — testé via `node --test scripts/client-duplicate-match.test.mjs`.
 * La requête DB vit dans clients.service.js (findPotentialDuplicates).
 * ============================================================================
 */

import { normalizeEmailKey, normalizeNameKey, normalizePhoneKey } from './leadDuplicateMatch.js';

/** Raisons « fortes » : une seule suffit à exiger une confirmation. */
const STRONG_REASONS = ['phone', 'email'];

/**
 * Clé téléphone comparable entre formats (+33 6…, 06…, 6… sans 0 de Pennylane) :
 * les 9 derniers chiffres du numéro normalisé.
 * @param {string|null} phone
 * @returns {string|null}
 */
export function phoneTailKey(phone) {
  const key = normalizePhoneKey(phone);
  return key && key.length >= 9 ? key.slice(-9) : null;
}

/**
 * Normalise un nom seul (majuscules, sans accent, espaces réduits).
 * @param {string|null} lastName
 * @returns {string|null}
 */
function lastNameKey(lastName) {
  const key = normalizeNameKey('x', lastName);
  return key ? key.last : null;
}

/**
 * Construit les clés de recherche depuis les champs saisis.
 * @param {{phone?: string, phoneSecondary?: string, email?: string, firstName?: string, lastName?: string, postalCode?: string}} input
 * @returns {{phoneKeys: string[], emailKey: string|null, nameKey: {first: string, last: string}|null, lastKey: string|null, postalCode: string|null}|null}
 *          null si aucun axe exploitable
 */
export function buildClientDuplicateProbe({ phone, phoneSecondary, email, firstName, lastName, postalCode } = {}) {
  const phoneKeys = [...new Set([phoneTailKey(phone), phoneTailKey(phoneSecondary)].filter(Boolean))];
  const emailKey = normalizeEmailKey(email);
  const nameKey = normalizeNameKey(firstName, lastName);
  const lastKey = lastNameKey(lastName);
  const cp = postalCode ? String(postalCode).trim() : '';
  const postal = /^\d{5}$/.test(cp) ? cp : null;
  if (!phoneKeys.length && !emailKey && !nameKey && !(lastKey && postal)) return null;
  return { phoneKeys, emailKey, nameKey, lastKey, postalCode: postal };
}

/**
 * Motifs de recherche téléphone pour la requête large (ILIKE) : les 8 derniers
 * chiffres sous les formats stockés en base (« 06 77 03 73 20 », « 0677037320 »,
 * « +33 6 77 03 73 20 », « 06.77.03.73.20 »). La confirmation se fait ensuite
 * sur la clé 9 chiffres.
 * @param {string} tailKey - 9 chiffres
 * @returns {string[]}
 */
export function phoneSearchPatterns(tailKey) {
  if (!tailKey || tailKey.length < 9) return [];
  const last8 = tailKey.slice(-8);
  const pairs = last8.match(/.{2}/g);
  return [last8, pairs.join(' '), pairs.join('.')];
}

/**
 * Confirme et annote les candidats ramenés par la requête large.
 * @param {Array} candidates - clients {id, first_name, last_name, phone, phone_secondary, email, postal_code, …}
 * @param {Object} probe - résultat de buildClientDuplicateProbe
 * @returns {Array} candidats confirmés, annotés de matchReasons ('phone'|'email'|'name'|'name_cp')
 *          et isStrong ; les forts d'abord
 */
export function matchClientDuplicates(candidates, probe) {
  if (!probe || !Array.isArray(candidates)) return [];
  return candidates
    .map((c) => {
      const reasons = [];
      const candidatePhones = [phoneTailKey(c.phone), phoneTailKey(c.phone_secondary)].filter(Boolean);
      if (probe.phoneKeys.some((k) => candidatePhones.includes(k))) reasons.push('phone');
      if (probe.emailKey && normalizeEmailKey(c.email) === probe.emailKey) reasons.push('email');
      const candidateName = normalizeNameKey(c.first_name, c.last_name);
      const sameFullName = !!(probe.nameKey && candidateName
        && candidateName.first === probe.nameKey.first
        && candidateName.last === probe.nameKey.last);
      if (sameFullName) {
        reasons.push('name');
      } else if (probe.lastKey && probe.postalCode
        && lastNameKey(c.last_name) === probe.lastKey
        && String(c.postal_code || '').trim() === probe.postalCode) {
        reasons.push('name_cp');
      }
      if (!reasons.length) return null;
      return { ...c, matchReasons: reasons, isStrong: reasons.some((r) => STRONG_REASONS.includes(r)) };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.isStrong) - Number(a.isStrong));
}

/**
 * Vrai si au moins un candidat est un rapprochement fort (confirmation requise).
 * @param {Array} matches - sortie de matchClientDuplicates
 * @returns {boolean}
 */
export function hasStrongDuplicate(matches) {
  return Array.isArray(matches) && matches.some((m) => m.isStrong);
}
