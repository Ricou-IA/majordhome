// src/lib/webshop/settingsForm.js
// Écran Settings → Webshop — logique de saisie PURE (aucun import React / Supabase), testée par
// `node --test scripts/webshop-settings-form.test.mjs`.
//
// Règle : la SAISIE BRUTE est validée avant `buildWebshopConfig`. Une valeur hors bornes affiche
// une erreur sous son champ et bloque l'enregistrement ; elle n'est jamais remplacée en silence
// par le défaut (ce que ferait la coercition de `buildWebshopConfig`). Bornes = `BORNES` de
// reglages.js, jamais recopiées ici.
import {
  BORNES, WEBSHOP_REGLAGES_DEFAUT, WEBSHOP_PROCESS_TRANSITIONS, WEBSHOP_PROCESS_EVENEMENTS_TOURNEE,
  buildWebshopConfig, validerWebshopReglages,
} from './reglages.js';
import { GABARIT_ORDRE_COLIS } from './process.js';
import { WEBSHOP_EMAIL_DEFAULTS } from './emailTemplates.js';

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** @param {string[]} liste @returns {string} */
function emailsVersTexte(liste) {
  return (Array.isArray(liste) ? liste : []).join(', ');
}

/** Sépare une saisie libre (virgules, points-virgules, espaces, retours à la ligne). @param {string} texte @returns {string[]} */
export function texteVersEmails(texte) {
  return String(texte ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Centimes → saisie en euros (« 55 », « 55,5 »). @param {number} cents @returns {string} */
export function centsVersEuros(cents) {
  if (!Number.isFinite(cents)) return '';
  return String(cents / 100).replace('.', ',');
}

/**
 * Saisie en euros (virgule ou point, 2 décimales au plus) → centimes entiers ; NaN si invalide.
 * @param {string|number} saisie @returns {number}
 */
export function eurosVersCents(saisie) {
  const s = String(saisie ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/**
 * Saisie décimale (virgule ou point) → nombre ; NaN si vide ou invalide.
 * @param {string|number} saisie @param {number} decimales @returns {number}
 */
export function decimal(saisie, decimales) {
  const s = String(saisie ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimales}})?$`);
  return re.test(s) ? Number(s) : NaN;
}

/** Entier strict depuis une saisie ; NaN sinon. @param {string|number} v @returns {number} */
function entier(v) {
  const s = String(v ?? '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}

/** @param {string} url @returns {string} */
function normaliserSiteUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Formulaire des réglages scalaires (settings.webshop)
// ---------------------------------------------------------------------------

/**
 * Dépôts tels qu'enregistrés (chaînes), SANS repli sur le dépôt par défaut.
 * @param {any} webshopBrut @returns {Array<{ code: string, libelle: string, adresse: string }>}
 */
function depotsBruts(webshopBrut) {
  const liste = webshopBrut && Array.isArray(webshopBrut.depots) ? webshopBrut.depots : [];
  const txt = (v) => (typeof v === 'string' ? v : '');
  return liste
    .filter((d) => d && typeof d === 'object' && !Array.isArray(d))
    .map((d) => ({ code: txt(d.code), libelle: txt(d.libelle), adresse: txt(d.adresse) }));
}

/**
 * Code technique d'un nouveau dépôt, dérivé de son libellé (les secteurs le référencent) :
 * minuscules, sans accents, mots séparés par des tirets. Libellé sans lettre ni chiffre → ''.
 * @param {string} libelle @returns {string}
 */
export function codeDepotDepuisLibelle(libelle) {
  return String(libelle ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lignes éditables reprenant les dépôts par défaut (même code : les secteurs y pointent déjà). */
export function depotsParDefautPourEdition() {
  return WEBSHOP_REGLAGES_DEFAUT.depots.map((d) => ({ code: d.code, libelle: d.libelle, adresse: d.adresse }));
}

/**
 * Formulaire (valeurs en chaînes, comme saisies) depuis une configuration complète.
 * Les dépôts viennent de `settings.webshop.depots` BRUT, pas de `cfg` (qui réinjecte le dépôt par
 * défaut) : une liste vide ou absente reste vide à l'écran et l'avertissement « le dépôt par
 * défaut s'applique » se réaffiche après rechargement.
 * @param {import('./reglages.js').WebshopConfig} cfg
 * @param {any} [webshopBrut] `settings.webshop` tel qu'en base
 */
export function formDepuisConfig(cfg, webshopBrut) {
  const p = cfg.palette;
  const c = cfg.colis;
  return {
    site_url: cfg.site_url,
    emails_interne: emailsVersTexte(cfg.emails.interne),
    depots: depotsBruts(webshopBrut),
    transporteur_nom: p.transporteur.nom,
    transporteur_emails: emailsVersTexte(p.transporteur.emails),
    transporteur_note: p.transporteur.note,
    envoi_auto: p.envoi_auto,
    heure_envoi: String(p.heure_envoi),
    delai_fermeture_jours: String(p.delai_fermeture_jours),
    horizon_semaines: String(p.horizon_semaines),
    ancre_cycle: p.ancre_cycle,
    capacite_emplacements: String(p.capacite_emplacements),
    prix_emplacement_defaut_euros: centsVersEuros(p.prix_emplacement_defaut_cents),
    palette_tva_pct: String(p.tva_pct),
    max_emplacements_panier: String(p.max_emplacements_panier),
    prestataire_nom: c.prestataire.nom,
    prestataire_mode: c.prestataire.mode,
    prestataire_emails: emailsVersTexte(c.prestataire.emails),
    prestataire_note: c.prestataire.note,
    colis_tva_pct: String(c.tva_pct),
    max_qty_ligne: String(c.max_qty_ligne),
  };
}

/** Champ de l'écran ← champ de `validerWebshopReglages`. */
const CHAMP_ECRAN = {
  'emails.interne': 'emails_interne',
  'palette.transporteur.emails': 'transporteur_emails',
  'colis.prestataire.emails': 'prestataire_emails',
  site_url: 'site_url',
  depots: 'depots',
};

const CODE_DEPOT_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/**
 * Objet `webshop` brut (types finaux, sans coercition) depuis le formulaire.
 * @param {ReturnType<typeof formDepuisConfig>} form
 */
function brutDepuisForm(form) {
  return {
    site_url: normaliserSiteUrl(form.site_url),
    emails: { interne: texteVersEmails(form.emails_interne) },
    depots: form.depots.map((d) => ({
      code: String(d.code ?? '').trim(),
      libelle: String(d.libelle ?? '').trim(),
      adresse: String(d.adresse ?? '').trim(),
    })),
    palette: {
      transporteur: {
        nom: String(form.transporteur_nom ?? '').trim(),
        emails: texteVersEmails(form.transporteur_emails),
        note: String(form.transporteur_note ?? '').trim(),
      },
      envoi_auto: form.envoi_auto === true,
      heure_envoi: entier(form.heure_envoi),
      delai_fermeture_jours: entier(form.delai_fermeture_jours),
      horizon_semaines: entier(form.horizon_semaines),
      ancre_cycle: String(form.ancre_cycle ?? ''),
      capacite_emplacements: entier(form.capacite_emplacements),
      prix_emplacement_defaut_cents: eurosVersCents(form.prix_emplacement_defaut_euros),
      tva_pct: Number(form.palette_tva_pct),
      max_emplacements_panier: entier(form.max_emplacements_panier),
    },
    colis: {
      prestataire: {
        nom: String(form.prestataire_nom ?? '').trim(),
        mode: String(form.prestataire_mode ?? '').trim(),
        emails: texteVersEmails(form.prestataire_emails),
        note: String(form.prestataire_note ?? '').trim(),
      },
      tva_pct: Number(form.colis_tva_pct),
      max_qty_ligne: entier(form.max_qty_ligne),
    },
  };
}

/**
 * Erreurs de la saisie brute, par champ de l'écran. Vide = enregistrable.
 * @param {ReturnType<typeof formDepuisConfig>} form
 * @param {{ depotsUtilises: string[]|undefined }} [ctx] À fournir par l'écran qui ÉDITE les dépôts :
 *   codes portés par les secteurs existants. `depotsUtilises` non tableau (secteurs en chargement
 *   ou en erreur) = état inconnu → enregistrement REFUSÉ (jamais de garde tolérante). Sans `ctx`
 *   (onglets qui ne modifient pas les dépôts), ce contrôle ne s'applique pas.
 * @returns {Record<string, string>}
 */
export function validerSaisie(form, ctx) {
  /** @type {Record<string, string>} */
  const erreurs = {};
  const brut = brutDepuisForm(form);
  const p = brut.palette;

  const borne = (champ, v, b) => {
    if (!Number.isInteger(v) || v < b.min || v > b.max) erreurs[champ] = `Nombre entier entre ${b.min} et ${b.max}`;
  };
  borne('heure_envoi', p.heure_envoi, BORNES.palette.heure_envoi);
  borne('delai_fermeture_jours', p.delai_fermeture_jours, BORNES.palette.delai_fermeture_jours);
  borne('horizon_semaines', p.horizon_semaines, BORNES.palette.horizon_semaines);
  borne('capacite_emplacements', p.capacite_emplacements, BORNES.palette.capacite_emplacements);
  borne('max_emplacements_panier', p.max_emplacements_panier, BORNES.palette.max_emplacements_panier);
  borne('max_qty_ligne', brut.colis.max_qty_ligne, BORNES.colis.max_qty_ligne);
  if (!erreurs.max_emplacements_panier && !erreurs.capacite_emplacements
    && p.max_emplacements_panier > p.capacite_emplacements) {
    erreurs.max_emplacements_panier = 'Ne peut pas dépasser la capacité d’un camion';
  }

  const bPrix = BORNES.palette.prix_emplacement_defaut_cents;
  const prix = p.prix_emplacement_defaut_cents;
  if (!Number.isInteger(prix) || prix < bPrix.min || prix > bPrix.max) {
    erreurs.prix_emplacement_defaut_euros = `Montant en euros (2 décimales au plus) entre ${centsVersEuros(bPrix.min)} et ${centsVersEuros(bPrix.max)}`;
  }

  if (!BORNES.tva_pct.includes(p.tva_pct)) erreurs.palette_tva_pct = 'Taux de TVA non admis';
  if (!BORNES.tva_pct.includes(brut.colis.tva_pct)) erreurs.colis_tva_pct = 'Taux de TVA non admis';

  const ancre = p.ancre_cycle;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ancre) ? new Date(`${ancre}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ancre) {
    erreurs.ancre_cycle = 'Date invalide';
  } else if (d.getUTCDay() !== 1) {
    erreurs.ancre_cycle = 'L’ancre du cycle doit être un lundi (début de la semaine 1)';
  }

  if (!brut.colis.prestataire.mode) erreurs.prestataire_mode = 'Mode d’envoi requis';

  // Dépôts : ligne complète, code au format, pas retiré s'il sert à un secteur.
  const fautes = [];
  brut.depots.forEach((dep, i) => {
    if (!dep.code || !dep.libelle || !dep.adresse) fautes.push(`ligne ${i + 1} : code, libellé et adresse sont requis`);
    else if (!CODE_DEPOT_RE.test(dep.code)) fautes.push(`ligne ${i + 1} : code « ${dep.code} » (minuscules, chiffres, - ou _)`);
  });
  // Liste vide : le dépôt par défaut de reglages.js s'applique, c'est lui qui doit couvrir les secteurs.
  const effectifs = brut.depots.length ? brut.depots : WEBSHOP_REGLAGES_DEFAUT.depots;
  const codes = new Set(effectifs.map((dep) => dep.code));
  if (ctx && !Array.isArray(ctx.depotsUtilises)) {
    fautes.push('secteurs non chargés : impossible de vérifier les dépôts utilisés, enregistrement bloqué');
  }
  const utilises = ctx && Array.isArray(ctx.depotsUtilises) ? ctx.depotsUtilises : [];
  const retires = [...new Set(utilises)].filter((code) => code && !codes.has(code));
  if (retires.length) fautes.push(`dépôt utilisé par un secteur, impossible de le retirer : ${retires.join(', ')}`);
  if (fautes.length) erreurs.depots = fautes.join(' ; ');

  // E-mails, https, codes de dépôt en double : règles de reglages.js.
  for (const e of validerWebshopReglages(brut)) {
    const champ = CHAMP_ECRAN[e.champ] || e.champ;
    erreurs[champ] = erreurs[champ] ? `${erreurs[champ]} ; ${e.message}` : e.message;
  }
  return erreurs;
}

/**
 * Objet `webshop` COMPLET à enregistrer (à n'appeler que si `validerSaisie` est vide). Les clés
 * de `settings.webshop` inconnues de cet écran sont conservées (merge JSONB niveau 1 côté base).
 * Une liste de dépôts vide est enregistrée vide : le défaut de reglages.js s'applique alors.
 * @param {ReturnType<typeof formDepuisConfig>} form
 * @param {any} webshopActuel `settings.webshop` tel qu'en base
 */
export function webshopAEnregistrer(form, webshopActuel) {
  const brut = brutDepuisForm(form);
  const cfg = buildWebshopConfig({ webshop: brut });
  const autres = webshopActuel && typeof webshopActuel === 'object' && !Array.isArray(webshopActuel) ? webshopActuel : {};
  // `process` n'est pas édité par ce formulaire : la valeur en base reste telle quelle (sinon les
  // défauts de buildWebshopConfig écraseraient le réglage du Process à chaque enregistrement).
  const { process: _process, ...cfgSansProcess } = cfg;
  return { ...autres, ...cfgSansProcess, depots: brut.depots };
}

// ---------------------------------------------------------------------------
// Onglet Process (étape 2) : formulaire séparé, enregistré seul
// ---------------------------------------------------------------------------
// L'onglet Process n'écrit QUE `process`, posé sur `settings.webshop` tel qu'en base ; les autres
// onglets (`webshopAEnregistrer`) recopient le `process` stocké sans y toucher. Aucun onglet
// n'écrase donc ce qu'un autre a enregistré. À l'écran, « Aucun » = '' ; en base = null.

/**
 * @param {import('./reglages.js').WebshopProcess} process (sortie de buildWebshopConfig)
 * @returns {{ transitions: Record<string, { email_client: string, ordre_colis: boolean }>, tournee: Record<string, { email_client: string }> }}
 */
export function processVersForm(process) {
  /** @type {any} */
  const transitions = {};
  for (const k of WEBSHOP_PROCESS_TRANSITIONS) {
    const t = process.transitions[k];
    transitions[k] = { email_client: t.email_client ?? '', ordre_colis: t.ordre_colis === true };
  }
  /** @type {any} */
  const tournee = {};
  for (const k of WEBSHOP_PROCESS_EVENEMENTS_TOURNEE) {
    tournee[k] = { email_client: process.tournee[k].email_client ?? '' };
  }
  return { transitions, tournee };
}

/**
 * Formulaire → `process` à enregistrer : '' → null, puis coercition de reglages.js (gabarit inconnu
 * → null, ordre_colis booléen strict).
 * @param {ReturnType<typeof processVersForm>} fp
 * @returns {import('./reglages.js').WebshopProcess}
 */
export function processDepuisForm(fp) {
  /** @type {any} */
  const transitions = {};
  for (const k of WEBSHOP_PROCESS_TRANSITIONS) {
    const t = fp.transitions[k];
    transitions[k] = { email_client: t.email_client || null, ordre_colis: t.ordre_colis === true };
  }
  /** @type {any} */
  const tournee = {};
  for (const k of WEBSHOP_PROCESS_EVENEMENTS_TOURNEE) {
    tournee[k] = { email_client: fp.tournee[k].email_client || null };
  }
  return buildWebshopConfig({ webshop: { process: { transitions, tournee } } }).process;
}

/**
 * Objet `webshop` COMPLET à enregistrer depuis l'onglet Process : `settings.webshop` tel qu'en base
 * (toutes ses clés conservées) + `process`.
 * @param {ReturnType<typeof processVersForm>} fp
 * @param {any} webshopActuel
 */
export function webshopAvecProcess(fp, webshopActuel) {
  const autres = webshopActuel && typeof webshopActuel === 'object' && !Array.isArray(webshopActuel) ? webshopActuel : {};
  return { ...autres, process: processDepuisForm(fp) };
}

/** Gabarits proposables comme « e-mail au client » (destinataire client). */
export function gabaritsClient() {
  return Object.values(WEBSHOP_EMAIL_DEFAULTS).filter((g) => g.destinataire === 'client');
}

/**
 * Clés de gabarit dont le Process a besoin (e-mails client + ordre colis s'il est coché quelque part).
 * @param {import('./reglages.js').WebshopProcess} process @returns {string[]}
 */
export function gabaritsReferences(process) {
  const cles = new Set();
  for (const t of Object.values(process.transitions)) {
    if (t.email_client) cles.add(t.email_client);
    if (t.ordre_colis) cles.add(GABARIT_ORDRE_COLIS);
  }
  for (const e of Object.values(process.tournee)) if (e.email_client) cles.add(e.email_client);
  return [...cles];
}

/**
 * Gabarits référencés absents de `mail_campaigns`. `clesExistantes` non tableau (chargement ou
 * erreur) = état INCONNU → null : l'écran affiche « vérification… », jamais « à créer » à tort.
 * @param {import('./reglages.js').WebshopProcess} process @param {string[]|null|undefined} clesExistantes
 * @returns {string[]|null}
 */
export function gabaritsManquants(process, clesExistantes) {
  if (!Array.isArray(clesExistantes)) return null;
  const existe = new Set(clesExistantes);
  return gabaritsReferences(process).filter((k) => !existe.has(k));
}

/**
 * Ordre d'enlèvement coché sans aucun e-mail de prestataire colis (onglet Colis) : l'edge
 * tracerait `prestataire_missing`.
 * @param {import('./reglages.js').WebshopProcess} process @param {string[]} emailsPrestataire
 */
export function ordreColisSansPrestataire(process, emailsPrestataire) {
  const coche = Object.values(process.transitions).some((t) => t.ordre_colis);
  return coche && !(Array.isArray(emailsPrestataire) && emailsPrestataire.length > 0);
}

// ---------------------------------------------------------------------------
// Erreurs des RPC (Task 3, 20261017_2)
// ---------------------------------------------------------------------------

const LIBELLES_CHAMPS = {
  code: 'code', label: 'libellé', max_stops: 'arrêts max', max_minutes: 'durée max', max_km: 'km max',
  slot_price_ttc_cents: 'prix d’un emplacement', slots_per_cycle: 'passages par cycle', is_active: 'actif',
  postal_code: 'code postal', insee_code: 'code INSEE', commune: 'commune',
  min_weight_kg: 'poids minimum', max_weight_kg: 'poids maximum', price_ttc: 'prix', slug: 'identifiant',
  name: 'nom', address: 'adresse', accepts: 'type accepté', opening_hours: 'horaires',
};

/**
 * Message lisible d'une erreur de RPC webshop (PostgREST : `message` = code, `details` = DETAIL).
 * @param {{ message?: string, details?: string }|null|undefined} err
 * @returns {string}
 */
export function messageErreurWebshop(err) {
  const code = String(err?.message ?? '').trim();
  const detail = String(err?.details ?? '').trim();
  switch (code) {
    case 'org_admin_required': return 'Élément introuvable ou droits insuffisants (administrateur requis)';
    case 'postcode_taken': return `Ce code postal appartient déjà au secteur ${detail}`;
    case 'depot_unknown': return `Dépôt inconnu : ${detail}. Ajoutez-le d’abord dans l’onglet Livraison palette`;
    case 'invalid_recurrence': return `Jours de passage invalides${detail ? ` (${detail})` : ''}`;
    case 'invalid_value': return `Valeur invalide : ${LIBELLES_CHAMPS[detail] || detail}`;
    case 'immutable_field': return `Le champ « ${LIBELLES_CHAMPS[detail] || detail} » ne peut pas être modifié`;
    case 'code_taken': return `Ce code de secteur existe déjà : ${detail}`;
    case 'slug_taken': return `Cet identifiant de point de retrait existe déjà : ${detail}`;
    default: return code || 'Erreur inconnue';
  }
}

// ---------------------------------------------------------------------------
// Secteurs : récurrence, codes postaux, formulaire
// ---------------------------------------------------------------------------

export const SEMAINES = [1, 2, 3, 4];
export const JOURS = [
  { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' }, { value: 5, label: 'Ven' },
];

/** @typedef {{ week: number, weekday: number }} Passage */

/**
 * Coche / décoche un passage ; renvoie une récurrence triée (semaine puis jour), sans doublon.
 * @param {Passage[]} recurrence @param {number} week @param {number} weekday @returns {Passage[]}
 */
export function basculerPassage(recurrence, week, weekday) {
  const liste = normaliserRecurrence(recurrence);
  const present = liste.some((r) => r.week === week && r.weekday === weekday);
  return normaliserRecurrence(present
    ? liste.filter((r) => !(r.week === week && r.weekday === weekday))
    : [...liste, { week, weekday }]);
}

/**
 * Récurrence stockée → liste triée sans doublon (même normalisation que la RPC).
 * @param {any} recurrence @returns {Passage[]}
 */
export function normaliserRecurrence(recurrence) {
  const vus = new Set();
  return (Array.isArray(recurrence) ? recurrence : [])
    .map((r) => ({ week: Number(r?.week), weekday: Number(r?.weekday) }))
    .filter((r) => {
      const k = `${r.week}-${r.weekday}`;
      if (vus.has(k)) return false;
      vus.add(k);
      return true;
    })
    .sort((a, b) => a.week - b.week || a.weekday - b.weekday);
}

const INSEE_RE = /^(\d{5}|2[AB]\d{3})$/i;

/**
 * Codes postaux → texte, une ligne par commune : « 31320 31113 Castanet-Tolosan ».
 * @param {Array<{ postal_code: string, insee_code: string, commune: string }>} rows @returns {string}
 */
export function postcodesVersTexte(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => [r.postal_code, r.insee_code, r.commune].filter(Boolean).join(' '))
    .join('\n');
}

/**
 * Texte → lignes pour `webshop_sector_set_postcodes`. Une ligne = code postal (5 chiffres), puis
 * code INSEE facultatif, puis commune facultative. Les lignes vides sont ignorées ; une ligne
 * mal formée est une ERREUR (jamais écartée en silence).
 * @param {string} texte
 * @returns {{ rows: Array<{ postal_code: string, insee_code: string, commune: string }>, erreurs: string[] }}
 */
export function parserPostcodes(texte) {
  const rows = [];
  const erreurs = [];
  String(texte ?? '').split(/\r?\n/).forEach((ligne, i) => {
    const mots = ligne.trim().split(/[\s;,\t]+/).filter(Boolean);
    if (!mots.length) return;
    const [cp, ...reste] = mots;
    if (!/^\d{5}$/.test(cp)) {
      erreurs.push(`Ligne ${i + 1} : « ${cp} » n’est pas un code postal à 5 chiffres`);
      return;
    }
    let insee = '';
    if (reste.length && INSEE_RE.test(reste[0])) insee = reste.shift().toUpperCase();
    rows.push({ postal_code: cp, insee_code: insee, commune: reste.join(' ') });
  });
  return { rows, erreurs };
}

/**
 * Formulaire d'un secteur (nouveau si `secteur` est null) : prix saisi en euros.
 * @param {any} secteur ligne de `majordhome_webshop_sectors` ou null
 * @param {import('./reglages.js').WebshopConfig} cfg
 */
export function formSecteur(secteur, cfg) {
  if (!secteur) {
    return {
      id: null, code: '', label: '', depot: cfg.depots[0]?.code ?? '',
      max_stops: '', max_minutes: '540', max_km: '350',
      prix_euros: centsVersEuros(cfg.palette.prix_emplacement_defaut_cents),
      slots_per_cycle: '2', recurrence: [], is_active: true,
    };
  }
  return {
    id: secteur.id, code: secteur.code, label: secteur.label, depot: secteur.depot,
    max_stops: String(secteur.max_stops), max_minutes: String(secteur.max_minutes), max_km: String(secteur.max_km),
    prix_euros: centsVersEuros(secteur.slot_price_ttc_cents),
    slots_per_cycle: String(secteur.slots_per_cycle),
    recurrence: normaliserRecurrence(secteur.recurrence),
    is_active: secteur.is_active !== false,
  };
}

/** Bornes des RPC `webshop_sector_upsert` (20261017_2). */
const BORNES_SECTEUR = {
  max_stops: [1, 1000], max_minutes: [1, 1440], max_km: [1, 5000], slots_per_cycle: [1, 40],
};

/**
 * @param {ReturnType<typeof formSecteur>} f
 * @param {{ codesDepots: string[] }} ctx
 * @returns {Record<string, string>}
 */
export function validerSecteur(f, { codesDepots }) {
  /** @type {Record<string, string>} */
  const e = {};
  if (!f.id && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(f.code ?? '').trim())) e.code = 'Code requis (lettres, chiffres, - ou _)';
  if (!String(f.label ?? '').trim()) e.label = 'Libellé requis';
  if (!codesDepots.includes(f.depot)) e.depot = 'Choisissez un dépôt enregistré';
  for (const [k, [min, max]] of Object.entries(BORNES_SECTEUR)) {
    const v = entier(f[k]);
    if (!Number.isInteger(v) || v < min || v > max) e[k] = `Nombre entier entre ${min} et ${max}`;
  }
  const prix = eurosVersCents(f.prix_euros);
  if (!Number.isInteger(prix) || prix > 10_000_000) e.prix_euros = 'Montant en euros (2 décimales au plus)';
  return e;
}

