// src/lib/mailHabillageEcran.js
// ============================================================================
// Règles de l'écran « Habillage des e-mails » (Réglages → E-mails & SMS → E-mails,
// spec 2026-11-21-createur-mail-une-page-habillage-design.md § 5.1). Module PUR,
// testé `scripts/mail-habillage-ecran.test.mjs`. NON copié pour Deno : l'écran seul
// s'en sert ; la règle de l'envoi reste `habillerMail` (`mailHabillage.js`).
//
// Le formulaire : { entete, phrase, couleurBandeau, couleurBoutons, logo, boutonBandeau, pied, blocs }
// (spec 2026-11-22-reglages-emails-chapitres-habillage-enrichi-design.md § 3). Une couleur
// vide veut dire « la couleur par défaut » et s'enregistre `null` (lu comme absent par
// `valeursDeMarque`). L'écran n'écrit QUE `email_habillage`, `accent_color`,
// `secondary_color`, `email_tagline` — jamais `email_skeleton_html` (l'ancien habillage
// reste en base, on peut y revenir).
// ============================================================================
import {
  adresseSure, choixDepuisReglages, couleurValide, lireHabillage, valeursDeMarque, BLOCS_MAX, BORNES_HABILLAGE,
  DEFAUTS_MARQUE, RESEAUX,
} from './mailHabillage.js';
import { contraste } from './pagePublique.js';
import { normaliser } from './mailCorps.js';
import { adresseDeLienValide } from './mailLien.js';

export { BLOCS_MAX, BORNES_HABILLAGE, RESEAUX };

/**
 * @typedef {{ libelle: string, adresse: string }} BoutonSaisi
 * @typedef {{ titre: string, texte: string, bouton: BoutonSaisi, ou: 'campagnes' | 'tous' }} BlocSaisi
 * @typedef {{
 *   coordonnees: boolean, certifications: boolean, site: boolean, horaires: string, texte: string,
 *   fond: 'clair' | 'bandeau', reseaux: { facebook: string, instagram: string, avis_google: string, linkedin: string },
 * }} PiedSaisi
 * @typedef {{
 *   entete: 'logo' | 'logo_bandeau', phrase: string, couleurBandeau: string, couleurBoutons: string,
 *   logo: { position: 'gauche' | 'centre', taille: 'petit' | 'moyen' | 'grand' }, boutonBandeau: BoutonSaisi,
 *   pied: PiedSaisi, blocs: BlocSaisi[],
 * }} FormulaireHabillage
 */

/** Les deux aperçus proposés à l'écran, défaut en premier (`usage` de `rendreApercu`). */
export const USAGES_APERCU = Object.freeze([
  Object.freeze({ cle: 'campagne', libelle: 'Aperçu d’une campagne' }),
  Object.freeze({ cle: 'individuel', libelle: 'Aperçu d’un e-mail automatique' }),
]);

/** Où un bloc fixe apparaît, défaut en premier. */
export const OU_BLOC = Object.freeze([
  Object.freeze({ cle: 'campagnes', libelle: 'Sur vos campagnes seulement' }),
  Object.freeze({ cle: 'tous', libelle: 'Sur tous vos e-mails, y compris les e-mails automatiques' }),
]);

/** Seuil de lecture d'un texte blanc sur un bouton (même seuil que `teintesDeMarque`). */
export const SEUIL_LISIBLE = 4.5;

const COULEUR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Couleurs proposées pour les boutons et les liens : sobres, toutes lisibles en texte blanc (4,5:1, testé).
 * @type {ReadonlyArray<{ nom: string, couleur: string }>}
 */
export const PASTILLES_BOUTONS = Object.freeze([
  { nom: 'Ardoise', couleur: '#475569' },
  { nom: 'Bleu', couleur: '#1d4ed8' },
  { nom: 'Bleu pétrole', couleur: '#0f766e' },
  { nom: 'Vert', couleur: '#15803d' },
  { nom: 'Orange brûlé', couleur: '#c2410c' },
  { nom: 'Rouge brique', couleur: '#b91c1c' },
  { nom: 'Bordeaux', couleur: '#9f1239' },
  { nom: 'Violet', couleur: '#7e22ce' },
]);

