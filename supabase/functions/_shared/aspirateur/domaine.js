// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/aspirateur/domaine.js — ne pas éditer.
// src/lib/aspirateur/domaine.js
// Module PUR (aucun import React / Supabase / alias ; copié pour Deno et pour le service VPS) : domaines autorisés du
// navigateur de l'aspirateur. Le navigateur ne laisse passer que les requêtes vers le domaine ENREGISTRABLE du site du
// fournisseur (pro.invicta-group.fr ⇒ *.invicta-group.fr, qui couvre le CDN des images et des PDF) : une page piégée
// ne peut rien envoyer ailleurs. Spec docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md § 7.4.
// Testé : node --test scripts/aspirateur/domaine.test.mjs

/**
 * Hôte d'une URL https, en minuscules ; null si l'URL est illisible ou n'est pas en https.
 * @param {unknown} url
 * @returns {string | null}
 */
export function normaliserDomaine(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname) return null;
  return u.hostname.toLowerCase();
}

/**
 * Domaine enregistrable d'un hôte : ses deux derniers libellés (« cdn.prod.platform.invicta-group.fr » ⇒
 * « invicta-group.fr »). Les suffixes à deux niveaux (« .co.uk ») ne sont pas traités : aucun fournisseur visé.
 * @param {string} hote
 * @returns {string}
 */
export function domaineEnregistrable(hote) {
  const libelles = String(hote || '').toLowerCase().split('.').filter(Boolean);
  return libelles.slice(-2).join('.');
}

/**
 * Vrai si l'URL est en https et sur le même domaine enregistrable que le site du fournisseur.
 * @param {unknown} url
 * @param {string} hoteSite hôte du site (ex. « pro.invicta-group.fr »)
 * @returns {boolean}
 */
export function urlAutorisee(url, hoteSite) {
  const hote = normaliserDomaine(url);
  if (!hote || !hoteSite) return false;
  const racine = domaineEnregistrable(hoteSite);
  if (!racine.includes('.')) return false;
  return hote === racine || hote.endsWith(`.${racine}`);
}
