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
  const hote = u.hostname.toLowerCase();
  // Une adresse IP (v4 ou v6) ou un nom sans point n'est jamais un site de fournisseur (réseau interne, relecture I3).
  if (hote.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || !hote.includes('.')) return null;
  return hote;
}

// Suffixes partagés entre clients d'un hébergeur, ou suffixes de pays à deux niveaux : le domaine enregistrable a
// alors un libellé de plus (« boutique.myshopify.com », « exemple.co.uk »). Sans eux, « x.myshopify.com » ouvrirait
// le navigateur à toutes les boutiques de l'hébergeur (relecture I3).
const SUFFIXES_PARTAGES = [
  'myshopify.com', 's3.amazonaws.com', 'amazonaws.com', 'cloudfront.net', 'azurewebsites.net', 'blob.core.windows.net',
  'herokuapp.com', 'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev', 'wixsite.com', 'web.app',
  'firebaseapp.com', 'appspot.com', 'squarespace.com', 'wordpress.com', 'odoo.com', 'prestashop.com',
  'co.uk', 'org.uk', 'com.au', 'co.jp', 'com.br',
];

/**
 * Domaine enregistrable d'un hôte : ses deux derniers libellés (« cdn.prod.platform.invicta-group.fr » ⇒
 * « invicta-group.fr »), trois sous un suffixe partagé (« boutique.myshopify.com »).
 * @param {string} hote
 * @returns {string}
 */
export function domaineEnregistrable(hote) {
  const h = String(hote || '').toLowerCase();
  const suffixe = SUFFIXES_PARTAGES.filter((s) => h === s || h.endsWith(`.${s}`)).sort((a, b) => b.length - a.length)[0];
  const libelles = h.split('.').filter(Boolean);
  return libelles.slice(-((suffixe ? suffixe.split('.').length : 1) + 1)).join('.');
}

/**
 * Vrai si robots.txt (groupe « User-agent: * ») laisse lire ce chemin ; la règle la plus longue qui correspond
 * l'emporte (Allow à égalité). Un robots.txt vide ou illisible n'interdit rien.
 * @param {string} robots texte de robots.txt
 * @param {string} chemin chemin et requête (« /produit/1?x=2 »)
 * @returns {boolean}
 */
export function cheminAutorise(robots, chemin) {
  const regles = [];
  let groupeEtoile = false;
  let dansAgents = false;
  for (const brut of String(robots || '').split(/\r?\n/)) {
    const ligne = brut.replace(/#.*/, '').trim();
    const m = ligne.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const cle = m[1].toLowerCase();
    const valeur = m[2].trim();
    if (cle === 'user-agent') {
      if (!dansAgents) groupeEtoile = false;
      dansAgents = true;
      if (valeur === '*') groupeEtoile = true;
      continue;
    }
    dansAgents = false;
    if (groupeEtoile && (cle === 'allow' || cle === 'disallow') && valeur) regles.push({ autorise: cle === 'allow', prefixe: valeur });
  }
  const correspondantes = regles.filter((r) => chemin.startsWith(r.prefixe.replace(/\*$/, '')));
  if (!correspondantes.length) return true;
  correspondantes.sort((a, b) => b.prefixe.length - a.prefixe.length || Number(b.autorise) - Number(a.autorise));
  return correspondantes[0].autorise;
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