/**
 * Couleurs proposées pour le bandeau : la même famille, plus foncée (même ordre que `PASTILLES_BOUTONS`).
 * @type {ReadonlyArray<{ nom: string, couleur: string }>}
 */
export const PASTILLES_BANDEAU = Object.freeze([
  { nom: 'Ardoise foncé', couleur: '#1e293b' },
  { nom: 'Bleu nuit', couleur: '#1e3a8a' },
  { nom: 'Pétrole foncé', couleur: '#134e4a' },
  { nom: 'Vert sapin', couleur: '#14532d' },
  { nom: 'Brun', couleur: '#7c2d12' },
  { nom: 'Rouge sombre', couleur: '#7f1d1d' },
  { nom: 'Bordeaux foncé', couleur: '#881337' },
  { nom: 'Violet foncé', couleur: '#581c87' },
]);

/** Objet du mail d'exemple de l'aperçu. */
export const OBJET_EXEMPLE = 'Votre entretien annuel approche';

/** Texte du mail d'exemple, au format enregistré (passé par `normaliser`, jamais écrit à la main). */
export const TEXTE_EXEMPLE = normaliser(
  '<h2>Votre entretien annuel approche</h2>'
  + '<p>{{SALUTATION}}</p>'
  + '<p>L’entretien de votre appareil arrive à échéance. Vous trouverez <a href="https://exemple.fr">le détail de votre contrat</a> dans votre espace.</p>'
  + '<div data-encadre><p>Un entretien régulier garde votre appareil sûr et économe, et maintient sa garantie.</p></div>'
  + '<p><a data-bouton href="https://exemple.fr">Choisir mon rendez-vous</a></p>'
  + '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
);

/** @param {unknown} v @returns {string} */
const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/** Texte d'une zone de saisie : rogné, retours à la ligne normalisés. @param {unknown} v @returns {string} */
const texteLignes = (v) => texte(v).replace(/\r\n?/g, '\n');

/** @param {any} v @returns {BoutonSaisi} */
const boutonSaisi = (v) => ({ libelle: texte(v?.libelle), adresse: texte(v?.adresse) });

/** Un bloc fixe vierge (« Sur vos campagnes seulement »). @returns {BlocSaisi} */
export function blocVide() {
  return { titre: '', texte: '', bouton: { libelle: '', adresse: '' }, ou: 'campagnes' };
}

/** @param {BlocSaisi} b */
const blocEstVide = (b) => !texte(b?.titre) && !texte(b?.texte) && !texte(b?.bouton?.libelle) && !texte(b?.bouton?.adresse);

/**
 * Le formulaire tel que l'écran l'ouvre : le choix enregistré, sinon un équivalent de l'ancien
 * habillage, sinon le défaut (`choixDepuisReglages`) ; phrase et couleurs telles qu'enregistrées.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {FormulaireHabillage}
 */
export function formulaireInitial(reglages) {
  const s = reglages ?? {};
  // Même test « ancien habillage » que `situationHabillage` (et que l'envoi) : un ancien habillage sans
  // emplacement du texte n'est pas utilisé, l'écran part donc du défaut.
  const choix = lireHabillage(s) ?? choixDepuisReglages(aUnAncienHabillage(s) ? s : {});
  return {
    entete: choix.entete,
    phrase: texte(s.email_tagline),
    couleurBandeau: texte(s.secondary_color),
    couleurBoutons: texte(s.accent_color),
    logo: { ...choix.logo },
    boutonBandeau: boutonSaisi(choix.bouton_bandeau),
    pied: { ...choix.pied, reseaux: { ...choix.pied.reseaux } },
    blocs: choix.blocs.map((b) => ({ titre: b.titre, texte: b.texte, bouton: boutonSaisi(b.bouton), ou: b.ou })),
  };
}

/**
 * L'ancien habillage n'est utilisé à l'envoi que s'il porte l'emplacement du texte (même test que `habillerMail`).
 * @param {Record<string, any>} s
 */
const aUnAncienHabillage = (s) => typeof s.email_skeleton_html === 'string' && s.email_skeleton_html.includes('{{EMAIL_BODY}}');

/**
 * Où en est l'entreprise : ancien habillage en place, choix enregistré, confirmation du premier
 * enregistrement (il remplace l'ancien habillage), retour possible à l'ancien.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {{ ancien: boolean, choixEnregistre: boolean, remplacementAConfirmer: boolean, retourPossible: boolean }}
 */