/**
 * Payload de `webshop_sector_upsert` (nombres JSON, prix en centimes). Le code n'est envoyé qu'à
 * la création (immuable ensuite).
 * @param {ReturnType<typeof formSecteur>} f
 */
export function payloadSecteur(f) {
  const p = {
    label: String(f.label).trim(),
    depot: f.depot,
    max_stops: entier(f.max_stops),
    max_minutes: entier(f.max_minutes),
    max_km: entier(f.max_km),
    slot_price_ttc_cents: eurosVersCents(f.prix_euros),
    slots_per_cycle: entier(f.slots_per_cycle),
    recurrence: f.recurrence.map((r) => ({ week: r.week, weekday: r.weekday })),
    is_active: f.is_active === true,
  };
  return f.id ? { id: f.id, ...p } : { code: String(f.code).trim(), ...p };
}

// ---------------------------------------------------------------------------
// Tarifs colis (price_ttc en EUROS) et chevauchement des tranches
// ---------------------------------------------------------------------------

/**
 * Tranche active de l'org qui chevauche `candidat`, ou null. Tranches demi-ouvertes
 * [min, max[ (max null = sans plafond), comme le calcul du site (`weight >= min && weight < max`).
 * La base ne contrôle pas ce chevauchement : l'écran le refuse.
 * @param {Array<{ id: string, min_weight_kg: any, max_weight_kg: any, is_active: boolean, label: string }>} tarifs
 * @param {{ id?: string|null, min_weight_kg: number, max_weight_kg: number|null, is_active: boolean }} candidat
 */
