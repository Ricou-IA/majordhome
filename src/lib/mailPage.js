// src/lib/mailPage.js
// ============================================================================
// Règles de la page d'un mail (Mailing → Campagnes → Éditer) — SEULE définition :
// quelles cartes selon la nature du mail, ce qui s'enregistre, quand le nom se fige,
// quand un geste est fermé et pourquoi (phrases montrées telles quelles), ce que la
// rédaction assistée reçoit et comment sa réponse est reprise, l'ancien format.
// Spec docs/superpowers/specs/2026-11-21-createur-mail-une-page-habillage-design.md
// §§ 5.4 à 5.6. Module PUR (imports relatifs), testé `scripts/mail-page.test.mjs`.
// Les composants de `components/mailing/page/` ne calculent rien : tout est ici.
// ============================================================================
import { estEditable, normaliser, texteBrut } from './mailCorps.js';
import {
  natureDuMail, variablesProposees, variablesManquantes, variablesInconnues,
} from './mailVariables.js';
import { CONSIGNES } from './mailRedaction.js';
import { resoudreExpediteur, EXPEDITEUR_REFUS } from './expediteur.js';
import { EMAILS_AUTOMATIQUES } from './emailsAutomatiques.js';
import { SEQUENCES_EMAILS } from './sequencesEmails.js';
import { WEBSHOP_EMAIL_KEYS } from './webshop/emailTemplates.js';

/**
 * @typedef {'manuelle' | 'automatique' | 'sequence' | 'auto_registre' | 'boutique'} NatureMail
 * @typedef {{ destinataires: 'oui' | 'lecture' | 'non', message: 'oui' | 'lecture', envoi: 'complet' | 'lecture' | 'essai' | 'non' }} CartesMail
 * @typedef {{ key: string, label: string, subject: string, html_body: string, blocks: Record<string, any>,
 *   auto_segment_id: string | null, is_automated: boolean, auto_cadence_days: number | null,
 *   auto_time_of_day: string | null, next_run_at: string | null, tracking_type_value: string | null }} FormulaireMail
 */

// ── Cartes ────────────────────────────────────────────────────────────────────

/** Table de la conception § 5.4, vue par l'administrateur. */
const CARTES = Object.freeze({
  manuelle: { destinataires: 'oui', message: 'oui', envoi: 'complet' },
  automatique: { destinataires: 'oui', message: 'oui', envoi: 'complet' },
  sequence: { destinataires: 'lecture', message: 'oui', envoi: 'lecture' },
  auto_registre: { destinataires: 'non', message: 'oui', envoi: 'essai' },
  boutique: { destinataires: 'non', message: 'oui', envoi: 'non' },
});

/**
 * Cartes de la page selon la nature du mail. Un autre rôle que l'administrateur lit le message, choisit les
 * destinataires et envoie une campagne manuelle (comme avec l'onglet Envoi) ; le reste lui est en lecture.
 * @param {string} nature
 * @param {{ isOrgAdmin?: boolean }} [options]
 * @returns {CartesMail}
 */
export function cartesDuMail(nature, { isOrgAdmin = false } = {}) {
  const n = Object.prototype.hasOwnProperty.call(CARTES, nature) ? nature : 'manuelle';
  const base = CARTES[n];
  if (isOrgAdmin) return { ...base };
  const lecture = (v) => (v === 'oui' ? 'lecture' : v);
  if (n === 'manuelle') return { ...base, message: 'lecture' };
  return {
    destinataires: lecture(base.destinataires),
    message: 'lecture',
    envoi: base.envoi === 'complet' ? 'lecture' : (base.envoi === 'essai' ? 'non' : base.envoi),
  };
}

// ── Clés et noms ──────────────────────────────────────────────────────────────

/**
 * Clé technique dérivée du nom (règle de l'ancien `slugifyKey`) : minuscules sans accents, `_`, 50 au plus.
 * @param {string | null | undefined} libelle
 * @returns {string}
 */
