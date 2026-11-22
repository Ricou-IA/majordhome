// src/lib/mailHabillage.js
// ============================================================================
// L'habillage de tous les e-mails de l'application — SEULE définition (spec
// 2026-11-21-createur-mail-une-page-habillage-design.md § 5.1). Module PUR : aucun import hors
// modules voisins, copié pour Deno par `npm run sync:tournee-engine`, testé
// `scripts/mail-habillage.test.mjs`. Utilisé par l'aperçu et par les edges.
//
// `habillerMail(reglages, corps)` décide, dans cet ordre :
//   1. le corps est déjà une page complète → rendu tel quel ;
//   2. `email_habillage` est un objet → habillage construit depuis ses choix ;
//   3. `email_skeleton_html` contient `{{EMAIL_BODY}}` → ancien habillage de l'entreprise ;
//   4. sinon → habillage construit avec les choix par défaut.
// Le corps est inséré sans être touché (ses variables restent à remplacer par l'appelant).
// ============================================================================

import { resoudreExpediteur } from './expediteur.js';

/** Couleurs neutres d'une entreprise qui n'a pas choisi les siennes. */
export const DEFAUTS_MARQUE = Object.freeze({ accent: '#64748b', bandeau: '#334155' });

/**
 * @typedef {{ coordonnees: boolean, certifications: boolean, site: boolean }} PiedHabillage
 * @typedef {{ entete: 'logo' | 'logo_bandeau', pied: PiedHabillage }} ChoixHabillage
 */

/** Choix par défaut : logo en tête, coordonnées en pied. @type {Readonly<ChoixHabillage>} */
export const HABILLAGE_DEFAUT = Object.freeze({
  entete: 'logo',
  pied: Object.freeze({ coordonnees: true, certifications: false, site: false }),
});

const COULEUR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PAGE_COMPLETE_RE = /<html[\s>]|<!doctype/i;
const DESABONNEMENT_RE = /mailto:[^"'\s>]*\?subject=D[eé]sabonnement/i;

/** @param {unknown} v @returns {string} */
const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/** @param {string} s @returns {string} */
const echapper = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Une couleur de réglage n'entre dans un e-mail que sous la forme `#rgb` ou `#rrggbb`.
 * @param {unknown} valeur
 * @param {string} repli couleur rendue quand la valeur est absente ou mal formée
 * @returns {string}
 */
export function couleurValide(valeur, repli) {
  return typeof valeur === 'string' && COULEUR_RE.test(valeur.trim()) ? valeur.trim() : repli;
}

/**
 * Les valeurs de marque d'une entreprise, par variable `{{…}}` : exactement `VARIABLES_MARQUE` de
 * `emailsAutomatiques.js`. Défauts neutres (nom vide, couleurs `DEFAUTS_MARQUE`).
 * @param {Record<string, any> | null | undefined} reglages réglages de l'organisation
 * @returns {Record<string, string>}
 */
export function valeursDeMarque(reglages) {
  const s = reglages ?? {};
  return {
    '{{BRAND_NAME}}': texte(s.brand_name),
    '{{ORG_EMAIL}}': resoudreExpediteur(s).contactEmail,
    '{{ORG_PHONE}}': texte(s.phone),
    '{{ORG_ADDRESS}}': texte(s.address),
    '{{ORG_POSTAL_CODE}}': texte(s.postal_code),
    '{{ORG_CITY}}': texte(s.city),
    '{{ORG_WEBSITE_URL}}': texte(s.website_url),
    '{{ACCENT_COLOR}}': couleurValide(s.accent_color, DEFAUTS_MARQUE.accent),
    '{{SECONDARY_COLOR}}': couleurValide(s.secondary_color, DEFAUTS_MARQUE.bandeau),
    '{{EMAIL_TAGLINE}}': texte(s.email_tagline),
    '{{LOGO_URL}}': texte(s.logo_url),
  };
}

/** @param {unknown} v @param {boolean} defaut @returns {boolean} */
const booleen = (v, defaut) => (typeof v === 'boolean' ? v : defaut);

/**
 * Le choix d'habillage enregistré, ou `null` s'il n'y en a pas (`email_habillage` n'est pas un objet).
 * Une valeur inconnue est ramenée au défaut.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {ChoixHabillage | null}
 */
export function lireHabillage(reglages) {
  const h = reglages?.email_habillage;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const p = h.pied && typeof h.pied === 'object' ? h.pied : {};
  return {
    entete: h.entete === 'logo_bandeau' ? 'logo_bandeau' : 'logo',
    pied: {
      coordonnees: booleen(p.coordonnees, HABILLAGE_DEFAUT.pied.coordonnees),
      certifications: booleen(p.certifications, HABILLAGE_DEFAUT.pied.certifications),
      site: booleen(p.site, HABILLAGE_DEFAUT.pied.site),
    },
  };
}

/**
 * Ce que l'écran présélectionne : le choix enregistré ; à défaut, un équivalent de l'ancien habillage
 * (bandeau, coordonnées, site) quand l'entreprise en a un ; sinon le défaut.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {ChoixHabillage}
 */
export function choixDepuisReglages(reglages) {
  const enregistre = lireHabillage(reglages);
  if (enregistre) return enregistre;
  if (texte(reglages?.email_skeleton_html)) {
    return { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: false, site: true } };
  }
  return { entete: HABILLAGE_DEFAUT.entete, pied: { ...HABILLAGE_DEFAUT.pied } };
}