export function trancheEnConflit(tarifs, candidat) {
  if (!candidat.is_active) return null;
  const fin = (m) => (m === null || m === undefined || m === '' ? Infinity : Number(m));
  const aMin = Number(candidat.min_weight_kg);
  const aMax = fin(candidat.max_weight_kg);
  return (Array.isArray(tarifs) ? tarifs : []).find((t) => t.id !== candidat.id && t.is_active
    && aMin < fin(t.max_weight_kg) && Number(t.min_weight_kg) < aMax) ?? null;
}

/**
 * @param {{ label: string, min: string, max: string, prix: string }} f
 * @returns {{ erreurs: Record<string, string>, valeur: { label: string, min_weight_kg: number, max_weight_kg: number|null, price_ttc: number } }}
 */
export function validerTarif(f) {
  /** @type {Record<string, string>} */
  const erreurs = {};
  const label = String(f.label ?? '').trim();
  const min = decimal(f.min, 3);
  const max = String(f.max ?? '').trim() === '' ? null : decimal(f.max, 3);
  const prix = decimal(f.prix, 2);
  if (!label) erreurs.label = 'Libellé requis';
  if (!Number.isFinite(min)) erreurs.min = 'Poids en kg (3 décimales au plus)';
  if (max !== null && !Number.isFinite(max)) erreurs.max = 'Poids en kg, ou vide = sans plafond';
  else if (max !== null && Number.isFinite(min) && max <= min) erreurs.max = 'Doit dépasser le poids minimum';
  if (!Number.isFinite(prix)) erreurs.prix = 'Prix TTC en euros (2 décimales au plus)';
  return { erreurs, valeur: { label, min_weight_kg: min, max_weight_kg: max, price_ttc: prix } };
}

// ---------------------------------------------------------------------------
// Points de retrait
// ---------------------------------------------------------------------------

export const ACCEPTS = [
  { value: 'both', label: 'Palettes et colis' },
  { value: 'pallet', label: 'Palettes seulement' },
  { value: 'parcel', label: 'Colis seulement' },
];

/**
 * @param {{ id?: string|null, slug: string, name: string, address: string, opening_hours: string, accepts: string }} f
 * @returns {Record<string, string>}
 */
export function validerPoint(f) {
  /** @type {Record<string, string>} */
  const e = {};
  if (!f.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(f.slug ?? '').trim())) e.slug = 'Identifiant requis : minuscules, chiffres et tirets (ex. gaillac)';
  if (!String(f.name ?? '').trim()) e.name = 'Nom requis';
  if (!String(f.address ?? '').trim()) e.address = 'Adresse requise';
  if (!ACCEPTS.some((a) => a.value === f.accepts)) e.accepts = 'Choix requis';
  return e;
}