export function cleDepuisLibelle(libelle) {
  return (libelle || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campagne';
}

/**
 * Clé d'une copie : `…_copie`, puis `…_copie_2`… jamais une clé existante, 50 caractères au plus.
 * @param {string} cle
 * @param {string[]} clesExistantes
 * @returns {string}
 */
export function cleDeCopie(cle, clesExistantes) {
  const prises = new Set(clesExistantes ?? []);
  for (let n = 1; ; n += 1) {
    const suffixe = n === 1 ? '_copie' : `_copie_${n}`;
    const candidate = `${String(cle ?? '').slice(0, 50 - suffixe.length)}${suffixe}`;
    if (!prises.has(candidate)) return candidate;
  }
}

/** Nom brut d'une variable, sans accolades (une variable inconnue n'a pas de libellé fiable). @param {string} v */
const nomBrut = (v) => String(v ?? '').replace(/^\{\{|\}\}$/g, '');

/** Nom comparable : rogné, minuscules. @param {unknown} v @returns {string} */
const nomComparable = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Nom d'une copie : « X (copie) », puis « X (copie 2) »… jamais un nom existant : le journal des envois
 * est tenu par le nom, deux campagnes du même nom partageraient leur historique.
 * @param {string} libelle
 * @param {string[]} libellesExistants
 * @returns {string}
 */
export function libelleDeCopie(libelle, libellesExistants) {
  const pris = new Set((libellesExistants ?? []).map(nomComparable));
  for (let n = 1; ; n += 1) {
    const candidat = `${String(libelle ?? '').trim()} (${n === 1 ? 'copie' : `copie ${n}`})`;
    if (!pris.has(nomComparable(candidat))) return candidat;
  }
}

/**
 * Le nom d'un mail déjà envoyé ne change plus. Journal inconnu (chargement, erreur) ⇒ verrouillé.
 * @param {number | null | undefined} nbEnvois
 * @returns {boolean}
 */
export function nomVerrouille(nbEnvois) {
  return typeof nbEnvois !== 'number' || nbEnvois > 0;
}

/**
 * Le nom est-il modifiable, et sinon pourquoi. Les e-mails de l'application (séquences, e-mails automatiques,
 * boutique) gardent le nom que l'application leur donne.
 * `lectureSeule` (le message n'est pas modifiable par cette personne) : nom fixé, sans raison à afficher.
 * Journal en cours de lecture : nom fixé, sans phrase ; la phrase « impossible de vérifier » seulement après un échec.
 * @param {{ nature: string, nouveau: boolean, nbEnvois: number | null | undefined, lectureSeule?: boolean,
 *   journalEnEchec?: boolean }} entree
 * @returns {{ modifiable: boolean, raison: string | null }}
 */
export function etatDuNom({ nature, nouveau, nbEnvois, lectureSeule = false, journalEnEchec = false }) {
  if (lectureSeule) return { modifiable: false, raison: null };
  if (nouveau) return { modifiable: true, raison: null };
  if (nature !== 'manuelle' && nature !== 'automatique') {
    return { modifiable: false, raison: 'Le nom de cet e-mail est fixé par l’application.' };
  }
  if (typeof nbEnvois !== 'number') {
    if (!journalEnEchec) return { modifiable: false, raison: null };
    return { modifiable: false, raison: 'Impossible de vérifier pour l’instant si ce mail a déjà été envoyé : son nom reste fixé.' };
  }
  if (nbEnvois > 0) {
    return { modifiable: false, raison: 'Ce mail a déjà été envoyé : son nom ne change plus, l’historique des envois s’y rattache.' };
  }
  return { modifiable: true, raison: null };
}

// ── Formulaire et enregistrement ─────────────────────────────────────────────

/** Champs que la page porte : les seuls qu'elle écrit. */
const CHAMPS = Object.freeze([
  'label', 'subject', 'html_body', 'blocks', 'auto_segment_id', 'is_automated', 'auto_cadence_days', 'auto_time_of_day', 'next_run_at',
]);

/**
 * Formulaire de la page à partir d'une campagne enregistrée (ou d'un mail neuf : campagne manuelle vide).
 * @param {Record<string, any> | null | undefined} campagne
 * @returns {FormulaireMail}
 */
export function formulaireDepuisCampagne(campagne) {
  const c = campagne ?? {};
  return {
    key: c.key ?? '',
    label: c.label ?? '',
    subject: c.subject ?? '',
    html_body: c.html_body ?? '',
    blocks: c.blocks && typeof c.blocks === 'object' && !Array.isArray(c.blocks) ? { ...c.blocks } : {},
    auto_segment_id: c.auto_segment_id ?? null,
    is_automated: !!c.is_automated,
    auto_cadence_days: c.auto_cadence_days ?? null,
    auto_time_of_day: c.auto_time_of_day ?? '09:00',
    next_run_at: c.next_run_at ?? null,
    tracking_type_value: c.tracking_type_value ?? null,
  };
}

/** JSON aux clés triées (deux objets égaux s'écrivent pareil). @param {unknown} v @returns {string} */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Deux textes : identiques une fois normalisés s'ils sont éditables, tels quels sinon. */
function memeCorps(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x === y) return true;
  return estEditable(x) && estEditable(y) && normaliser(x) === normaliser(y);
}