/**
 * Le corps porte-t-il déjà un lien de désabonnement (`mailto:…?subject=Désabonnement`, accent ou non) ?
 * @param {string} corps
 * @returns {boolean}
 */
export function aDejaDesabonnement(corps) {
  return DESABONNEMENT_RE.test(String(corps ?? ''));
}

/** Certifications lisibles : seulement des textes non vides. @param {unknown} v @returns {string[]} */
function certificationsDe(v) {
  return Array.isArray(v) ? v.map(texte).filter(Boolean) : [];
}

/**
 * Habillage construit : tableaux, styles en ligne, 600 px, Arial. Les valeurs de l'entreprise sont
 * posées ici, échappées ; le corps est inséré tel quel.
 * @param {Record<string, any>} s
 * @param {ChoixHabillage} choix
 * @param {string} corps
 * @returns {string}
 */
function habillageConstruit(s, choix, corps) {
  const v = valeursDeMarque(s);
  const nom = echapper(v['{{BRAND_NAME}}']);
  const accent = v['{{ACCENT_COLOR}}'];
  const bandeau = v['{{SECONDARY_COLOR}}'];
  const logoUrl = v['{{LOGO_URL}}'];
  const logo = /^https:\/\//i.test(logoUrl)
    ? `<img src="${echapper(logoUrl)}" alt="${nom}" style="max-height:56px;max-width:220px;">`
    : (nom ? `<span style="font-size:18px;font-weight:600;color:#0f172a;">${nom}</span>` : '');

  const phrase = v['{{EMAIL_TAGLINE}}'];
  const avecBandeau = choix.entete === 'logo_bandeau' && phrase;

  const adresse = [v['{{ORG_ADDRESS}}'], [v['{{ORG_POSTAL_CODE}}'], v['{{ORG_CITY}}']].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const lignes = [];
  if (choix.pied.coordonnees) {
    const coords = [v['{{BRAND_NAME}}'], adresse, v['{{ORG_PHONE}}'], v['{{ORG_EMAIL}}']].filter(Boolean).map(echapper).join(' · ');
    if (coords) lignes.push(coords);
  }
  if (choix.pied.certifications) {
    const certifs = certificationsDe(s.rge_certifications).map(echapper).join(' · ');
    if (certifs) lignes.push(certifs);
  }
  const site = v['{{ORG_WEBSITE_URL}}'];
  if (choix.pied.site && /^https?:\/\//i.test(site)) {
    lignes.push(`<a href="${echapper(site)}" style="color:${accent};text-decoration:underline;">${echapper(site.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`);
  }
  // Le lien de désabonnement est toujours là, sauf si le corps porte déjà le sien.
  if (!aDejaDesabonnement(corps)) {
    lignes.push(`<a href="mailto:${echapper(v['{{ORG_EMAIL}}'])}?subject=Désabonnement" style="color:${accent};text-decoration:underline;">Se désabonner</a>`);
  }
  const pied = lignes.join('<br>');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f1f5f9;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e293b;">`
    + (logo ? `<tr><td style="padding:24px 28px 0 28px;">${logo}</td></tr>` : '')
    + (avecBandeau ? `<tr><td style="padding:12px 28px;background:${bandeau};color:#ffffff;font-size:14px;">${echapper(phrase)}</td></tr>` : '')
    + `<tr><td style="padding:24px 28px;">${corps}</td></tr>`
    + (pied ? `<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">${pied}</td></tr>` : '')
    + `</table></td></tr></table></body></html>`;
}

/**
 * Habille le corps d'un e-mail : les quatre cas de la conception § 5.1, dans l'ordre.
 * @param {Record<string, any> | null | undefined} reglages réglages de l'organisation
 * @param {string} corps HTML du corps, inséré sans être touché
 * @returns {string} HTML complet
 */
export function habillerMail(reglages, corps) {
  const s = reglages ?? {};
  const texteCorps = String(corps ?? '');
  if (PAGE_COMPLETE_RE.test(texteCorps)) return texteCorps;
  const choix = lireHabillage(s);
  if (choix) return habillageConstruit(s, choix, texteCorps);
  const ancien = typeof s.email_skeleton_html === 'string' ? s.email_skeleton_html : '';
  if (ancien.includes('{{EMAIL_BODY}}')) return ancien.replace('{{EMAIL_BODY}}', () => texteCorps);
  return habillageConstruit(s, { entete: HABILLAGE_DEFAUT.entete, pied: { ...HABILLAGE_DEFAUT.pied } }, texteCorps);
}
