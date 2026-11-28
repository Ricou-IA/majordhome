// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/aspirateur/recette.js — ne pas éditer.
// src/lib/aspirateur/recette.js
// Module PUR (copié pour Deno et pour le service VPS) : forme d'une RECETTE de site (commune à la plateforme) et
// contrôle qu'elle ne contient aucun secret. Une recette dit comment se connecter (sélecteurs, jamais de valeurs), où
// sont les listes de produits, comment lire une page produit et trouver ses documents.
// Spec docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md § 7.2-7.3.
// Testé : node --test scripts/aspirateur/recette.test.mjs
import { urlAutorisee } from './domaine.js';

export const SCHEMA_RECETTE = 1;

const TYPES_DOCUMENT = ['fiche_technique', 'notice', 'declaration_performance', 'etiquette_energie'];
const SELECTEUR_MAX = 300;
const DELAI_MIN_MS = 1000;
// Session ou jeton dans une adresse : une recette commune rejouée par une autre entreprise ne doit rien emporter de la
// session de celle qui l'a apprise (relecture I5).
const SESSION = /;jsessionid=|[?&](sid|sessionid|session|phpsessid|jsessionid|token|access_token|auth|key|apikey|api_key|signature)=/i;

const MOTIF_MAX = 100;

/**
 * Motif qui découpe la marque dans le texte lu par `produit.marque` (vécu Invicta 2026-11-28 : la marque n'est que dans
 * le titre « Nom - Réf : Deville | Invicta »). Expression régulière de 100 caractères au plus, à UN seul groupe : la
 * marque. Rendue compilée, ou null si absente ou invalide. Appliquée à 300 caractères au plus.
 * @param {unknown} m
 * @returns {RegExp | null}
 */
export function motifMarque(m) {
  if (typeof m !== 'string' || !m || m.length > MOTIF_MAX) return null;
  try {
    const re = new RegExp(m);
    // nombre de groupes de capture : une alternative vide fait toujours correspondre
    return /** @type {RegExpExecArray} */ (new RegExp(`${m}|`).exec('')).length === 2 ? re : null;
  } catch { return null; }
}

/** @param {unknown} v */
const estObjet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} v
 * @param {string} nom
 * @param {string[]} erreurs
 * @param {boolean} [requis]
 */
function selecteur(v, nom, erreurs, requis = true) {
  if (v === undefined || v === null) { if (requis) erreurs.push(`${nom} : sélecteur requis`); return; }
  if (typeof v !== 'string' || !v.trim()) erreurs.push(`${nom} : sélecteur vide`);
  else if (v.length > SELECTEUR_MAX) erreurs.push(`${nom} : sélecteur trop long`);
}

/**
 * Valide la forme d'une recette. Toutes les URL qu'elle contient doivent être sur le domaine de la recette.
 * @param {unknown} r
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerRecette(r) {
  const erreurs = [];
  if (!estObjet(r)) return { ok: false, erreurs: ['recette absente'] };
  const rec = /** @type {Record<string, any>} */ (r);
  if (rec.schema !== SCHEMA_RECETTE) erreurs.push('schéma de recette inconnu');
  const domaine = typeof rec.domaine === 'string' ? rec.domaine.trim() : '';
  if (!domaine) erreurs.push('domaine requis');
  const url = (/** @type {unknown} */ u, /** @type {string} */ nom) => {
    if (!domaine || !urlAutorisee(u, domaine)) erreurs.push(`${nom} : adresse hors du site`);
    else if (SESSION.test(String(u))) erreurs.push(`${nom} : l’adresse porte une session ou un jeton (à retirer)`);
  };

  if (rec.connexion !== undefined) {
    const c = rec.connexion;
    if (!estObjet(c)) erreurs.push('connexion : forme invalide');
    else {
      url(c.url, 'connexion.url');
      for (const k of ['champ_identifiant', 'champ_mot_de_passe', 'bouton', 'preuve']) selecteur(c[k], `connexion.${k}`, erreurs);
    }
  }

  const l = rec.listes;
  if (!estObjet(l)) erreurs.push('listes requises');
  else {
    if (!Array.isArray(l.departs) || l.departs.length === 0) erreurs.push('listes.departs : au moins une adresse');
    else l.departs.forEach((/** @type {unknown} */ d, /** @type {number} */ i) => url(d, `listes.departs[${i}]`));
    selecteur(l.lien_produit, 'listes.lien_produit', erreurs);
    selecteur(l.suivant, 'listes.suivant', erreurs, false);
  }

  const p = rec.produit;
  if (!estObjet(p)) erreurs.push('produit requis');
  else {
    selecteur(p.nom, 'produit.nom', erreurs);
    selecteur(p.reference, 'produit.reference', erreurs);
    for (const k of ['marque', 'ean', 'prix', 'photo', 'zone_caracteristiques']) selecteur(p[k], `produit.${k}`, erreurs, false);
    if (p.marque_motif !== undefined && !motifMarque(p.marque_motif)) erreurs.push(`produit.marque_motif : expression régulière à un seul groupe, ${MOTIF_MAX} caractères au plus`);
    if (p.documents !== undefined) {
      if (!Array.isArray(p.documents)) erreurs.push('produit.documents : liste attendue');
      else p.documents.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
        if (!estObjet(d) || !TYPES_DOCUMENT.includes(d.type)) erreurs.push(`produit.documents[${i}] : type inconnu`);
        else selecteur(d.selecteur, `produit.documents[${i}].selecteur`, erreurs);
      });
    }
  }

  if (rec.politesse !== undefined) {
    const d = estObjet(rec.politesse) ? rec.politesse.delai_ms : undefined;
    if (!Number.isFinite(d) || d < DELAI_MIN_MS) erreurs.push(`politesse.delai_ms : ${DELAI_MIN_MS} ms au moins`);
  }

  return { ok: erreurs.length === 0, erreurs };
}

const ENTITES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '@': '&#64;' };

/**
 * Formes sous lesquelles un secret peut apparaître dans une page, une adresse ou un JSON : brute, encodée pour une URL
 * ou un formulaire, échappée en JSON, en entités HTML (relecture I4). Vide pour un secret de moins de 3 caractères.
 * @param {unknown} secret
 * @returns {string[]}
 */
export function variantesSecret(secret) {
  if (typeof secret !== 'string' || secret.trim().length < 3) return [];
  const s = secret.trim();
  const v = new Set([
    s,
    encodeURIComponent(s),
    encodeURI(s),
    encodeURIComponent(s).replace(/%20/g, '+'),
    JSON.stringify(s).slice(1, -1),
    s.replace(/[&<>"'@]/g, (c) => ENTITES[/** @type {keyof typeof ENTITES} */ (c)]),
  ]);
  return [...v].filter((x) => x.length >= 3);
}

/**
 * Vrai si la recette contient l'un des secrets (identifiant, mot de passe, numéro de compte client) sous l'une de ses
 * formes (variantesSecret), sans casse.
 * @param {unknown} r
 * @param {Array<string | null | undefined>} secrets
 * @returns {boolean}
 */
export function recetteContientSecret(r, secrets) {
  const texte = JSON.stringify(r ?? null).toLowerCase();
  return (secrets || []).some((s) => variantesSecret(s).some((v) => texte.includes(v.toLowerCase())));
}