/** `blocks` comparable : une intention effacée vaut une intention jamais écrite. @param {unknown} v */
const sansVides = (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, x]) => x !== '' && x != null));

/** Valeur enregistrée d'un champ (nom et objet rognés). */
function valeurEnregistree(champ, v) {
  if (champ === 'label' || champ === 'subject') return String(v ?? '').trim();
  return v;
}

/** @param {string} champ */
function egaux(champ, a, b) {
  if (champ === 'html_body') return memeCorps(a, b);
  if (champ === 'blocks') return stable(sansVides(a)) === stable(sansVides(b));
  return stable(valeurEnregistree(champ, a)) === stable(valeurEnregistree(champ, b));
}

/**
 * Ce que la page écrit : seulement ses champs, et seulement ceux qui ont changé. Jamais `purpose`, `audience`,
 * `tone`, `notes`. À la création (`initial` nul) : tous ses champs, plus la clé et le marqueur de suivi dérivés du nom.
 * @param {FormulaireMail & Record<string, any>} formulaire
 * @param {FormulaireMail | null} initial
 * @returns {Record<string, any>}
 */
export function champsAEnregistrer(formulaire, initial) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!initial) {
    for (const champ of CHAMPS) out[champ] = valeurEnregistree(champ, formulaire[champ]);
    out.key = cleDepuisLibelle(formulaire.label);
    out.tracking_type_value = out.key;
    return out;
  }
  for (const champ of CHAMPS) {
    if (!egaux(champ, formulaire[champ], initial[champ])) out[champ] = valeurEnregistree(champ, formulaire[champ]);
  }
  return out;
}

/**
 * Le mail a-t-il des modifications non enregistrées ? Un mail neuf l'est dès qu'on y a écrit.
 * @param {FormulaireMail} formulaire
 * @param {FormulaireMail | null} initial
 * @returns {boolean}
 */
export function estModifie(formulaire, initial) {
  if (!initial) return !egaux('label', formulaire.label, '') || !egaux('subject', formulaire.subject, '')
    || !memeCorps(formulaire.html_body, '') || stable(sansVides(formulaire.blocks)) !== '{}';
  return Object.keys(champsAEnregistrer(formulaire, initial)).length > 0;
}

/**
 * Texte vide : rien d'autre que des blancs et des variables.
 * @param {string | null | undefined} html
 * @returns {boolean}
 */
export function corpsVide(html) {
  return texteBrut(String(html ?? '')).replace(/\{\{[A-Za-z0-9_]+\}\}/g, ' ').replace(/\s+/g, '') === '';
}

/** Clés des e-mails de l'application : un mail de ce nom deviendrait leur texte. */
const CLES_RESERVEES = new Set([
  ...EMAILS_AUTOMATIQUES.map((e) => e.gabarit.key), ...SEQUENCES_EMAILS.map((e) => e.gabarit.key), ...WEBSHOP_EMAIL_KEYS,
]);

/**
 * La clé est-elle celle d'un e-mail de l'application (registre, séquence, boutique) ?
 * @param {string} cle
 * @returns {boolean}
 */
export function cleReservee(cle) {
  return CLES_RESERVEES.has(cle);
}

/**
 * Pourquoi « Enregistrer » est fermé (phrases affichées telles quelles), liste vide sinon.
 * Une campagne manuelle s'enregistre incomplète (brouillon : elle ne part qu'à la main) ; un mail qui part tout
 * seul doit avoir un objet et un texte. Le nom est requis et unique (le journal des envois en dépend) ; la clé
 * d'un mail neuf aussi, et elle ne peut pas être celle d'un e-mail de l'application. L'unicité du nom n'est
 * vérifiée que pour un mail neuf ou un nom changé : des homonymes anciens n'empêchent jamais d'enregistrer.
 * @param {{ form: FormulaireMail, initial?: FormulaireMail | null, nature: string, nouveau: boolean,
 *   campagnes: Array<{ id?: string, key?: string, label?: string }>, id?: string | null }} entree
 * @returns {string[]}
 */