export function situationHabillage(reglages) {
  const s = reglages ?? {};
  const ancien = aUnAncienHabillage(s);
  const choixEnregistre = lireHabillage(s) !== null;
  return { ancien, choixEnregistre, remplacementAConfirmer: ancien && !choixEnregistre, retourPossible: ancien && choixEnregistre };
}

/**
 * La couleur du bandeau sert-elle ? Avec « Logo et bandeau », ou un pied de page sur la couleur du bandeau.
 * @param {{ entete?: string, pied?: { fond?: string } }} form
 * @returns {boolean}
 */
export function couleurBandeauUtilisee(form) {
  return form.entete === 'logo_bandeau' || form.pied?.fond === 'bandeau';
}

/**
 * Verdict sur une adresse saisie (bouton, réseau) : `null` si elle est vide ou acceptée, sinon sa raison et,
 * pour un domaine nu, l'adresse complète proposée.
 * @param {unknown} valeur
 * @returns {{ message: string, suggestion?: string } | null}
 */
function verdictAdresse(valeur) {
  const a = texte(valeur);
  if (!a) return null;
  const v = adresseDeLienValide(a, []);
  if (!v.valide) return v.suggestion ? { message: v.message, suggestion: v.suggestion } : { message: v.message };
  if (adresseSure(a)) return null;
  if (/subject=D[eé]sabonnement/i.test(a)) return { message: 'Le lien pour se désabonner est déjà dans le pied de page.' };
  if (a.length > BORNES_HABILLAGE.adresse) return { message: `Cette adresse dépasse ${BORNES_HABILLAGE.adresse} caractères.` };
  return { message: 'Cette adresse n’est pas acceptée : saisissez-la sans espace.' };
}

/**
 * Verdict sur un bouton : texte ET adresse, ou ni l'un ni l'autre.
 * @param {BoutonSaisi | null | undefined} bouton
 * @returns {{ message: string, suggestion?: string } | null}
 */
function verdictBouton(bouton) {
  const libelle = texte(bouton?.libelle);
  const adresse = texte(bouton?.adresse);
  if (!libelle && !adresse) return null;
  if (!adresse) return { message: 'Indiquez l’adresse du bouton.' };
  if (libelle.length > BORNES_HABILLAGE.libelle) return { message: `Le texte du bouton dépasse ${BORNES_HABILLAGE.libelle} caractères.` };
  const v = verdictAdresse(adresse);
  if (v) return v;
  return libelle ? null : { message: 'Indiquez le texte du bouton.' };
}

/**
 * Chaque champ refusé, avec son verdict. Clés : `couleurBandeau`, `couleurBoutons`, `boutonBandeau`,
 * `reseaux.<réseau>`, `pied.horaires`, `pied.texte`, `bloc.<n>.titre` / `.texte` / `.bouton`.
 * @param {FormulaireHabillage} form
 * @returns {Record<string, { message: string, suggestion?: string }>}
 */
function verdictsFormulaire(form) {
  /** @type {Record<string, { message: string, suggestion?: string }>} */
  const v = {};
  for (const cle of /** @type {const} */ (['couleurBandeau', 'couleurBoutons'])) {
    // Ni bandeau ni pied sur sa couleur : la couleur du bandeau ne sert pas, son erreur ne bloque rien (`couleurBandeauEcrite`).
    if (cle === 'couleurBandeau' && !couleurBandeauUtilisee(form)) continue;
    const c = texte(form[cle]);
    if (c && !COULEUR_RE.test(c)) v[cle] = { message: 'Couleur illisible : écrivez-la sous la forme #1e3a8a, ou choisissez-la dans la palette.' };
  }
  // « Logo seul » : le bouton du bandeau ne sert pas non plus (`boutonBandeauEcrit`).
  const bouton = form.entete === 'logo_bandeau' ? verdictBouton(form.boutonBandeau) : null;
  if (bouton) v.boutonBandeau = bouton;
  for (const r of RESEAUX) {
    const verdict = verdictAdresse(form.pied?.reseaux?.[/** @type {keyof PiedSaisi['reseaux']} */ (r.cle)]);
    if (verdict) v[`reseaux.${r.cle}`] = verdict;
  }
  if (texteLignes(form.pied?.horaires).length > BORNES_HABILLAGE.horaires) {
    v['pied.horaires'] = { message: `Les horaires dépassent ${BORNES_HABILLAGE.horaires} caractères.` };
  }
  if (texteLignes(form.pied?.texte).length > BORNES_HABILLAGE.ligneLibre) {
    v['pied.texte'] = { message: `Cette ligne dépasse ${BORNES_HABILLAGE.ligneLibre} caractères.` };
  }
  (form.blocs ?? []).forEach((b, i) => {
    if (texte(b?.titre).length > BORNES_HABILLAGE.titre) v[`bloc.${i}.titre`] = { message: `Le titre dépasse ${BORNES_HABILLAGE.titre} caractères.` };
    if (texteLignes(b?.texte).length > BORNES_HABILLAGE.texteBloc) v[`bloc.${i}.texte`] = { message: `Le texte dépasse ${BORNES_HABILLAGE.texteBloc} caractères.` };
    const vb = verdictBouton(b?.bouton);
    if (vb) v[`bloc.${i}.bouton`] = vb;
  });
  return v;
}

