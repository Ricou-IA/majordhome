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
 * Normalise nom+prénom en clé comparable. Les DEUX sont requis : un nom de
 * famille seul matcherait tous les homonymes (père/fils, fratries) — le filet
 * doit rester un filet, pas un chalut.
 * @param {string|null} firstName
 * @param {string|null} lastName
 * @returns {{first: string, last: string}|null}
 */
export function normalizeNameKey(firstName, lastName) {
  const first = String(firstName || '').trim().toUpperCase();
  const last = String(lastName || '').trim().toUpperCase();
  return first && last ? { first, last } : null;
}

/**
 * Construit les clés de recherche depuis les champs saisis.
 * @returns {{phoneKey: string|null, emailKey: string|null, nameKey: Object|null}|null}
 *          null si aucun axe exploitable (le check est alors sauté)
 */
export function buildDuplicateProbe({ phone, email, firstName, lastName } = {}) {
  const phoneKey = normalizePhoneKey(phone);
  const emailKey = normalizeEmailKey(email);
  const nameKey = normalizeNameKey(firstName, lastName);
  if (!phoneKey && !emailKey && !nameKey) return null;
  return { phoneKey, emailKey, nameKey };
}

/**
 * Confirme et annote les candidats ramenés par la requête large.
 * @param {Array} candidates - leads {id, first_name, last_name, phone, email, …}
 * @param {Object} probe - résultat de buildDuplicateProbe
 * @returns {Array} candidats confirmés, annotés de matchReasons ('phone'|'email'|'name')
 */
export function matchLeadDuplicates(candidates, probe) {
  if (!probe || !Array.isArray(candidates)) return [];
  return candidates
    .map((c) => {
      const reasons = [];
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