export function raisonsEnregistrement({ form, initial = null, nature, nouveau, campagnes, id = null }) {
  const raisons = [];
  const nom = String(form.label ?? '').trim();
  const autres = (campagnes ?? []).filter((c) => !id || c.id !== id);
  const nomChange = nouveau || !initial || nomComparable(initial.label) !== nomComparable(nom);
  if (!nom) raisons.push('Donnez un nom à ce mail.');
  else if (nouveau && cleReservee(cleDepuisLibelle(nom))) {
    raisons.push('Ce nom est réservé à un e-mail automatique de l’application : choisissez-en un autre.');
  } else if (nomChange && autres.some((c) => nomComparable(c.label) === nomComparable(nom))) {
    raisons.push('Un autre mail porte déjà ce nom : choisissez-en un autre.');
  } else if (nouveau && autres.some((c) => c.key === cleDepuisLibelle(nom))) {
    raisons.push('Un autre mail porte un nom trop proche : choisissez-en un autre.');
  }
  if (nature !== 'manuelle') {
    if (!String(form.subject ?? '').trim()) raisons.push('Ce mail part tout seul : donnez-lui un objet.');
    if (corpsVide(form.html_body)) raisons.push('Ce mail part tout seul : écrivez son texte.');
  }
  return raisons;
}

// ── Copie ────────────────────────────────────────────────────────────────────

/** Colonnes de `mail_campaigns` reprises telles quelles par une copie (ni id, ni dates, ni auteur, ni org). */
const COLONNES_COPIEES = Object.freeze([
  'subject', 'preheader', 'html_body', 'default_segment', 'allowed_segments', 'purpose', 'audience', 'tone',
  'trigger_description', 'notes', 'blocks', 'auto_segment_id', 'auto_time_of_day',
]);

/**
 * Ce que « Dupliquer » insère : le contenu et le segment, sous une clé et un nom neufs. Une copie naît TOUJOURS
 * campagne manuelle qui n'envoie rien d'elle-même : ni automatique (le planificateur la prendrait et, sous un nom
 * neuf, écrirait de nouveau à tous ceux que l'original a déjà touchés), ni transactionnelle, ni archivée.
 * L'organisation est posée par l'appelant.
 * @param {Record<string, any>} campagne
 * @param {string} cle
 * @param {string} libelle
 * @returns {Record<string, any>}
 */
export function champsDeCopie(campagne, cle, libelle) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const col of COLONNES_COPIEES) if (campagne && col in campagne) out[col] = campagne[col];
  return {
    ...out,
    key: cle,
    label: libelle,
    tracking_type_value: cle,
    is_automated: false,
    is_transactional: false,
    is_archived: false,
    auto_cadence_days: null,
    auto_cadence_minutes: null,
    next_run_at: null,
    last_run_at: null,
  };
}

// ── Gestes d'envoi ───────────────────────────────────────────────────────────

/**
 * Pourquoi un geste d'envoi est fermé (phrases affichées telles quelles à côté du bouton) ; liste vide = ouvert.
 * `nombre` inconnu (chargement, erreur) ou nul ferme « Lancer », jamais « Tester ».
 * @param {{ objet?: string, corps?: string, variablesInconnues?: string[], segmentId?: string | null,
 *   nombre?: number | null, refusExpediteur?: string | null, envoiEnCours?: boolean }} etat
 * @param {'tester' | 'lancer' | 'automatiser'} geste
 * @returns {string[]}
 */