/**
 * Champs refusés, avec leur raison (clés de `verdictsFormulaire`). Une couleur vide est acceptée (couleur par
 * défaut), une adresse vide aussi (l'élément n'est pas affiché).
 * @param {FormulaireHabillage} form
 * @returns {Record<string, string>}
 */
export function erreursFormulaire(form) {
  return Object.fromEntries(Object.entries(verdictsFormulaire(form)).map(([cle, v]) => [cle, v.message]));
}

/**
 * Adresses complètes proposées pour une saisie sans « https:// » (mêmes clés que `erreursFormulaire`).
 * @param {FormulaireHabillage} form
 * @returns {Record<string, string>}
 */
export function suggestionsFormulaire(form) {
  return Object.fromEntries(Object.entries(verdictsFormulaire(form))
    .filter(([, v]) => v.suggestion).map(([cle, v]) => [cle, /** @type {string} */ (v.suggestion)]));
}

/** Les erreurs portent-elles sur une couleur ? @param {Record<string, string>} erreurs */
const erreurDeCouleur = (erreurs) => !!(erreurs.couleurBandeau || erreurs.couleurBoutons);

/** Couleur comparée et écrite en minuscules (le sélecteur natif rend des minuscules). @param {unknown} v */
const couleurNormalisee = (v) => texte(v).toLowerCase();

/**
 * Forme comparée et enregistrée du formulaire (espaces retirés, couleurs en minuscules, blocs vides écartés).
 * @param {FormulaireHabillage} form
 */
function normaliserFormulaire(form) {
  const p = form.pied;
  const taille = form.logo?.taille;
  return {
    entete: form.entete === 'logo_bandeau' ? 'logo_bandeau' : 'logo',
    phrase: texte(form.phrase),
    couleurBandeau: couleurNormalisee(form.couleurBandeau),
    couleurBoutons: couleurNormalisee(form.couleurBoutons),
    logo: {
      position: form.logo?.position === 'centre' ? 'centre' : 'gauche',
      taille: taille === 'petit' || taille === 'grand' ? taille : 'moyen',
    },
    boutonBandeau: boutonSaisi(form.boutonBandeau),
    pied: {
      coordonnees: !!p?.coordonnees, certifications: !!p?.certifications, site: !!p?.site,
      horaires: texteLignes(p?.horaires), texte: texteLignes(p?.texte), fond: p?.fond === 'bandeau' ? 'bandeau' : 'clair',
      reseaux: {
        facebook: texte(p?.reseaux?.facebook), instagram: texte(p?.reseaux?.instagram),
        avis_google: texte(p?.reseaux?.avis_google), linkedin: texte(p?.reseaux?.linkedin),
      },
    },
    blocs: (form.blocs ?? []).filter((b) => !blocEstVide(b)).map((b) => ({
      titre: texte(b.titre), texte: texteLignes(b.texte), bouton: boutonSaisi(b.bouton), ou: b.ou === 'tous' ? 'tous' : 'campagnes',
    })),
  };
}

