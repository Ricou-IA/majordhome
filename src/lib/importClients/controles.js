// src/lib/importClients/controles.js
// Contrôle d'une fiche, classement des lignes (prête, doublon, écartée) et bilan — module PUR (imports relatifs
// seulement), testé par scripts/import-clients/controles.test.mjs.
// Un doublon avec la base se cherche par index construits une seule fois : jamais de balayage complet par ligne.

import { CHAMPS } from './champs.js';
import { normaliserValeur } from './normaliser.js';
import { verifierLigne } from './lots.js';
import { buildClientDisplayName } from '../clientDisplayName.js';
import { buildClientDuplicateProbe, matchClientDuplicates, phoneTailKey } from '../clientDuplicateMatch.js';
import { normalizeEmailKey, normalizeNameKey } from '../leadDuplicateMatch.js';

/** Libellé affichable de la raison d'une ligne non importée. */
export const LIBELLE_RAISON = {
  sans_nom: 'Ni nom ni société',
  doublon_fichier: 'Déjà présent plus haut dans le fichier',
  doublon_fort: 'Déjà dans vos clients',
  doublon_faible: 'Homonyme écarté',
  valeur_refusee: 'Valeur refusée par la base',
};

/**
 * Raison affichée d'une ligne écartée ; pour une valeur refusée, le champ en cause entre parenthèses.
 * @param {{ raison: string, colonne?: string }} ligne
 * @returns {string}
 */
export function raisonAffichee({ raison, colonne }) {
  const libelle = LIBELLE_RAISON[raison] || raison;
  if (raison !== 'valeur_refusee' || !colonne) return libelle;
  return `${libelle} (${CHAMPS.find((c) => c.colonne === colonne)?.libelle || colonne})`;
}

const CATEGORIES = ['particulier', 'entreprise', 'public'];

const vide = (v) => v === null || v === undefined || v === '';

/**
 * Transforme un candidat (sortie d'appliquerCorrespondance) en fiche prête à écrire.
 * Une valeur illisible laisse le champ vide et reste lisible dans les notes internes ; les accords e-mail et SMS
 * valent « oui » quand ils sont absents ou illisibles (colonnes non nulles).
 * Une fiche sans nom de famille ni société (un prénom seul) est écartée ; une fiche que `clients_import_batch`
 * refuserait (`verifierLigne`) l'est aussi, avec la colonne en cause : jamais un lot entier refusé par la base.
 * @param {{ numero: number, valeurs: Record<string, string>, notesAjoutees: string[] }} candidate
 * @returns {{ numero: number, fiche: Record<string, unknown>, ecartee: boolean, raison: ''|'sans_nom'|'valeur_refusee', colonne?: string, corrections: Array<{ libelle: string, valeur: string }> }}
 */
export function controlerFiche(candidate) {
  const { numero, valeurs = {}, notesAjoutees = [] } = candidate;
  const fiche = {};
  const corrections = [];
  for (const champ of CHAMPS) {
    const brut = valeurs[champ.cle];
    const { valeur, illisible } = normaliserValeur(champ, brut ?? '');
    if (illisible) corrections.push({ libelle: champ.libelle, valeur: String(brut).trim() });
    fiche[champ.colonne] = champ.type === 'oui_non' ? (illisible ? true : valeur) : (valeur ?? null);
  }

  if (fiche.last_name) fiche.last_name = fiche.last_name.toUpperCase();
  if (fiche.first_name) fiche.first_name = fiche.first_name.toUpperCase();
  if (fiche.company_name && !fiche.last_name && !fiche.first_name) {
    fiche.client_category = 'entreprise'; // une société seule est une entreprise, quoi que dise le fichier
  } else if (!CATEGORIES.includes(fiche.client_category)) {
    fiche.client_category = fiche.company_name ? 'entreprise' : 'particulier';
  }
  fiche.display_name = buildClientDisplayName({
    firstName: fiche.first_name, lastName: fiche.last_name, companyName: fiche.company_name, clientCategory: fiche.client_category,
  });

  const parties = [fiche.internal_notes, ...notesAjoutees, ...corrections.map((c) => `${c.libelle} d'origine : ${c.valeur}`)]
    .filter((p) => !vide(p) && String(p).trim());
  fiche.internal_notes = parties.length ? parties.join('\n') : null;

  if (!fiche.display_name || (!fiche.last_name && !fiche.company_name)) {
    return { numero, fiche, ecartee: true, raison: 'sans_nom', corrections };
  }
  const colonne = verifierLigne({ import_line: numero, ...fiche });
  if (colonne) return { numero, fiche, ecartee: true, raison: 'valeur_refusee', colonne, corrections };
  return { numero, fiche, ecartee: false, raison: '', corrections };
}

const cleRef = (ref) => (vide(ref) ? '' : String(ref).trim().toLowerCase());
const cleNom = (k) => (k ? `${k.last}|${k.first}` : null);
// Nom affiché comparable : majuscules, sans accent, espaces réduits (même normalisation que les noms de famille).
const cleAffiche = (nomAffiche) => { const k = normalizeNameKey('x', nomAffiche); return k ? k.last : null; };
const cp = (v) => (vide(v) ? '' : String(v).trim());