export function raisonsDeBlocage({ objet, corps, variablesInconnues: inconnues = [], segmentId, nombre, refusExpediteur, envoiEnCours }, geste) {
  if (!['tester', 'lancer', 'automatiser'].includes(geste)) return ['Ce geste n’est pas possible ici.'];
  const raisons = [];
  if (envoiEnCours) raisons.push('Un envoi est déjà en cours : attendez qu’il se termine.');
  if (!String(objet ?? '').trim()) raisons.push('Donnez un objet au mail.');
  if (corpsVide(corps)) raisons.push('Écrivez le texte du mail.');
  if ((inconnues ?? []).length) {
    const noms = inconnues.map((v) => `« ${nomBrut(v)} »`).join(', ');
    raisons.push(`Le texte contient ${noms}, que rien ne remplace : il arriverait tel quel chez le client.`);
  }
  if (refusExpediteur) raisons.push(EXPEDITEUR_REFUS[refusExpediteur] ?? 'L’adresse d’envoi de votre entreprise n’est pas prête.');
  if (geste !== 'tester' && !segmentId) raisons.push('Choisissez les destinataires.');
  if (geste === 'lancer' && segmentId) {
    if (typeof nombre !== 'number') raisons.push('Le nombre de destinataires n’est pas encore connu.');
    else if (nombre <= 0) raisons.push('Personne à qui envoyer ce mail dans ces destinataires.');
  }
  return raisons;
}

// ── Rédaction assistée ───────────────────────────────────────────────────────

/** Bornes de l'edge `mailing-rediger` : au-delà, elle refuse (`demande_trop_longue`). */
export const LIMITES_REDACTION = Object.freeze({ intention: 2000, objet: 300, corps: 12000 });

/**
 * Pourquoi un bouton de l'assistant est fermé, AVANT l'appel (le serveur refuserait). Liste vide = ouvert.
 * @param {{ consigne: string, intention?: string, objet?: string, corps?: string, enCours?: boolean }} entree
 * @returns {string[]}
 */
export function raisonsRedaction({ consigne, intention = '', objet = '', corps = '', enCours = false }) {
  if (!CONSIGNES.includes(consigne)) return ['Cette demande n’est pas reconnue.'];
  const raisons = [];
  if (enCours) raisons.push('L’assistant est en train d’écrire.');
  if (consigne === 'rediger') {
    if (!String(intention ?? '').trim()) raisons.push('Dites en quelques mots ce que vous voulez écrire.');
  } else if (corpsVide(corps)) {
    raisons.push('Écrivez d’abord un texte, ou demandez à l’assistant de le rédiger.');
  }
  if (String(intention ?? '').length > LIMITES_REDACTION.intention) {
    raisons.push('Ce que vous voulez dire dépasse 2 000 caractères : raccourcissez-le.');
  }
  if (String(objet ?? '').length > LIMITES_REDACTION.objet) raisons.push('L’objet est trop long pour l’assistant : raccourcissez-le.');
  if (String(corps ?? '').length > LIMITES_REDACTION.corps) raisons.push('Le texte est trop long pour l’assistant : raccourcissez-le.');
  return raisons;
}

/**
 * Demande envoyée à `mailCampaignsService.rediger` : intention, objet et texte actuels, nature du mail, NOMS
 * des variables proposées. Rien d'autre (aucune donnée d'un client).
 * @param {{ consigne: string, form: FormulaireMail, campagne: Record<string, any> | null }} entree
 */
export function demandeRedaction({ consigne, form, campagne }) {
  return {
    consigne,
    intention: String(form.blocks?.brief ?? ''),
    objet: String(form.subject ?? ''),
    corps: String(form.html_body ?? ''),
    nature: natureDuMail(campagne),
    variables: variablesProposees(campagne).map((v) => v.nom),
  };
}

/**
 * Reprise d'une réponse de l'assistant : le texte passe par la même normalisation qu'un texte tapé (sans titre,
 * bouton ni encadré pour un mail habillé par le site). Inutilisable (vide, non éditable) ⇒ `null`, rien n'est remplacé.
 * @param {{ objet?: unknown, objets?: unknown, corps?: unknown } | null | undefined} resultat
 * @param {{ sansElements?: boolean }} [options]
 * @returns {{ objet: string, objets: string[], corps: string } | null}
 */
export function appliquerRedaction(resultat, { sansElements = false } = {}) {
  if (!resultat || typeof resultat !== 'object') return null;
  const brut = typeof resultat.corps === 'string' ? resultat.corps : '';
  if (!brut.trim() || !estEditable(brut)) return null;
  const corps = normaliser(brut, { sansElements });
  if (!corps.trim()) return null;
  const objet = typeof resultat.objet === 'string' ? resultat.objet.trim() : '';
  const objets = Array.isArray(resultat.objets) ? resultat.objets.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim()).slice(0, 3) : [];
  return { objet, objets, corps };
}

/**
 * Objets proposés par l'assistant : texte non vide, rognés, trois au plus.
 * @param {{ objets?: unknown } | null | undefined} reponse
 * @returns {string[]}
 */
