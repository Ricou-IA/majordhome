// src/lib/mailHabillage.js
// ============================================================================
// L'habillage de tous les e-mails de l'application — SEULE définition (spec
// 2026-11-21-createur-mail-une-page-habillage-design.md § 5.1, enrichi par
// 2026-11-22-reglages-emails-chapitres-habillage-enrichi-design.md § 2). Module PUR : aucun import hors
// modules voisins, copié pour Deno par `npm run sync:tournee-engine`, testé
// `scripts/mail-habillage.test.mjs`. Utilisé par l'aperçu et par les edges.
//
// `habillerMail(reglages, corps, options?)` décide, dans cet ordre :
//   1. le corps est déjà une page complète → rendu tel quel ;
//   2. `email_habillage` est un objet → habillage construit depuis ses choix ;
//   3. `email_skeleton_html` contient `{{EMAIL_BODY}}` → ancien habillage de l'entreprise ;
//   4. sinon → habillage construit avec les choix par défaut.
// Le corps est inséré sans être touché (ses variables restent à remplacer par l'appelant).
// `options.usage` (`campagne` | `individuel`, défaut `individuel`) ne sert qu'à l'habillage construit :
// un bloc fixe « campagnes » n'apparaît que sur une campagne (Mailing : campagnes, séquences, essais).
// Un habillage enregistré sans les clés de 2026-11-22 rend exactement le HTML d'avant (test pinné).
// ============================================================================

import { resoudreExpediteur } from './expediteur.js';

/** Couleurs neutres d'une entreprise qui n'a pas choisi les siennes. */
export const DEFAUTS_MARQUE = Object.freeze({ accent: '#64748b', bandeau: '#334155' });

/** Nombre de blocs fixes au plus. */
export const BLOCS_MAX = 2;

/** Longueurs au plus des textes de l'habillage. */
export const BORNES_HABILLAGE = Object.freeze({ libelle: 40, titre: 80, texteBloc: 300, horaires: 200, ligneLibre: 300, adresse: 500 });

/** Les quatre réseaux, dans l'ordre du pied, avec leur texte de lien. */
export const RESEAUX = Object.freeze([
  Object.freeze({ cle: 'facebook', libelle: 'Facebook' }),
  Object.freeze({ cle: 'instagram', libelle: 'Instagram' }),
  Object.freeze({ cle: 'avis_google', libelle: 'Nos avis Google' }),
  Object.freeze({ cle: 'linkedin', libelle: 'LinkedIn' }),
]);

/** Hauteur et largeur au plus du logo, par taille. */
const TAILLES_LOGO = Object.freeze({
  petit: { hauteur: 40, largeur: 160, police: 16 },
  moyen: { hauteur: 56, largeur: 220, police: 18 },
  grand: { hauteur: 80, largeur: 300, police: 22 },
});

/**
 * @typedef {{ facebook: string, instagram: string, avis_google: string, linkedin: string }} ReseauxHabillage
 * @typedef {{
 *   coordonnees: boolean, certifications: boolean, site: boolean,
 *   horaires: string, texte: string, fond: 'clair' | 'bandeau', reseaux: ReseauxHabillage,
 * }} PiedHabillage
 * @typedef {{ libelle: string, adresse: string }} BoutonHabillage
 * @typedef {{ titre: string, texte: string, bouton: BoutonHabillage | null, ou: 'campagnes' | 'tous' }} BlocHabillage
 * @typedef {{ position: 'gauche' | 'centre', taille: 'petit' | 'moyen' | 'grand' }} LogoHabillage
 * @typedef {{
 *   entete: 'logo' | 'logo_bandeau', logo: LogoHabillage, bouton_bandeau: BoutonHabillage | null,
 *   pied: PiedHabillage, blocs: BlocHabillage[],
 * }} ChoixHabillage
 * @typedef {{ usage?: 'campagne' | 'individuel' }} OptionsHabillage
 */

/** Choix par défaut : logo en tête à gauche, coordonnées en pied, aucun bloc. @type {Readonly<ChoixHabillage>} */
export const HABILLAGE_DEFAUT = Object.freeze({
  entete: 'logo',
  logo: Object.freeze({ position: 'gauche', taille: 'moyen' }),
  bouton_bandeau: null,
  pied: Object.freeze({
    coordonnees: true, certifications: false, site: false, horaires: '', texte: '', fond: 'clair',
    reseaux: Object.freeze({ facebook: '', instagram: '', avis_google: '', linkedin: '' }),
  }),
  blocs: Object.freeze([]),
});