function ajouter(index, cle, valeur) {
  if (!cle) return;
  const liste = index.get(cle);
  if (liste) liste.push(valeur); else index.set(cle, [valeur]);
}

/** Nom affiché d'un client existant : celui fourni, sinon reconstruit depuis ses champs. */
function nomAfficheExistant(c) {
  return c.display_name || buildClientDisplayName({
    firstName: c.first_name, lastName: c.last_name, companyName: c.company_name, clientCategory: c.client_category,
  });
}

/** Index des clients existants : téléphones, e-mail, nom de famille, nom affiché, ancien numéro. */
function indexerExistants(clients) {
  const tel = new Map(); const mail = new Map(); const nom = new Map(); const ref = new Map(); const affiche = new Map();
  for (const c of clients) {
    ajouter(affiche, cleAffiche(nomAfficheExistant(c)), c);
    for (const k of new Set([phoneTailKey(c.phone), phoneTailKey(c.phone_secondary)])) ajouter(tel, k, c);
    ajouter(mail, normalizeEmailKey(c.email), c);
    const n = normalizeNameKey('x', c.last_name);
    ajouter(nom, n && n.last, c);
    ajouter(ref, cleRef(c.external_ref), c);
  }
  return { tel, mail, nom, ref, affiche };
}

/** Rapprochements d'une fiche avec la base : fiches confirmées par matchClientDuplicates, plus l'ancien numéro. */
function doublonsAvecBase(fiche, index) {
  const probe = buildClientDuplicateProbe({
    phone: fiche.phone, phoneSecondary: fiche.phone_secondary, email: fiche.email,
    firstName: fiche.first_name, lastName: fiche.last_name, postalCode: fiche.postal_code,
  });
  const candidats = new Set();
  if (probe) {
    for (const k of probe.phoneKeys) for (const c of index.tel.get(k) || []) candidats.add(c);
    for (const c of (probe.emailKey && index.mail.get(probe.emailKey)) || []) candidats.add(c);
    const n = normalizeNameKey('x', fiche.last_name);
    for (const c of (n && index.nom.get(n.last)) || []) candidats.add(c);
  }
  const trouves = probe ? matchClientDuplicates([...candidats], probe) : [];
  const aff = cleAffiche(fiche.display_name);
  for (const c of (aff && index.affiche.get(aff)) || []) {
    const deja = trouves.find((m) => m.id === c.id);
    if (deja) { if (!deja.matchReasons.includes('nom_affiche')) deja.matchReasons.push('nom_affiche'); }
    else trouves.push({ ...c, matchReasons: ['nom_affiche'], isStrong: false });
  }
  const ref = cleRef(fiche.external_ref);
  if (ref) {
    for (const c of index.ref.get(ref) || []) {
      const deja = trouves.find((m) => m.id === c.id);
      if (deja) deja.raisonAncienNumero = true;
      else trouves.push({ ...c, matchReasons: [], isStrong: false, raisonAncienNumero: true });
    }
  }
  return trouves;
}

/** « Fort » : même téléphone ou e-mail, même ancien numéro, ou même nom (affiché, ou nom + prénom) sans code postal contradictoire. */
function estFort(m, codePostalFiche) {
  if (m.isStrong || m.raisonAncienNumero) return true;
  if (!m.matchReasons.includes('name') && !m.matchReasons.includes('nom_affiche')) return false;
  const autre = cp(m.postal_code);
  return !codePostalFiche || !autre || codePostalFiche === autre;
}

/** Mémoire des lignes déjà vues dans le fichier, pour y repérer les doublons. */
function nouvelleMemoireFichier() {
  const parRef = new Map(); const parNom = new Map(); const parAffiche = new Map();
  const memes = (v, tels, mail, codePostal) => tels.some((t) => v.tels.includes(t)) || (mail && mail === v.mail) || (codePostal && codePostal === v.codePostal);
  const anonyme = (v) => !v.tels.length && !v.mail && !v.codePostal;
  return {
    chercher(ligne) {
      const { ref, nom, affiche, tels, mail, codePostal } = ligne;
      if (ref && parRef.has(ref)) return parRef.get(ref);
      for (const v of (nom && parNom.get(nom)) || []) if (memes(v, tels, mail, codePostal)) return v.numero;
      // Même nom affiché : mêmes coordonnées, ou rien de part et d'autre pour les distinguer.
      for (const v of (affiche && parAffiche.get(affiche)) || []) if (memes(v, tels, mail, codePostal) || (anonyme(v) && anonyme(ligne))) return v.numero;
      return null;
    },
    retenir(ligne) {
      if (ligne.ref && !parRef.has(ligne.ref)) parRef.set(ligne.ref, ligne.numero);
      ajouter(parNom, ligne.nom, ligne);
      ajouter(parAffiche, ligne.affiche, ligne);
    },
  };
}

