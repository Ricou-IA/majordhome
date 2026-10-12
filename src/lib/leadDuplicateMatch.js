/**
 * leadDuplicateMatch.js — Détection de doublons de leads (module PUR)
 * ============================================================================
 * Filet anti-doublon à la création d'un lead (kanban « Nouveau lead » et
 * walk-in du Planning). Trois axes de rapprochement, du plus fiable au moins
 * fiable : téléphone normalisé, email, nom+prénom exacts.
 *
 * Aucun import React/Supabase — testé via `node --test scripts/lead-duplicate-match.test.mjs`.
 * La requête DB vit dans leads.service.js (findPotentialDuplicates) ; ce module
 * normalise les clés et CONFIRME les candidats ramenés par la requête large
 * (élimine les faux positifs du ILIKE, annote la raison du match pour l'UI).
 * ============================================================================
 */

/**
 * Normalise un téléphone en clé comparable : chiffres uniquement, préfixe
 * international FR (+33 / 0033 / 33) ramené au format national 0X…
 * @param {string|null} phone
 * @returns {string|null} clé (≥ 8 chiffres) ou null si inexploitable
 */
export function normalizePhoneKey(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0033')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('33') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 ? digits : null;
}

/**
 * Normalise un email en clé comparable (trim + lowercase).
 * @param {string|null} email
 * @returns {string|null}
 */
export function normalizeEmailKey(email) {
  if (!email) return null;
  const key = String(email).trim().toLowerCase();
  return key.includes('@') ? key : null;
}

/**
 * Efface accents et ligatures d'un nom, comme `unaccent` côté Postgres (la
 * requête large de l'axe nom passe par la RPC `lead_search`, qui compare sans
 * accent : la confirmation JS doit suivre, sinon « ROZIERES » saisi sans accent
 * trouverait la carte « ROZIÈRES » en base pour la rejeter ici — incident
 * 2026-10-12). NFD sépare les diacritiques combinants ; Œ/Æ ne se décomposent
 * pas et sont traités à part.
 * @param {string} s
 * @returns {string}
 */
function stripAccents(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Œ/g, 'OE').replace(/œ/g, 'oe')
    .replace(/Æ/g, 'AE').replace(/æ/g, 'ae');
}

/**
 * Normalise nom+prénom en clé comparable (majuscules, sans accent, espaces
 * internes réduits). Les DEUX sont requis : un nom de famille seul matcherait
 * tous les homonymes (père/fils, fratries) — le filet doit rester un filet,
 * pas un chalut.
 * @param {string|null} firstName
 * @param {string|null} lastName
 * @returns {{first: string, last: string}|null}
 */
export function normalizeNameKey(firstName, lastName) {
  const norm = (v) => stripAccents(String(v || '')).trim().replace(/\s+/g, ' ').toUpperCase();
  const first = norm(firstName);
  const last = norm(lastName);
  return first && last ? { first, last } : null;
}

/**
 * Construit les clés de recherche depuis les champs saisis.
 * @returns {{phoneKey: string|null, emailKey: string|null, nameKey: Object|null}|null}
 *          null si aucun axe exploitable (le check est alors sauté)
 */
export function buildDuplicateProbe({ phone, email, firstName, lastName, clientId } = {}) {
  const phoneKey = normalizePhoneKey(phone);
  const emailKey = normalizeEmailKey(email);
  const nameKey = normalizeNameKey(firstName, lastName);
  // 4ᵉ axe (2026-09-16) : le client Majord'home déjà connu (ex. client Pennylane
  // ponté par pennylane_sync). Couvre le cas où le contact de la fiche diffère
  // de celui du lead — DURAND : 3 leads sur le même client_id.
  const clientKey = clientId ? String(clientId) : null;
  if (!phoneKey && !emailKey && !nameKey && !clientKey) return null;
  return { phoneKey, emailKey, nameKey, clientKey };
}

/**
 * Confirme et annote les candidats ramenés par la requête large.
 * @param {Array} candidates - leads {id, first_name, last_name, phone, email, …}
 * @param {Object} probe - résultat de buildDuplicateProbe
 * @returns {Array} candidats confirmés, annotés de matchReasons ('client'|'phone'|'email'|'name')
 */
export function matchLeadDuplicates(candidates, probe) {
  if (!probe || !Array.isArray(candidates)) return [];
  return candidates
    .map((c) => {
      const reasons = [];
      if (probe.clientKey && c.client_id && String(c.client_id) === probe.clientKey) reasons.push('client');
      if (probe.phoneKey && normalizePhoneKey(c.phone) === probe.phoneKey) reasons.push('phone');
      if (probe.emailKey && normalizeEmailKey(c.email) === probe.emailKey) reasons.push('email');
      if (probe.nameKey) {
        const candidateName = normalizeNameKey(c.first_name, c.last_name);
        if (candidateName
          && candidateName.first === probe.nameKey.first
          && candidateName.last === probe.nameKey.last) reasons.push('name');
      }
      return reasons.length ? { ...c, matchReasons: reasons } : null;
    })
    .filter(Boolean);
}