const COULEUR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PAGE_COMPLETE_RE = /<html[\s>]|<!doctype/i;
const DESABONNEMENT_RE = /mailto:[^"'\s>]*\?subject=D[eé]sabonnement/i;
const ADRESSE_RE = /^(?:https?:\/\/|mailto:|tel:)\S+$/i;

/** @param {unknown} v @returns {string} */
const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/** @param {string} s @returns {string} */
const echapper = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** @param {unknown} v @returns {v is Record<string, any>} */
const estObjet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Texte borné, retours à la ligne normalisés. @param {unknown} v @param {number} max @returns {string} */
const borne = (v, max) => texte(v).replace(/\r\n?/g, '\n').slice(0, max);

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
 * L'adresse d'un bouton ou d'un réseau, si elle peut entrer dans un e-mail : `https://`, `http://`, `mailto:`
 * ou `tel:` suivi d'au moins un caractère, sans blanc ni caractère de contrôle, sans `{{`, et jamais un
 * second lien de désabonnement. Sinon `''` : l'élément n'est pas dessiné.
 * @param {unknown} v
 * @returns {string}
 */
export function adresseSure(v) {
  const a = texte(v);
  if (!a || a.length > BORNES_HABILLAGE.adresse) return '';
  // eslint-disable-next-line no-control-regex
  if (!ADRESSE_RE.test(a) || /[\u0000-\u001f\u007f]/.test(a) || a.includes('{{') || DESABONNEMENT_RE.test(a)) return '';
  return a;
}

/** @param {unknown} v @returns {BoutonHabillage | null} */
function boutonDe(v) {
  if (!estObjet(v)) return null;
  const libelle = borne(v.libelle, BORNES_HABILLAGE.libelle);
  const adresse = adresseSure(v.adresse);
  return libelle && adresse ? { libelle, adresse } : null;
}

/** @param {unknown} v @returns {BlocHabillage | null} */
function blocDe(v) {
  if (!estObjet(v)) return null;
  const bloc = {
    titre: borne(v.titre, BORNES_HABILLAGE.titre),
    texte: borne(v.texte, BORNES_HABILLAGE.texteBloc),
    bouton: boutonDe(v.bouton),
    ou: /** @type {'campagnes' | 'tous'} */ (v.ou === 'tous' ? 'tous' : 'campagnes'),
  };
  return bloc.titre || bloc.texte || bloc.bouton ? bloc : null;
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

/** Une copie neuve des choix par défaut (jamais l'objet gelé). @returns {ChoixHabillage} */
function choixParDefaut() {
  const d = HABILLAGE_DEFAUT;
  return {
    entete: d.entete, logo: { ...d.logo }, bouton_bandeau: null,
    pied: { ...d.pied, reseaux: { ...d.pied.reseaux } }, blocs: [],
  };
}

/**
 * Le choix d'habillage enregistré, ou `null` s'il n'y en a pas (`email_habillage` n'est pas un objet).
 * Une valeur inconnue est ramenée au défaut, chaque texte borné, chaque adresse vérifiée (`adresseSure`).
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {ChoixHabillage | null}
 */
export function lireHabillage(reglages) {
  const h = reglages?.email_habillage;
  if (!estObjet(h)) return null;
  const d = HABILLAGE_DEFAUT;
  const p = estObjet(h.pied) ? h.pied : {};
  const l = estObjet(h.logo) ? h.logo : {};
  const r = estObjet(p.reseaux) ? p.reseaux : {};
  return {
    entete: h.entete === 'logo_bandeau' ? 'logo_bandeau' : 'logo',
    logo: {
      position: l.position === 'centre' ? 'centre' : 'gauche',
      taille: l.taille === 'petit' || l.taille === 'grand' ? l.taille : 'moyen',
    },
    bouton_bandeau: boutonDe(h.bouton_bandeau),
    pied: {
      coordonnees: booleen(p.coordonnees, d.pied.coordonnees),
      certifications: booleen(p.certifications, d.pied.certifications),
      site: booleen(p.site, d.pied.site),
      horaires: borne(p.horaires, BORNES_HABILLAGE.horaires),
      texte: borne(p.texte, BORNES_HABILLAGE.ligneLibre),
      fond: p.fond === 'bandeau' ? 'bandeau' : 'clair',
      reseaux: {
        facebook: adresseSure(r.facebook), instagram: adresseSure(r.instagram),
        avis_google: adresseSure(r.avis_google), linkedin: adresseSure(r.linkedin),
      },
    },
    blocs: (Array.isArray(h.blocs) ? h.blocs : []).map(blocDe).filter((b) => b !== null).slice(0, BLOCS_MAX),
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
  const choix = choixParDefaut();
  if (texte(reglages?.email_skeleton_html)) {
    choix.entete = 'logo_bandeau';
    choix.pied.site = true;
  }
  return choix;
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

/** Texte échappé, retours à la ligne en `<br>`. @param {string} s @returns {string} */
const echapperLignes = (s) => echapper(s).replace(/\n/g, '<br>');

/**
 * Le bandeau : sa phrase, et le bouton à droite s'il y en a un.
 * @param {string} bandeau couleur validée
 * @param {string} phrase
 * @param {BoutonHabillage | null} bouton
 * @returns {string}
 */
function ligneBandeau(bandeau, phrase, bouton) {
  const td = `<td style="padding:12px 28px;background:${bandeau};color:#ffffff;font-size:14px;">`;
  if (!bouton) return `<tr>${td}${echapper(phrase)}</td></tr>`;
  return `<tr>${td}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
    + `<td style="color:#ffffff;font-size:14px;">${echapper(phrase)}</td>`
    + `<td align="right" style="padding-left:12px;white-space:nowrap;">`
    + `<a href="${echapper(bouton.adresse)}" style="display:inline-block;padding:6px 12px;border:1px solid #ffffff;border-radius:4px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">${echapper(bouton.libelle)}</a>`
    + `</td></tr></table></td></tr>`;
}

/**
 * Un bloc fixe : encadré clair, titre, texte court, bouton à la couleur des boutons.
 * @param {BlocHabillage} bloc
 * @param {string} accent couleur validée
 * @returns {string}
 */
function ligneBloc(bloc, accent) {
  const parts = [];
  if (bloc.titre) parts.push(`<p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${echapper(bloc.titre)}</p>`);
  if (bloc.texte) parts.push(`<p style="margin:${parts.length ? '6px' : '0'} 0 0 0;color:#334155;">${echapperLignes(bloc.texte)}</p>`);
  if (bloc.bouton) {
    parts.push(`<p style="margin:${parts.length ? '12px' : '0'} 0 0 0;">`
      + `<a href="${echapper(bloc.bouton.adresse)}" style="display:inline-block;padding:10px 18px;background:${accent};color:#ffffff;border-radius:6px;font-weight:600;text-decoration:none;">${echapper(bloc.bouton.libelle)}</a></p>`);
  }
  return `<tr><td style="padding:0 28px 24px 28px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">`
    + `<tr><td style="padding:16px 20px;">${parts.join('')}</td></tr></table></td></tr>`;
}

/**
 * Habillage construit : tableaux, styles en ligne, 600 px, Arial. Les valeurs de l'entreprise sont
 * posées ici, échappées ; le corps est inséré tel quel.
 * @param {Record<string, any>} s
 * @param {ChoixHabillage} choix
 * @param {string} corps
 * @param {'campagne' | 'individuel'} usage
 * @returns {string}
 */
function habillageConstruit(s, choix, corps, usage) {
  const v = valeursDeMarque(s);
  const nom = echapper(v['{{BRAND_NAME}}']);
  const accent = v['{{ACCENT_COLOR}}'];
  const bandeau = v['{{SECONDARY_COLOR}}'];
  const logoUrl = v['{{LOGO_URL}}'];
  const taille = TAILLES_LOGO[choix.logo.taille] ?? TAILLES_LOGO.moyen;
  const logo = /^https:\/\//i.test(logoUrl)
    ? `<img src="${echapper(logoUrl)}" alt="${nom}" style="max-height:${taille.hauteur}px;max-width:${taille.largeur}px;">`
    : (nom ? `<span style="font-size:${taille.police}px;font-weight:600;color:#0f172a;">${nom}</span>` : '');
  const celluleLogo = choix.logo.position === 'centre'
    ? '<td align="center" style="padding:24px 28px 0 28px;text-align:center;">'
    : '<td style="padding:24px 28px 0 28px;">';

  const phrase = v['{{EMAIL_TAGLINE}}'];
  const avecBandeau = choix.entete === 'logo_bandeau' && phrase;

  // Pied à fond « bandeau » : texte et liens blancs (soulignés) sur la couleur du bandeau.
  const surBandeau = choix.pied.fond === 'bandeau';
  const styleLien = `color:${surBandeau ? '#ffffff' : accent};text-decoration:underline;`;

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
  if (choix.pied.horaires) lignes.push(echapperLignes(choix.pied.horaires));
  if (choix.pied.texte) lignes.push(echapperLignes(choix.pied.texte));
  const site = v['{{ORG_WEBSITE_URL}}'];
  if (choix.pied.site && /^https?:\/\//i.test(site)) {
    lignes.push(`<a href="${echapper(site)}" style="${styleLien}">${echapper(site.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`);
  }
  const reseaux = RESEAUX.filter((r) => choix.pied.reseaux[r.cle])
    .map((r) => `<a href="${echapper(choix.pied.reseaux[r.cle])}" style="${styleLien}">${r.libelle}</a>`);
  if (reseaux.length) lignes.push(reseaux.join(' · '));
  // Le lien de désabonnement est toujours là, sauf si le corps porte déjà le sien — ou si
  // l'entreprise n'a aucune adresse (un `mailto:` vide ne mènerait nulle part).
  const contact = v['{{ORG_EMAIL}}'];
  if (contact && !aDejaDesabonnement(corps)) {
    lignes.push(`<a href="mailto:${echapper(contact)}?subject=Désabonnement" style="${styleLien}">Se désabonner</a>`);
  }
  const pied = lignes.join('<br>');
  const cellulePied = surBandeau
    ? `<td style="padding:16px 28px;background:${bandeau};border-radius:0 0 8px 8px;font-size:12px;color:#ffffff;">`
    : '<td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">';

  const blocs = choix.blocs.filter((b) => b.ou === 'tous' || usage === 'campagne').map((b) => ligneBloc(b, accent)).join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f1f5f9;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e293b;">`
    + (logo ? `<tr>${celluleLogo}${logo}</td></tr>` : '')
    + (avecBandeau ? ligneBandeau(bandeau, phrase, choix.bouton_bandeau) : '')
    + `<tr><td style="padding:24px 28px;">${corps}</td></tr>`
    + blocs
    + (pied ? `<tr>${cellulePied}${pied}</td></tr>` : '')
    + `</table></td></tr></table></body></html>`;
}

/**
 * Habille le corps d'un e-mail : les quatre cas de la conception § 5.1, dans l'ordre.
 * @param {Record<string, any> | null | undefined} reglages réglages de l'organisation
 * @param {string} corps HTML du corps, inséré sans être touché
 * @param {OptionsHabillage} [options] `usage: 'campagne'` pour un e-mail du Mailing (défaut `individuel`)
 * @returns {string} HTML complet
 */
export function habillerMail(reglages, corps, options) {
  const s = reglages ?? {};
  const texteCorps = String(corps ?? '');
  const usage = estObjet(options) && options.usage === 'campagne' ? 'campagne' : 'individuel';
  if (PAGE_COMPLETE_RE.test(texteCorps)) return texteCorps;
  const choix = lireHabillage(s);
  if (choix) return habillageConstruit(s, choix, texteCorps, usage);
  const ancien = typeof s.email_skeleton_html === 'string' ? s.email_skeleton_html : '';
  // Fonction de remplacement et non chaîne : `$&`, `$$`… d'un corps resteraient tels quels (différence voulue
  // avec l'ancien `String.replace(…, corps)` des edges, qui les interprétait).
  if (ancien.includes('{{EMAIL_BODY}}')) return ancien.replace('{{EMAIL_BODY}}', () => texteCorps);
  return habillageConstruit(s, choixParDefaut(), texteCorps, usage);
}