/**
 * Le formulaire diffère-t-il de ce qui a été ouvert ? Sans changement, « Enregistrer » reste fermé.
 * @param {FormulaireHabillage} form
 * @param {FormulaireHabillage} initial
 * @returns {boolean}
 */
export function estModifie(form, initial) {
  return JSON.stringify(normaliserFormulaire(form)) !== JSON.stringify(normaliserFormulaire(initial));
}

/**
 * Ce que l'écran enregistre : exactement quatre clés, `email_habillage` entier (fusion de niveau 1).
 * Lève sur une couleur mal formée : elle n'arrive jamais jusqu'à l'enregistrement.
 * @param {FormulaireHabillage} form
 * @param {Record<string, any> | null} [reglages] réglages en base (couleur du bandeau gardée avec « Logo seul »)
 * @returns {{ email_habillage: Record<string, any>, accent_color: string | null, secondary_color: string | null, email_tagline: string | null }}
 */
export function patchAEnregistrer(form, reglages = null) {
  const erreurs = erreursFormulaire(form);
  if (Object.keys(erreurs).length) throw new Error(erreurDeCouleur(erreurs) ? 'couleur_mal_formee' : 'saisie_invalide');
  return quatreCles(normaliserFormulaire(form), reglages);
}

/** Bouton écrit : `null` quand il manque son texte ou son adresse. @param {BoutonSaisi} b */
const boutonEcrit = (b) => (b.libelle && b.adresse ? { libelle: b.libelle, adresse: b.adresse } : null);

/**
 * Bouton du bandeau à écrire : la saisie si elle est acceptée ; avec « Logo seul » et une saisie refusée (le bouton
 * ne sert pas, son erreur est ignorée), le dernier bouton enregistré valide — jamais la saisie.
 * @param {ReturnType<typeof normaliserFormulaire>} f
 * @param {Record<string, any> | null | undefined} reglages
 */
function boutonBandeauEcrit(f, reglages) {
  if (!verdictBouton(f.boutonBandeau)) return boutonEcrit(f.boutonBandeau);
  return lireHabillage(reglages)?.bouton_bandeau ?? null;
}

/**
 * Couleur du bandeau à écrire : la saisie si elle est bien formée ; avec « Logo seul » et une saisie mal formée
 * (la couleur ne sert pas, son erreur est ignorée), la dernière valeur enregistrée valide — jamais la saisie.
 * @param {ReturnType<typeof normaliserFormulaire>} f
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {string | null}
 */
function couleurBandeauEcrite(f, reglages) {
  if (!f.couleurBandeau || COULEUR_RE.test(f.couleurBandeau)) return f.couleurBandeau || null;
  return couleurNormalisee(couleurValide(reglages?.secondary_color, '')) || null;
}

/** @param {ReturnType<typeof normaliserFormulaire>} f @param {Record<string, any> | null | undefined} reglages */
function quatreCles(f, reglages) {
  return {
    email_habillage: {
      entete: f.entete,
      logo: f.logo,
      bouton_bandeau: boutonBandeauEcrit(f, reglages),
      pied: f.pied,
      blocs: f.blocs.map((b) => ({ titre: b.titre, texte: b.texte, bouton: boutonEcrit(b.bouton), ou: b.ou })),
    },
    accent_color: f.couleurBoutons || null,
    secondary_color: couleurBandeauEcrite(f, reglages),
    email_tagline: f.phrase || null,
  };
}

/**
 * Peut-on enregistrer ? Couleurs valides, et un changement — ou une entreprise à l'ancien habillage sans choix :
 * enregistrer tel quel remplace alors l'habillage de tous ses e-mails, c'est un vrai changement.
 * @param {FormulaireHabillage} form
 * @param {FormulaireHabillage} initial
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {boolean}
 */
export function peutEnregistrer(form, initial, reglages) {
  const valide = Object.keys(erreursFormulaire(form)).length === 0;
  return valide && (estModifie(form, initial) || situationHabillage(reglages).remplacementAConfirmer);
}

/**
 * Pourquoi « Enregistrer » est fermé, ou `null` s'il est ouvert.
 * @param {FormulaireHabillage} form
 * @param {FormulaireHabillage} initial
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {string | null}
 */