/**
 * Classe chaque candidat : prête, doublon (fichier, base forte ou faible) ou écartée. Ordre des tests : doublon dans
 * le fichier (la première ligne gagne), puis doublon avec les clients existants, sinon prête.
 * @param {Array<{ numero: number, valeurs: Record<string, string>, notesAjoutees: string[] }>} candidates dans l'ordre du fichier
 * @param {Array<object>} clientsExistants clients de l'entreprise (display_name, first_name, last_name, company_name, client_category, phone, phone_secondary, email, postal_code, external_ref)
 * @returns {Array<{ numero: number, fiche: Record<string, unknown>, statut: 'prete'|'doublon_fort'|'doublon_faible'|'doublon_fichier'|'ecartee', raison: string, doublons: Array<object>, corrections: Array<{ libelle: string, valeur: string }> }>}
 */
export function classerLignes(candidates, clientsExistants) {
  const index = indexerExistants(clientsExistants || []);
  const memoire = nouvelleMemoireFichier();
  return candidates.map((candidate) => {
    const { numero, fiche, ecartee, raison, colonne, corrections } = controlerFiche(candidate);
    if (ecartee) return { numero, fiche, statut: 'ecartee', raison, colonne, doublons: [], corrections };

    const codePostal = cp(fiche.postal_code);
    const ligne = {
      numero,
      ref: cleRef(fiche.external_ref),
      nom: cleNom(normalizeNameKey(fiche.first_name, fiche.last_name)),
      affiche: cleAffiche(fiche.display_name),
      tels: [...new Set([phoneTailKey(fiche.phone), phoneTailKey(fiche.phone_secondary)].filter(Boolean))],
      mail: normalizeEmailKey(fiche.email),
      codePostal,
    };

    const dejaVue = memoire.chercher(ligne);
    memoire.retenir(ligne);
    if (dejaVue !== null) {
      return { numero, fiche, statut: 'doublon_fichier', raison: 'doublon_fichier', doublons: [{ numero: dejaVue }], corrections };
    }

    const doublons = doublonsAvecBase(fiche, index);
    if (doublons.length) {
      const statut = doublons.some((m) => estFort(m, codePostal)) ? 'doublon_fort' : 'doublon_faible';
      return { numero, fiche, statut, raison: statut, doublons, corrections };
    }
    return { numero, fiche, statut: 'prete', raison: '', doublons: [], corrections };
  });
}

/**
 * Une ligne est-elle écrite, compte tenu des choix de l'utilisateur ? Un doublon fort ou du fichier est écarté par défaut
 * mais se reprend (numéro dans `importer`) ; un doublon faible est repris par défaut et s'écarte (numéro dans `ecarter`).
 * @param {{ numero: number, statut: string }} ligneClassee
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix numéros de ligne
 * @returns {boolean}
 */
export function aImporter(ligneClassee, choix) {
  const { numero, statut } = ligneClassee;
  if (statut === 'prete') return true;
  if (statut === 'doublon_fort' || statut === 'doublon_fichier') return choix.importer.has(numero);
  if (statut === 'doublon_faible') return !choix.ecarter.has(numero);
  return false;
}

/**
 * Bilan affiché à l'écran : importées + doublons écartés + écartées = lues, toujours.
 * @param {Array<{ numero: number, statut: string }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {{ lues: number, importees: number, doublons_ecartes: number, ecartees: number }}
 */
export function bilan(classees, choix) {
  const lues = classees.length;
  const importees = classees.filter((l) => aImporter(l, choix)).length;
  const ecartees = classees.filter((l) => l.statut === 'ecartee').length;
  return { lues, importees, doublons_ecartes: lues - importees - ecartees, ecartees };
}

/**
 * Lignes à envoyer à l'écriture : numéro de ligne du fichier plus les colonnes de la fiche (jamais d'organisation).
 * @param {Array<{ numero: number, fiche: Record<string, unknown>, statut: string }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {Array<Record<string, unknown>>}
 */
export function lignesPourEcriture(classees, choix) {
  return classees.filter((l) => aImporter(l, choix)).map((l) => ({ import_line: l.numero, ...l.fiche }));
}

/**
 * Fiches qui seront importées sans code postal (elles ne seront pas placées sur la carte).
 * @param {Array<{ numero: number, statut: string, fiche: Record<string, unknown> }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {number}
 */
export function fichesSansCodePostal(classees, choix) {
  return classees.filter((l) => aImporter(l, choix) && !cp(l.fiche?.postal_code)).length;
}

/**
 * Valeurs corrigées (laissées vides, gardées en notes internes) parmi les lignes qui SERONT importées, par champ :
 * la plus fréquente d'abord, à égalité dans l'ordre du catalogue.
 * @param {Array<{ numero: number, statut: string, corrections?: Array<{ libelle: string }> }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {Array<{ libelle: string, nombre: number }>}
 */
export function resumeCorrections(classees, choix) {
  const compte = new Map();
  for (const l of classees) {
    if (!aImporter(l, choix)) continue;
    for (const libelle of new Set((l.corrections || []).map((c) => c.libelle))) {
      compte.set(libelle, (compte.get(libelle) || 0) + 1);
    }
  }
  const ordre = (libelle) => CHAMPS.findIndex((c) => c.libelle === libelle);
  return [...compte].map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre || ordre(a.libelle) - ordre(b.libelle));
}