export function objetsSuggeres(reponse) {
  const liste = Array.isArray(reponse?.objets) ? reponse.objets : [];
  return liste.filter((o) => typeof o === 'string' && o.trim()).map((o) => o.trim()).slice(0, 3);
}

/**
 * Un mail sans titre, bouton ni encadré (habillé par le site) : sa normalisation les retire.
 * @param {{ titre: boolean, bouton: boolean, encadre: boolean }} elements
 * @returns {boolean}
 */
export function sansElementsDe(elements) {
  return !elements?.titre && !elements?.bouton && !elements?.encadre;
}

// ── Ancien format ────────────────────────────────────────────────────────────

/**
 * « Refaire avec le nouvel éditeur » : l'ancien texte est gardé dans `blocks.ancien_html` (un second passage ne
 * l'écrase pas), le texte devient le texte par défaut du mail s'il en a un, sinon un texte vide.
 * @param {{ html_body?: string | null, blocks?: Record<string, any> | null }} campagne
 * @param {{ html_body?: string } | null} texteParDefaut
 * @returns {{ html_body: string, blocks: Record<string, any> }}
 */
export function refaireAvecNouvelEditeur(campagne, texteParDefaut) {
  const blocks = { ...(campagne?.blocks ?? {}) };
  if (!blocks.ancien_html) blocks.ancien_html = String(campagne?.html_body ?? '');
  return { html_body: String(texteParDefaut?.html_body ?? ''), blocks };
}

/**
 * « Revenir à l'ancien » : rend le texte gardé, `null` s'il n'y en a pas.
 * @param {{ html_body?: string | null, blocks?: Record<string, any> | null }} campagne
 * @returns {{ html_body: string, blocks: Record<string, any> } | null}
 */
export function revenirALAncien(campagne) {
  const ancien = campagne?.blocks?.ancien_html;
  if (typeof ancien !== 'string' || !ancien) return null;
  const { ancien_html: _ancien, ...blocks } = campagne.blocks;
  return { html_body: ancien, blocks };
}

// ── Petits messages ──────────────────────────────────────────────────────────

/** Entités courantes décodées (comparaison seulement). @param {string} s */
const decoder = (s) => s.replace(/&nbsp;/g, '\u00a0').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Déclarations d'un style, propriétés en minuscules, triées. @param {string} style */
const styleCanonique = (style) => style.split(';').map((d) => d.trim()).filter(Boolean)
  .map((d) => { const i = d.indexOf(':'); return i < 0 ? d.toLowerCase() : `${d.slice(0, i).trim().toLowerCase()}:${d.slice(i + 1).trim()}`; })
  .sort().join(';');

