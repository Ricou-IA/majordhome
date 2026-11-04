/**
 * pennylaneCustomerRequirements.js — Champs d'une fiche client exigés par Pennylane
 * ============================================================================
 * Module PUR (aucun import React / Supabase). Source unique de « la fiche est-elle
 * assez complète pour créer le customer Pennylane » : le service (`buildPennylaneCustomer`)
 * refuse avec ce message, et la fenêtre de devis demande ces mêmes champs avant l'envoi
 * (`CompleterClientPennylaneModal`) au lieu d'un toast (Eric, 2026-10-27).
 *
 * Schéma Pennylane `POST /customers` : particulier = first_name + last_name + billing_address ;
 * entreprise = name + billing_address ; adresse = address + postal_code + city (+ pays).
 * L'e-mail est facultatif, mais une adresse invalide fait refuser le customer (422 « At least
 * one email address is not valid », vécu 2026-11-04 avec `…@gmail..com`) : il est donc demandé
 * dès qu'il est renseigné et mal formé.
 * Testé : node --test scripts/pennylane-customer-requirements.test.mjs
 * ============================================================================
 */

/** Libellés FR des champs, dans l'ordre d'affichage du formulaire. */
export const LIBELLES_CHAMPS_CLIENT_PENNYLANE = Object.freeze({
  company_name: 'raison sociale',
  first_name: 'prénom',
  last_name: 'nom',
  address: 'adresse',
  postal_code: 'code postal',
  city: 'ville',
  email: 'e-mail valide',
});

const EMAIL_RE = /^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Adresses d'une saisie e-mail : une fiche peut en porter plusieurs (« a@x.fr, b@x.fr »),
 * Pennylane les veut une par une dans `emails[]`.
 * @param {string|null|undefined} saisie
 * @returns {string[]}
 */
export function adressesEmail(saisie) {
  return String(saisie || '').split(/[\s,;]+/).filter(Boolean);
}

/**
 * Toutes les adresses de la saisie sont-elles bien formées ? Vide = oui (e-mail facultatif).
 * @param {string|null|undefined} saisie
 * @returns {boolean}
 */
export function emailsValides(saisie) {
  return adressesEmail(saisie).every((a) => EMAIL_RE.test(a));
}

/**
 * Champs manquants d'une fiche client (ligne `majordhome_clients`) pour créer le customer Pennylane.
 * @param {object|null|undefined} client
 * @returns {Array<{ key: string, label: string }>} vide = fiche complète
 */
export function champsClientManquantsPourPennylane(client) {
  const c = client || {};
  const manquants = [];
  const isCompany = c.client_category === 'entreprise';
  if (isCompany) {
    const name = (c.display_name || `${c.first_name || ''} ${c.last_name || ''}`).trim();
    if (!name) manquants.push('company_name');
  } else {
    if (!c.first_name) manquants.push('first_name');
    if (!c.last_name) manquants.push('last_name');
  }
  if (![c.address, c.address_complement].some((x) => typeof x === 'string' && x.trim())) manquants.push('address');
  if (!c.postal_code) manquants.push('postal_code');
  if (!c.city) manquants.push('city');
  if (!emailsValides(c.email)) manquants.push('email');
  return manquants.map((key) => ({ key, label: LIBELLES_CHAMPS_CLIENT_PENNYLANE[key] }));
}

/**
 * Message d'erreur en clair, utilisé par le service quand l'appelant n'a pas complété la fiche.
 * @param {Array<{ label: string }>} manquants
 * @returns {string}
 */
export function messageClientIncompletPennylane(manquants) {
  return `Fiche client incomplète pour Pennylane : ${manquants.map((m) => m.label).join(', ')} manquant(s)`;
}