export function raisonFermeture(form, initial, reglages) {
  const erreurs = erreursFormulaire(form);
  if (erreurDeCouleur(erreurs)) return 'Corrigez la couleur avant d’enregistrer.';
  if (Object.keys(erreurs).length) return 'Corrigez les champs signalés avant d’enregistrer.';
  return peutEnregistrer(form, initial, reglages) ? null : 'Aucune modification.';
}

/**
 * Libellé du bouton : « Adopter cet habillage » tant que l'ancien habillage est en place sans choix enregistré.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {string}
 */
export function libelleEnregistrer(reglages) {
  return situationHabillage(reglages).remplacementAConfirmer ? 'Adopter cet habillage' : 'Enregistrer';
}

/** Réglages dont dépend l'écran (formulaire, situation, logo). */
const CLES_HABILLAGE = ['email_habillage', 'accent_color', 'secondary_color', 'email_tagline', 'email_skeleton_html', 'logo_url'];

/**
 * Empreinte des réglages dont dépend l'écran : elle ne change que si l'habillage enregistré change (un autre
 * réglage écrit ailleurs ne doit pas réinitialiser le formulaire).
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {string}
 */
export function empreinteHabillage(reglages) {
  const s = reglages ?? {};
  return JSON.stringify(CLES_HABILLAGE.map((cle) => s[cle] ?? null));
}

/**
 * Les réglages tels qu'ils seront une fois l'écran enregistré — ce que l'aperçu habille.
 * Une couleur mal formée en cours de saisie est rendue comme à l'envoi : couleur par défaut.
 * @param {Record<string, any> | null | undefined} reglages
 * @param {FormulaireHabillage} form
 * @returns {Record<string, any>}
 */
export function reglagesApresEnregistrement(reglages, form) {
  return { ...(reglages ?? {}), ...quatreCles(normaliserFormulaire(form), reglages) };
}

/**
 * Réglages que l'aperçu habille : ceux en base quand « Voir l'habillage actuel » est demandé (seulement tant que
 * l'ancien habillage est en place sans choix), sinon ceux d'après l'enregistrement.
 * @param {Record<string, any> | null | undefined} reglages
 * @param {FormulaireHabillage} form
 * @param {boolean} voirActuel
 * @returns {Record<string, any>}
 */
export function reglagesDeLApercu(reglages, form, voirActuel) {
  if (voirActuel && situationHabillage(reglages).remplacementAConfirmer) return reglages ?? {};
  return reglagesApresEnregistrement(reglages, form);
}

const VERS_COORDONNEES = { vers: '/settings/organization?tab=contact', libelle: 'Organisation → Coordonnées' };
const VERS_IDENTITE = { vers: '/settings/organization?tab=identity', libelle: 'Organisation → Identité' };

/**
 * Chaque choix du pied de page : y a-t-il quelque chose à montrer, sinon pourquoi et où le renseigner.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {Record<'coordonnees' | 'certifications' | 'site', { disponible: boolean, raison: string | null, lien: { vers: string, libelle: string } }>}
 */
export function piedDisponible(reglages) {
  const s = reglages ?? {};
  const v = valeursDeMarque(s);
  const coords = ['{{BRAND_NAME}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_PHONE}}', '{{ORG_EMAIL}}']
    .some((cle) => v[cle]);
  const certifs = Array.isArray(s.rge_certifications) && s.rge_certifications.some((c) => texte(c));
  const site = /^https?:\/\//i.test(v['{{ORG_WEBSITE_URL}}']);
  return {
    coordonnees: { disponible: coords, raison: coords ? null : 'Aucune coordonnée enregistrée.', lien: VERS_COORDONNEES },
    certifications: { disponible: certifs, raison: certifs ? null : 'Aucune certification enregistrée.', lien: VERS_IDENTITE },
    site: { disponible: site, raison: site ? null : 'Aucun site internet enregistré.', lien: VERS_COORDONNEES },
  };
}