/** Balise canonique : nom + attributs triés (style canonique). @param {string} balise */
function baliseCanonique(balise) {
  const m = balise.match(/^<\s*(\/?)\s*([a-zA-Z0-9]+)([\s\S]*?)\/?\s*>$/);
  if (!m) return balise;
  const attrs = [];
  const re = /([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const a of m[3].matchAll(re)) {
    const nom = a[1].toLowerCase();
    const val = decoder(a[3] ?? a[4] ?? a[5] ?? '');
    attrs.push(`${nom}=${nom === 'style' ? styleCanonique(val) : val}`);
  }
  return `<${m[1]}${m[2].toLowerCase()} ${attrs.sort().join(' ')}>`;
}

/** Forme comparable d'un texte : blancs réduits, entités décodées, balises canoniques. @param {string} html */
function formeComparable(html) {
  return String(html ?? '').replace(/<[^>]*>/g, baliseCanonique)
    .replace(/>\s+</g, '><').split(/(<[^>]*>)/).map((x) => (x.startsWith('<') ? x : decoder(x))).join('')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Un texte enregistré perdra-t-il de sa mise en forme au premier enregistrement (couleur, alignement, police que
 * la lecture tolérante accepte mais que le format ne garde pas) ? Les blancs, l'ordre des attributs et des
 * déclarations de style ne comptent pas. Un ancien format (non éditable) n'est pas concerné : il part tel quel.
 * @param {string | null | undefined} htmlStocke
 * @returns {boolean}
 */
export function miseEnFormeSimplifiee(htmlStocke) {
  const html = String(htmlStocke ?? '');
  if (!html.trim() || !estEditable(html)) return false;
  return formeComparable(normaliser(html)) !== formeComparable(html);
}

/**
 * Rappel (pas une erreur) pour un objet long : il risque d'être coupé.
 * @param {string | null | undefined} objet
 * @returns {string | null}
 */
export function rappelObjet(objet) {
  const n = String(objet ?? '').trim().length;
  return n > 50 ? `${n} caractères : au-delà de 50, l’objet risque d’être coupé sur un téléphone.` : null;
}

/**
 * Avertissements sous le texte : informations du texte par défaut retirées, variables que rien ne remplace
 * (nommées par leur nom brut entre guillemets, jamais avec des accolades).
 * @param {Record<string, any> | null} campagne
 * @param {string} html
 * @returns {{ manquantes: string | null, inconnues: string[] }}
 */
export function avertissementsTexte(campagne, html) {
  const manquantes = variablesManquantes(campagne, html);
  const inconnues = [...new Set(variablesInconnues(campagne, html))];
  return {
    manquantes: manquantes.length ? `Ce mail n’affiche plus : ${manquantes.join(', ')}.` : null,
    inconnues: inconnues.map((v) => `« ${nomBrut(v)} » n’est remplacé par rien à l’envoi : il arriverait tel quel chez le client.`),
  };
}

/** Envoi en nombre (domaine propre exigé) ou individuel, selon la nature. @param {string} nature */
const usageDe = (nature) => (nature === 'manuelle' || nature === 'automatique' ? 'nombre' : 'individuel');

/**
 * Ligne « De » de l'aperçu : l'expéditeur résolu par la règle de l'envoi, ou la phrase du refus.
 * @param {Record<string, any> | null | undefined} reglages
 * @param {string} nature
 * @returns {{ texte: string, refus: string | null }}
 */
export function ligneExpediteur(reglages, nature) {
  const r = resoudreExpediteur(reglages ?? {}, { usage: usageDe(nature) });
  if (r.refus) return { texte: EXPEDITEUR_REFUS[r.refus], refus: r.refus };
  if (r.mode === 'domaine') return { texte: r.from, refus: null };
  return { texte: `${r.fromName || 'Votre entreprise'}, depuis l’adresse d’envoi commune`, refus: null };
}

/**
 * Où se fait l'envoi de ce mail tant que la page n'a pas sa carte d'envoi : une phrase et, le cas échéant, un lien.
 * @param {string} nature
 * @param {CartesMail} cartes
 * @returns {{ texte: string, lien: { vers: string, libelle: string } | null } | null}
 */
export function ligneEnvoi(nature, cartes) {
  const ongletEnvoi = { vers: '/mailing?tab=send', libelle: 'Ouvrir l’onglet Envoi' };
  const reglages = { vers: '/settings/communication', libelle: 'Ouvrir les réglages des e-mails' };
  if (cartes.envoi === 'complet') {
    return nature === 'automatique'
      ? { texte: 'Cette campagne part toute seule selon sa cadence : son envoi automatique continue tel qu’il est réglé, et l’archiver depuis la liste des campagnes l’arrête. Pour l’envoyer maintenant à la main, passez par l’onglet Envoi.', lien: ongletEnvoi }
      : { texte: 'Pour envoyer cette campagne, passez par l’onglet Envoi.', lien: ongletEnvoi };
  }
  if (cartes.envoi === 'essai') {
    return { texte: 'Pour vous envoyer un essai de ce mail, passez par Réglages → E-mails & SMS. L’essai part avec le texte enregistré.', lien: reglages };
  }
  if (cartes.envoi === 'lecture') {
    return nature === 'sequence'
      ? { texte: 'Ce mail part tout seul vers vos prospects : sa mise en route et son délai se règlent dans Réglages → E-mails & SMS.', lien: reglages }
      : { texte: 'Cette campagne part toute seule, selon la cadence réglée par l’administrateur.', lien: null };
  }
  return null;
}

/**
 * Mot de l'en-tête sur l'état d'enregistrement.
 * @param {{ nouveau: boolean, modifie: boolean, enCours: boolean }} entree
 * @returns {string}
 */
export function etatEnregistrement({ nouveau, modifie, enCours }) {
  if (enCours) return 'Enregistrement…';
  if (modifie) return 'Modifications non enregistrées';
  return nouveau ? 'Pas encore enregistré' : 'Enregistré';
}