/** `#rgb` ou `#rrggbb` → [r, g, b]. @param {string} c @returns {number[]} */
function lireHex(c) {
  const h = c.slice(1).length === 3 ? c.slice(1).replace(/./g, (x) => x + x) : c.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** @param {number[]} rgb @returns {string} */
const versHex = (rgb) => `#${rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

/**
 * La couleur qu'un sélecteur natif peut afficher (`#rrggbb`) : la couleur saisie, sinon celle qui partira.
 * @param {string} valeur
 * @param {string} repli
 * @returns {string}
 */
export function couleurPourSelecteur(valeur, repli) {
  return versHex(lireHex(couleurValide(valeur, repli)));
}

/**
 * Un texte blanc se lit-il sur la couleur des boutons ? Sinon, la même teinte assombrie jusqu'à se lire.
 * Jugée sur la couleur qui partira (vide ou mal formée ⇒ couleur par défaut).
 * @param {string} valeur
 * @returns {{ couleur: string, ratio: number, lisible: boolean, suggestion: string | null }}
 */
export function lisibiliteBoutons(valeur) {
  const couleur = couleurValide(valeur, DEFAUTS_MARQUE.accent);
  const ratio = contraste(couleur, '#ffffff');
  if (ratio >= SEUIL_LISIBLE) return { couleur, ratio, lisible: true, suggestion: null };
  let rgb = lireHex(couleur);
  for (let i = 0; i < 40; i += 1) {
    rgb = rgb.map((x) => x * 0.94);
    if (contraste(versHex(rgb), '#ffffff') >= SEUIL_LISIBLE) return { couleur, ratio, lisible: false, suggestion: versHex(rgb) };
  }
  return { couleur, ratio, lisible: false, suggestion: null };
}

/**
 * Le logo tel que l'habillage l'utilise : seulement une adresse `https` ; sinon le nom est écrit.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {{ url: string | null, nom: string }}
 */
export function logoAffiche(reglages) {
  const url = texte(reglages?.logo_url);
  return { url: /^https:\/\//i.test(url) ? url : null, nom: texte(reglages?.brand_name) };
}

/**
 * Ce que l'écran dit du logo : `absent` (le nom est écrit), `non_sur` (adresse hors https, non utilisée), ou `null`.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {'absent' | 'non_sur' | null}
 */
export function ligneLogo(reglages) {
  if (!texte(reglages?.logo_url)) return 'absent';
  return logoAffiche(reglages).url ? null : 'non_sur';
}

/**
 * Le bandeau est-il dessiné ? Seulement avec « Logo et bandeau » ET une phrase (même règle que l'envoi).
 * @param {{ entete: string, phrase: string }} form
 * @returns {boolean}
 */
export function bandeauVisible(form) {
  return form.entete === 'logo_bandeau' && !!texte(form.phrase);
}

/**
 * Peut-on ajouter un bloc fixe ? Deux au plus.
 * @param {FormulaireHabillage} form
 * @returns {boolean}
 */
export function peutAjouterBloc(form) {
  return (form.blocs ?? []).length < BLOCS_MAX;
}

/**
 * Le formulaire avec un bloc vierge de plus (inchangé s'il y en a déjà deux).
 * @param {FormulaireHabillage} form
 * @returns {FormulaireHabillage}
 */
export function ajouterBloc(form) {
  return peutAjouterBloc(form) ? { ...form, blocs: [...(form.blocs ?? []), blocVide()] } : form;
}

/**
 * Le formulaire sans le bloc `index`.
 * @param {FormulaireHabillage} form
 * @param {number} index
 * @returns {FormulaireHabillage}
 */
export function retirerBloc(form, index) {
  return { ...form, blocs: (form.blocs ?? []).filter((_, i) => i !== index) };
}

/**
 * Le formulaire avec le bloc `index` remonté d'un rang (inchangé pour le premier).
 * @param {FormulaireHabillage} form
 * @param {number} index
 * @returns {FormulaireHabillage}
 */
export function monterBloc(form, index) {
  const blocs = [...(form.blocs ?? [])];
  if (index <= 0 || index >= blocs.length) return form;
  [blocs[index - 1], blocs[index]] = [blocs[index], blocs[index - 1]];
  return { ...form, blocs };
}

/**
 * Le formulaire avec le bloc `index` modifié (fusion de niveau 1 : `bouton` se passe entier).
 * @param {FormulaireHabillage} form
 * @param {number} index
 * @param {Partial<BlocSaisi>} modif
 * @returns {FormulaireHabillage}
 */
export function modifierBloc(form, index, modif) {
  return { ...form, blocs: (form.blocs ?? []).map((b, i) => (i === index ? { ...b, ...modif } : b)) };
}
